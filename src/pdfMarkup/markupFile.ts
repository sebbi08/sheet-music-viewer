/**
 * File layer of the markup feature, used by the Electron main process (spec sections 1 and 7): loads and
 * saves markup through the PDF itself, written atomically (temp file in the same folder, verified, then
 * renamed). Encrypted and non-writable PDFs without embedded data fall back to a v1 `.data` sidecar; once
 * a PDF has embedded data, a failed write is reported and the PDF stays byte-identical. No Electron
 * imports: this module is unit-tested in Node.
 */
import fs from "node:fs";
import path from "node:path";
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import {
  sidecarV1Schema,
  type LoadMarkupResult,
  type LoadedMarkupPage,
  type MarkupPayload,
  type SaveMarkupInput,
  type SaveMarkupResult,
} from "../models/markup";
import { buildMarkedPdf, type PageChange } from "./buildMarkedPdf";
import { readMarkup, type ReadMarkupResult } from "./readMarkup";

/**
 * `.<name>.data` next to the PDF. Same name logic as `getOverlayDataFilePathFromSheetPath` in
 * `trcpLib.ts` (including its `String.replace` of the extension), so existing legacy files are found.
 */
export function getSidecarPath(pdfPath: string): string {
  const base = path.basename(pdfPath);
  return path.join(path.dirname(pdfPath), "." + base.replace(path.extname(base), ".data"));
}

// ---------------------------------------------------------------------------------------------------------
// Per-path serialization
// ---------------------------------------------------------------------------------------------------------

const queues = new Map<string, Promise<unknown>>();

/** Runs `task` after every earlier task for the same file has settled. */
function serialized<T>(file: string, task: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(file);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const next = (queues.get(key) ?? Promise.resolve()).then(task);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isNotFound = (e: unknown) => e instanceof Error && "code" in e && e.code === "ENOENT";

type Inspection = { encrypted: true } | { encrypted: false; markup: ReadMarkupResult };

/** Parses the PDF; `null` if pdf-lib cannot read it. */
async function inspectPdf(bytes: Uint8Array): Promise<Inspection | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    if (doc.isEncrypted) return { encrypted: true };
    return { encrypted: false, markup: readMarkup(doc) };
  } catch {
    return null;
  }
}

/** Embedded data = our stamps or our catalog metadata. Then the sidecar is ignored and never written. */
const hasEmbeddedData = (
  inspection: Inspection | null,
): inspection is Extract<Inspection, { encrypted: false }> =>
  inspection !== null &&
  !inspection.encrypted &&
  (inspection.markup.pages.length > 0 || inspection.markup.meta !== null);

