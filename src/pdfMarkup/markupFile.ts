/**
 * File layer of the markup feature, used by the Electron main process (spec sections 1 and 7): loads and
 * saves markup through the PDF itself, written atomically (temp file in the same folder, verified, then
 * renamed). Encrypted and non-writable PDFs without embedded data fall back to a v1 `.data` sidecar, and so
 * do PDFs without embedded data that stay locked (EBUSY/EPERM/EACCES) after the retries; once a PDF has
 * embedded data, a failed write is reported and the PDF stays byte-identical. While such a PDF has a v1
 * sidecar, only the migrating save (all sidecar pages, `deleteLegacySidecar`) writes the PDF; other saves
 * keep merging into the sidecar (see `mustStayInSidecar`). No Electron imports: this
 * module is unit-tested in Node.
 */
import fs from "node:fs";
import path from "node:path";
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import {
  markupPayloadSchema,
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
 * `.<name>.data` next to the PDF. Same name logic as the old app's `getOverlayDataFilePathFromSheetPath` in
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
const errorCode = (e: unknown) => (e instanceof Error && "code" in e ? e.code : undefined);
const isNotFound = (e: unknown) => errorCode(e) === "ENOENT";

/**
 * Windows reports a file that another program (Acrobat, a virus scanner, a sync client) holds open as
 * EBUSY, EPERM or EACCES; usually only for a moment.
 */
const isLockedError = (e: unknown) => ["EBUSY", "EPERM", "EACCES"].includes(String(errorCode(e)));

/** Waits between the attempts of a locked file operation: about 3 s in total. */
let lockRetryDelaysMs: readonly number[] = [50, 100, 200, 400, 750, 1500];

/** For tests: sets the waits between attempts (an empty list = no retry) and returns the previous ones. */
export function setLockRetryDelays(delaysMs: readonly number[]): readonly number[] {
  const previous = lockRetryDelaysMs;
  lockRetryDelaysMs = delaysMs;
  return previous;
}

/** Runs `operation`, repeating it while it fails because the file is locked (see `isLockedError`). */
async function retryWhileLocked<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (e) {
      const delay = lockRetryDelaysMs[attempt];
      if (delay === undefined || !isLockedError(e)) throw e;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

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
 * Opening the temp file and the rename are retried while the file is locked. On any failure the temp
 * file is removed and `target` is untouched.
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
    const handle = await retryWhileLocked(() => fs.promises.open(temp, "w"));
    try {
      await handle.writeFile(bytes);
      if (mode !== null) await handle.chmod(mode).catch(() => undefined);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (verify) await verify(await fs.promises.readFile(temp));
    await retryWhileLocked(() => fs.promises.rename(temp, target));
  } catch (e) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** JSON with sorted object keys, so equal data gives equal text whatever the key order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Page -> canonical JSON of the payload the page must have after a save. */
type ExpectedPages = Map<number, string>;

/** The payload as our reader returns it (schema-normalized), as canonical JSON. */
const expectedPayload = (payload: MarkupPayload) => canonicalJson(markupPayloadSchema.parse(payload));

const expectedFromMarkup = (markup: ReadMarkupResult): ExpectedPages =>
  new Map(markup.pages.map((p) => [p.page, canonicalJson(p.payload)]));

/** Fails unless the PDF `written` contains our markup on exactly the pages in `expected`, each with its payload. */
async function verifyPages(written: Uint8Array, expected: ExpectedPages): Promise<void> {
  const inspection = await inspectPdf(written);
  if (!inspection || inspection.encrypted) throw new Error("verification failed: the written PDF is unreadable");
  const actual = inspection.markup.pages;
  if (actual.length !== expected.size || !actual.every((p) => expected.has(p.page)))
    throw new Error(
      `verification failed: expected markup on pages [${[...expected.keys()].join(", ")}], found [${actual.map((p) => p.page).join(", ")}]`,
    );
  const differing = actual.filter((p) => canonicalJson(p.payload) !== expected.get(p.page)).map((p) => p.page);
  if (differing.length > 0)
    throw new Error(`verification failed: the markup data of pages [${differing.join(", ")}] differs from what was saved`);
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

/**
 * Merges the changes into an existing v1 sidecar; no pages left → file removed. A legacy sidecar (the
 * user's only copy of that data) is replaced only when the caller migrated it (`deleteLegacySidecar`);
 * otherwise this fails and the file stays untouched.
 */
async function writeSidecar(input: SaveMarkupInput): Promise<void> {
  const { path: pdfPath, pages: changes } = input;
  const existing = await readSidecar(pdfPath);
  if (existing.kind === "legacy" && !input.deleteLegacySidecar)
    throw new Error("A legacy sidecar exists and was not migrated; it is left untouched.");
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
  // `source` and pages come from the state before the repair: the repair only renames orphans (the
  // valid pages stay), but it writes `meta`, which must not hide a v1 sidecar of a PDF without data.
  const inspection = await inspectPdf(bytes);

  if (inspection && !inspection.encrypted && inspection.markup.orphans.length > 0 && (await isWritable(realPath))) {
    const expected = expectedFromMarkup(inspection.markup);
    try {
      const repaired = await buildMarkedPdf(bytes, []);
      await atomicReplace(realPath, repaired, (written) => verifyPages(written, expected));
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

    // Unparseable: no embedded data can be known (load then uses the sidecar too), the PDF stays untouched.
    if (!inspection || inspection.encrypted || !(await isWritable(realPath))) return await fallback(input, inspection);
    if (await mustStayInSidecar(input, inspection)) return await fallback(input, inspection);

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

    const expected = expectedFromMarkup(inspection.markup);
    for (const { page, payload } of input.pages) {
      if (payload) expected.set(page, expectedPayload(payload));
      else expected.delete(page);
    }
    try {
      await atomicReplace(realPath, marked, (written) => verifyPages(written, expected));
    } catch (e) {
      // Still locked after the retries (spec section 1): a PDF without embedded data falls back to the
      // sidecar, which the migration picks up later; with embedded data the error is reported.
      if (isLockedError(e) && !hasEmbeddedData(inspection)) return await fallback(input, inspection);
      throw e;
    }

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

/**
 * A PDF without embedded data that has a v1 sidecar (e.g. written earlier in this visit while the PDF was
 * locked or read-only) is written only by the migrating save: `deleteLegacySidecar` set and every page of
 * the sidecar in the request (with its payload or `null`). Any other PDF write would give the PDF
 * embedded data, which hides the sidecar on the next load ("embedded wins"), so the sidecar pages not in
 * the request would become invisible (final review B1). Such saves keep merging into the sidecar instead.
 * Main cannot move the sidecar pages itself: their stamp PNGs are rendered by the renderer.
 */
async function mustStayInSidecar(input: SaveMarkupInput, inspection: Inspection): Promise<boolean> {
  if (hasEmbeddedData(inspection)) return false;
  const sidecar = await readSidecar(input.path);
  if (sidecar.kind !== "v1") return false;
  if (!input.deleteLegacySidecar) return true;
  const inRequest = new Set(input.pages.map((p) => p.page));
  return [...sidecar.pages.keys()].some((page) => !inRequest.has(page));
}

/**
 * Encrypted, unparseable, not writable or locked: sidecar only if the PDF has no embedded data, never two
 * competing states.
 */
async function fallback(input: SaveMarkupInput, inspection: Inspection | null): Promise<SaveMarkupResult> {
  if (hasEmbeddedData(inspection))
    return { status: "error", message: "The PDF already contains markup but cannot be written (read-only?)." };
  await writeSidecar(input);
  return { status: "sidecar" };
}