/** The file and its folder are writable (the folder is needed for the temp file and the rename). */
async function isWritable(file: string): Promise<boolean> {
  try {
    await fs.promises.access(file, fs.constants.W_OK);
    await fs.promises.access(path.dirname(file), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replaces `target` atomically: writes `.<name>.smv-tmp` in the same folder (flushed to disk, with the
 * target's permissions), lets `verify` check the bytes read back from it, then renames it over `target`.
 * On any failure the temp file is removed and `target` is untouched.
 */
async function atomicReplace(
  target: string,
  bytes: Uint8Array,
  verify?: (written: Uint8Array) => Promise<void>,
): Promise<void> {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.smv-tmp`);
  try {
    const mode = await fs.promises.stat(target).then(
      (s) => s.mode & 0o777,
      () => null,
    );
    const handle = await fs.promises.open(temp, "w");
    try {
      await handle.writeFile(bytes);
      if (mode !== null) await handle.chmod(mode).catch(() => undefined);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (verify) await verify(await fs.promises.readFile(temp));
    await fs.promises.rename(temp, target);
  } catch (e) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** Fails unless the PDF `written` contains our markup on exactly the pages in `expected`. */
async function verifyPages(written: Uint8Array, expected: Set<number>): Promise<void> {
  const inspection = await inspectPdf(written);
  if (!inspection || inspection.encrypted) throw new Error("verification failed: the written PDF is unreadable");
  const actual = inspection.markup.pages.map((p) => p.page);
  if (actual.length !== expected.size || !actual.every((page) => expected.has(page)))
    throw new Error(
      `verification failed: expected markup on pages [${[...expected].join(", ")}], found [${actual.join(", ")}]`,
    );
}

const toLoadedPages = (markup: ReadMarkupResult): LoadedMarkupPage[] =>
  markup.pages.map(({ page, rect, payload }) => ({ page, rect, payload }));

/** Accepts plain Base64 as well as a `data:image/png;base64,` URL. */
const decodePng = (base64: string) => new Uint8Array(Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64"));

// ---------------------------------------------------------------------------------------------------------
// Sidecar
// ---------------------------------------------------------------------------------------------------------

type Sidecar =
  | { kind: "none" }
  | { kind: "v1"; pages: Map<number, MarkupPayload> }
  | { kind: "legacy"; text: string };

async function readSidecar(pdfPath: string): Promise<Sidecar> {
  let text: string;
  try {
    text = await fs.promises.readFile(getSidecarPath(pdfPath), "utf8");
  } catch (e) {
    if (!isNotFound(e)) console.warn("Could not read the markup sidecar", e);
    return { kind: "none" };
  }
  if (text.trim() === "") return { kind: "none" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "legacy", text };
  }
  const parsed = sidecarV1Schema.safeParse(json);
  if (!parsed.success) return { kind: "legacy", text };
  return { kind: "v1", pages: new Map(parsed.data.pages.map((p) => [p.page, p.payload])) };
}

/** Merges the changes into an existing v1 sidecar (a legacy one is replaced); no pages left → file removed. */
async function writeSidecar(pdfPath: string, changes: SaveMarkupInput["pages"]): Promise<void> {
  const existing = await readSidecar(pdfPath);
  const pages = existing.kind === "v1" ? existing.pages : new Map<number, MarkupPayload>();
  for (const { page, payload } of changes) {
    if (payload) pages.set(page, payload);
    else pages.delete(page);
  }
  const sidecarPath = getSidecarPath(pdfPath);
  if (pages.size === 0) {
    await fs.promises.rm(sidecarPath, { force: true });
    return;
  }
  const content = {
    version: 1 as const,
    pages: [...pages.entries()].sort(([a], [b]) => a - b).map(([page, payload]) => ({ page, payload })),
  };
  await atomicReplace(sidecarPath, Buffer.from(JSON.stringify(content), "utf8"));
}

async function loadSidecar(pdfPath: string): Promise<LoadMarkupResult> {
  const sidecar = await readSidecar(pdfPath);
  if (sidecar.kind === "v1") {
    const pages = [...sidecar.pages.entries()]
      .sort(([a], [b]) => a - b)
      .map(([page, payload]) => ({ page, rect: null, payload }));
    return { source: "sidecar", pages, legacyOverlayData: null };
  }
  return { source: "none", pages: [], legacyOverlayData: sidecar.kind === "legacy" ? sidecar.text : null };
}

// ---------------------------------------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------------------------------------

/**
 * Markup of a PDF. Embedded data wins (the sidecar is then ignored); otherwise a v1 sidecar is loaded,
 * and anything else in the sidecar is returned raw as `legacyOverlayData` for migration. Orphaned
 * stamps are repaired first when the file is writable (a failed repair is logged, not fatal).
 */
export function loadMarkupFromFile(pdfPath: string): Promise<LoadMarkupResult> {
  return serialized(pdfPath, () => loadNow(pdfPath));
}

async function loadNow(pdfPath: string): Promise<LoadMarkupResult> {
  const realPath = await fs.promises.realpath(pdfPath);
  const bytes = await fs.promises.readFile(realPath);
  let inspection = await inspectPdf(bytes);

  if (inspection && !inspection.encrypted && inspection.markup.orphans.length > 0 && (await isWritable(realPath))) {
    const expected = new Set(inspection.markup.pages.map((p) => p.page));
    try {
      const repaired = await buildMarkedPdf(bytes, []);
      await atomicReplace(realPath, repaired, (written) => verifyPages(written, expected));
      inspection = await inspectPdf(repaired);
    } catch (e) {
      console.warn("Could not repair orphaned markup stamps", e);
    }
  }

  if (hasEmbeddedData(inspection))
    return { source: "pdf", pages: toLoadedPages(inspection.markup), legacyOverlayData: null };
  return loadSidecar(pdfPath);
}

// ---------------------------------------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------------------------------------

/**
 * Saves the changed pages (`payload: null` removes a page's markup). Never throws: failures come back as
 * `{ status: "error", message }` with the PDF unchanged. Saves of the same file run one after another.
 */
export function saveMarkupToFile(input: SaveMarkupInput): Promise<SaveMarkupResult> {
  return serialized(input.path, () => saveNow(input));
}

async function saveNow(input: SaveMarkupInput): Promise<SaveMarkupResult> {
  try {
    const realPath = await fs.promises.realpath(input.path);
    const bytes = await fs.promises.readFile(realPath);
    const inspection = await inspectPdf(bytes);

    if (inspection?.encrypted || !(await isWritable(realPath))) return await fallback(input, inspection);
    if (!inspection) throw new Error("the PDF could not be read");

    const changes: PageChange[] = input.pages.map(({ page, payload, pngBase64 }) => ({
      page,
      payload,
      png: pngBase64 === null ? null : decodePng(pngBase64),
    }));
    let marked: Uint8Array;
    try {
      marked = await buildMarkedPdf(bytes, changes);
    } catch (e) {
      if (e instanceof EncryptedPDFError) return await fallback(input, { encrypted: true });
      throw e;
    }

    const expected = new Set(inspection.markup.pages.map((p) => p.page));
    for (const { page, payload } of input.pages) {
      if (payload) expected.add(page);
      else expected.delete(page);
    }
    await atomicReplace(realPath, marked, (written) => verifyPages(written, expected));

    if (input.deleteLegacySidecar) {
      await fs.promises.rm(getSidecarPath(input.path), { force: true }).catch((e: unknown) => {
        console.warn("Could not delete the legacy markup sidecar", e);
      });
    }
    return { status: "pdf" };
  } catch (e) {
    return { status: "error", message: errorMessage(e) };
  }
}

/** Encrypted or not writable: sidecar only if the PDF has no embedded data, never two competing states. */
async function fallback(input: SaveMarkupInput, inspection: Inspection | null): Promise<SaveMarkupResult> {
  if (hasEmbeddedData(inspection))
    return { status: "error", message: "The PDF already contains markup but cannot be written (read-only?)." };
  await writeSidecar(input.path, input.pages);
  return { status: "sidecar" };
}
