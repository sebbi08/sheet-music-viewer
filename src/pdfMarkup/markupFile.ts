/**
 * File layer of the markup feature, used by the Electron main process (spec sections 1 and 7): loads and
 * saves markup through the PDF itself, written atomically (temp file in the same folder, verified, then
 * renamed). Encrypted and non-writable PDFs without embedded data fall back to a v1 `.data` sidecar, and so
 * do PDFs without embedded data that stay locked (EBUSY/EPERM/EACCES) after the retries; once a PDF has
 * embedded data, a failed write is reported and the PDF stays byte-identical. While such a PDF has a v1
 * sidecar, only the migrating save (all sidecar pages, `deleteLegacySidecar`) writes the PDF; other saves
 * keep merging into the sidecar (see `mustStayInSidecar`). Why a PDF cannot take markup at all is its
 * write block (`checkMarkupWritable`, `LoadMarkupResult.writeBlock`); `trySaveMarkupToFile` runs a save
 * without writing anything. `migrateSidecarToFile` moves one legacy sidecar into its PDF (never into a
 * sidecar). No Electron imports: this module is unit-tested in Node.
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
  type MigrateSidecarInput,
  type MigrateSidecarResult,
  type SaveFailureReason,
  type SaveMarkupInput,
  type SaveMarkupResult,
  type WriteBlock,
} from "../models/markup";
import { buildMarkedPdf, type PageChange } from "./buildMarkedPdf";
import { isFolderWritable } from "./folderProbe";
import { getSidecarPath, legacySidecarHasMarkup, readSidecarContent } from "./legacySidecar";
import { readMarkup, type ReadMarkupResult } from "./readMarkup";

export { getSidecarPath, legacySidecarHasMarkup };

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
export async function retryWhileLocked<T>(operation: () => Promise<T>): Promise<T> {
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

/**
 * The file and its folder are writable. The folder is needed for the temp file and the rename, and is
 * probed with a real file (`isFolderWritable`), because `access` ignores folder ACLs on Windows.
 */
async function isWritable(file: string): Promise<boolean> {
  try {
    await fs.promises.access(file, fs.constants.W_OK);
  } catch {
    return false;
  }
  return isFolderWritable(path.dirname(file));
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

/** Why `actual` is not our markup on exactly the pages in `expected`, each with its payload; `null` = it is. */
function pagesMismatch(actual: ReadMarkupResult["pages"], expected: ExpectedPages): string | null {
  if (actual.length !== expected.size || !actual.every((p) => expected.has(p.page))) {
    const found = actual.map((p) => p.page);
    return `expected markup on pages [${[...expected.keys()].join(", ")}], found [${found.join(", ")}]`;
  }
  const differing = actual.filter((p) => canonicalJson(p.payload) !== expected.get(p.page)).map((p) => p.page);
  if (differing.length > 0) return `the markup data of pages [${differing.join(", ")}] differs`;
  return null;
}

/**
 * A built or written PDF does not hold the markup it should. Reported as `structure` in the trial and in
 * a real write alike (`failureReason`).
 */
class VerificationError extends Error {}

/** Fails unless the PDF `written` contains our markup on exactly the pages in `expected`, each with its payload. */
async function verifyPages(written: Uint8Array, expected: ExpectedPages): Promise<void> {
  const inspection = await inspectPdf(written);
  if (!inspection || inspection.encrypted)
    throw new VerificationError("verification failed: the written PDF is unreadable");
  const mismatch = pagesMismatch(inspection.markup.pages, expected);
  if (mismatch !== null) throw new VerificationError(`verification failed: ${mismatch}`);
}

/** The reason of an unexpected save failure: a failed verification, a file that stays locked, or other. */
const failureReason = (e: unknown): SaveFailureReason =>
  e instanceof VerificationError ? "structure" : isLockedError(e) ? "locked" : "other";

/** Stamp of the trial build: an empty payload and a transparent 1×1 PNG. */
const PROBE_PAYLOAD: MarkupPayload = { version: 1, width: 1, height: 1, fabric: { objects: [] } };
const PROBE_PNG = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGhgAAABBQCBIxe6sAAAAABJRU5ErkJggg==", "base64"),
);

/**
 * Builds the update a save would write, in memory, with a stamp on page 1 (replacing our markup there),
 * and reads it back. Throws whatever a save would fail on in the file's structure.
 */
async function trialBuild(bytes: Uint8Array, markup: ReadMarkupResult): Promise<void> {
  const marked = await buildMarkedPdf(bytes, [{ page: 1, payload: PROBE_PAYLOAD, png: PROBE_PNG }]);
  const expected = expectedFromMarkup(markup);
  expected.set(1, expectedPayload(PROBE_PAYLOAD));
  await verifyPages(marked, expected);
}

/** The checks that need no build: either a write block, or the PDF's markup to build on. */
type CheapCheck = { block: WriteBlock } | { block: null; markup: ReadMarkupResult };

/** The write block checks of `writeBlockOf` without the trial build: unparseable, encrypted, read-only. */
async function cheapWriteBlockOf(realPath: string, inspection: Inspection | null): Promise<CheapCheck> {
  if (!inspection) return { block: { reason: "unparseable" } };
  if (inspection.encrypted) return { block: { reason: "encrypted" } };
  if (!(await isWritable(realPath))) return { block: { reason: "readOnly" } };
  return { block: null, markup: inspection.markup };
}

/** Why markup cannot be saved into the PDF `bytes` read from `realPath`; `null` = it can. Never throws. */
async function writeBlockOf(
  realPath: string,
  bytes: Uint8Array,
  inspection: Inspection | null,
): Promise<WriteBlock | null> {
  const cheap = await cheapWriteBlockOf(realPath, inspection);
  if (cheap.block) return cheap.block;
  try {
    await trialBuild(bytes, cheap.markup);
    return null;
  } catch (e) {
    return { reason: "structure", message: errorMessage(e) };
  }
}

const toLoadedPages = (markup: ReadMarkupResult): LoadedMarkupPage[] =>
  markup.pages.map(({ page, rect, payload }) => ({ page, rect, payload }));

/** Accepts plain Base64 as well as a `data:image/png;base64,` URL. */
const decodePng = (base64: string) => new Uint8Array(Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64"));

// ---------------------------------------------------------------------------------------------------------
// Sidecar
// ---------------------------------------------------------------------------------------------------------

type PdfIssue = LoadMarkupResult["pdfIssue"];

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

async function loadSidecar(
  pdfPath: string,
  pdfIssue: PdfIssue,
  writeBlock: WriteBlock | null,
): Promise<LoadMarkupResult> {
  const sidecar = await readSidecar(pdfPath);
  if (sidecar.kind === "v1") {
    const pages = [...sidecar.pages.entries()]
      .sort(([a], [b]) => a - b)
      .map(([page, payload]) => ({ page, rect: null, payload }));
    return { source: "sidecar", pages, legacyOverlayData: null, pdfIssue, writeBlock };
  }
  return {
    source: "none",
    pages: [],
    legacyOverlayData: sidecar.kind === "legacy" ? sidecar.text : null,
    pdfIssue,
    writeBlock,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------------------------------------

/**
 * Markup of a PDF. Embedded data wins (the sidecar is then ignored); otherwise a v1 sidecar is loaded,
 * and anything else in the sidecar is returned raw as `legacyOverlayData` for migration. Orphaned
 * stamps are repaired first when the PDF has no write block (a failed repair is logged, not fatal).
 */
export function loadMarkupFromFile(pdfPath: string): Promise<LoadMarkupResult> {
  return serialized(pdfPath, () => loadNow(pdfPath));
}

async function loadNow(pdfPath: string): Promise<LoadMarkupResult> {
  const realPath = await fs.promises.realpath(pdfPath);
  const bytes = await fs.promises.readFile(realPath);
  // `source`, pages and the write block come from the state before the repair: the repair only renames
  // orphans (the valid pages stay), but it writes `meta`, which must not hide a v1 sidecar of a PDF
  // without data.
  const inspection = await inspectPdf(bytes);
  const writeBlock = await writeBlockOf(realPath, bytes, inspection);

  if (writeBlock === null && inspection && !inspection.encrypted && inspection.markup.orphans.length > 0) {
    const expected = expectedFromMarkup(inspection.markup);
    try {
      const repaired = await buildMarkedPdf(bytes, []);
      await atomicReplace(realPath, repaired, (written) => verifyPages(written, expected));
    } catch (e) {
      console.warn("Could not repair orphaned markup stamps", e);
    }
  }

  if (hasEmbeddedData(inspection))
    return {
      source: "pdf",
      pages: toLoadedPages(inspection.markup),
      legacyOverlayData: null,
      pdfIssue: null,
      writeBlock,
    };
  const pdfIssue = inspection === null ? "unparseable" : inspection.encrypted ? "encrypted" : null;
  return loadSidecar(pdfPath, pdfIssue, writeBlock);
}

/**
 * Why markup cannot be saved into this PDF; null = it can. Writes nothing but the folder probe. Never
 * throws: a file that cannot be read is `unparseable` (with the error as `message`).
 */
export function checkMarkupWritable(pdfPath: string): Promise<WriteBlock | null> {
  return serialized(pdfPath, async () => {
    let realPath: string;
    let bytes: Uint8Array;
    try {
      realPath = await fs.promises.realpath(pdfPath);
      bytes = await fs.promises.readFile(realPath);
    } catch (e) {
      return { reason: "unparseable", message: errorMessage(e) };
    }
    return writeBlockOf(realPath, bytes, await inspectPdf(bytes));
  });
}

// ---------------------------------------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------------------------------------

/**
 * Saves the changed pages (`payload: null` removes a page's markup). Never throws: failures come back as
 * `{ status: "error", message }` with the PDF unchanged. Saves of the same file run one after another.
 */
export function saveMarkupToFile(input: SaveMarkupInput): Promise<SaveMarkupResult> {
  return serialized(input.path, () => saveNow(input, false));
}

/**
 * `saveMarkupToFile` without replacing the PDF or touching a sidecar; `{ status: "pdf" }` = would be
 * saved. Builds the update in memory and verifies it as a save verifies the written file; where a save
 * would fall back to the sidecar, this reports an error with the reason. Writes nothing but the folder probe.
 */
export function trySaveMarkupToFile(input: SaveMarkupInput): Promise<SaveMarkupResult> {
  return serialized(input.path, () => saveNow(input, true));
}

async function saveNow(input: SaveMarkupInput, dryRun: boolean): Promise<SaveMarkupResult> {
  /** The PDF cannot be written: the sidecar fallback, or in the trial an error with the reason. */
  const notIntoPdf = async (inspection: Inspection | null, reason: SaveFailureReason): Promise<SaveMarkupResult> =>
    dryRun
      ? { status: "error", message: `The markup cannot be saved into the PDF (${reason}).`, reason }
      : fallback(input, inspection, reason);

  try {
    const realPath = await fs.promises.realpath(input.path);
    const bytes = await fs.promises.readFile(realPath);
    const inspection = await inspectPdf(bytes);

    // Unparseable: no embedded data can be known (load then uses the sidecar too), the PDF stays untouched.
    if (!inspection) return await notIntoPdf(inspection, "unparseable");
    if (inspection.encrypted) return await notIntoPdf(inspection, "encrypted");
    if (!(await isWritable(realPath))) return await notIntoPdf(inspection, "readOnly");
    if (await mustStayInSidecar(input, inspection)) return await notIntoPdf(inspection, "other");

    const changes: PageChange[] = input.pages.map(({ page, payload, pngBase64 }) => ({
      page,
      payload,
      png: pngBase64 === null ? null : decodePng(pngBase64),
    }));
    const expected = expectedFromMarkup(inspection.markup);
    for (const { page, payload } of input.pages) {
      if (payload) expected.set(page, expectedPayload(payload));
      else expected.delete(page);
    }
    let marked: Uint8Array;
    try {
      marked = await buildMarkedPdf(bytes, changes);
      if (dryRun) await verifyPages(marked, expected);
    } catch (e) {
      if (e instanceof EncryptedPDFError) return await notIntoPdf({ encrypted: true }, "encrypted");
      // The file's structure (or the request, e.g. a page the PDF lacks) does not allow the update.
      return { status: "error", message: errorMessage(e), reason: "structure" };
    }
    if (dryRun) return { status: "pdf" };

    try {
      await atomicReplace(realPath, marked, (written) => verifyPages(written, expected));
    } catch (e) {
      // Still locked after the retries (spec section 1): a PDF without embedded data falls back to the
      // sidecar, which the migration picks up later; with embedded data the error is reported.
      if (isLockedError(e) && !hasEmbeddedData(inspection)) return await fallback(input, inspection, "locked");
      throw e;
    }

    if (input.deleteLegacySidecar) {
      // A sidecar that stays (held by a sync client for a moment) would later look like a conflict.
      const sidecarPath = getSidecarPath(input.path);
      await retryWhileLocked(() => fs.promises.rm(sidecarPath, { force: true })).catch((e: unknown) => {
        console.warn("Could not delete the legacy markup sidecar", e);
      });
    }
    return { status: "pdf" };
  } catch (e) {
    return { status: "error", message: errorMessage(e), reason: failureReason(e) };
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
async function fallback(
  input: SaveMarkupInput,
  inspection: Inspection | null,
  reason: SaveFailureReason,
): Promise<SaveMarkupResult> {
  if (hasEmbeddedData(inspection))
    return {
      status: "error",
      message: "The PDF already contains markup but cannot be written (read-only?).",
      reason,
    };
  await writeSidecar(input);
  return { status: "sidecar", reason };
}

// ---------------------------------------------------------------------------------------------------------
// Migration of a legacy sidecar
// ---------------------------------------------------------------------------------------------------------

/**
 * Moves one sidecar, converted to `pages` by the renderer, into its PDF as one checked step (spec sections
 * 4 and 5); the migration's dry run and its real pass both call this per file. Only the pages with a
 * payload count. A PDF with embedded data is compared with them: exactly these pages → `alreadyMigrated`,
 * anything else → `conflict`. Otherwise the update is built and verified, in a dry run in memory only,
 * else written atomically with a read-back. The sidecar is deleted only after that (or when already
 * migrated), never in a dry run; one that stays is `sidecarNotDeleted`. Never writes a sidecar or falls
 * back to one, never throws. Calls for the same file run one after another.
 */
export function migrateSidecarToFile(input: MigrateSidecarInput): Promise<MigrateSidecarResult> {
  return serialized(input.path, () => migrateNow(input));
}

async function migrateNow({ path: pdfPath, pages, dryRun }: MigrateSidecarInput): Promise<MigrateSidecarResult> {
  try {
    const changes: PageChange[] = [];
    const expected: ExpectedPages = new Map();
    for (const { page, payload, pngBase64 } of pages) {
      if (!payload) continue;
      changes.push({ page, payload, png: pngBase64 === null ? null : decodePng(pngBase64) });
      expected.set(page, expectedPayload(payload));
    }
    if (changes.length === 0)
      return { status: "error", reason: "other", message: "The legacy markup file has no page with markup." };

    const realPath = await fs.promises.realpath(pdfPath);
    const bytes = await fs.promises.readFile(realPath);
    const inspection = await inspectPdf(bytes);
    // No probe stamp here: the real pages are built right below.
    const cheap = await cheapWriteBlockOf(realPath, inspection);
    if (cheap.block)
      return {
        status: "error",
        reason: cheap.block.reason,
        message: cheap.block.message ?? `The markup cannot be saved into the PDF (${cheap.block.reason}).`,
      };

    if (hasEmbeddedData(inspection)) {
      const mismatch = pagesMismatch(cheap.markup.pages, expected);
      if (mismatch !== null)
        return { status: "error", reason: "conflict", message: `The PDF already contains other markup: ${mismatch}.` };
      const already: MigrateSidecarResult = { status: "alreadyMigrated" };
      return dryRun ? already : await deleteMigratedSidecar(pdfPath, already);
    }

    let marked: Uint8Array;
    try {
      marked = await buildMarkedPdf(bytes, changes);
      if (dryRun) await verifyPages(marked, expected);
    } catch (e) {
      // The file's structure (or the request, e.g. a page the PDF lacks) does not allow the update.
      const reason = e instanceof EncryptedPDFError ? "encrypted" : "structure";
      return { status: "error", reason, message: errorMessage(e) };
    }
    if (dryRun) return { status: "migrated" };

    await atomicReplace(realPath, marked, (written) => verifyPages(written, expected));
    return await deleteMigratedSidecar(pdfPath, { status: "migrated" });
  } catch (e) {
    return { status: "error", reason: failureReason(e), message: errorMessage(e) };
  }
}

/** Deletes the sidecar whose markup the PDF holds (retried while locked); `done` once it is gone. */
async function deleteMigratedSidecar(pdfPath: string, done: MigrateSidecarResult): Promise<MigrateSidecarResult> {
  try {
    await retryWhileLocked(() => fs.promises.rm(getSidecarPath(pdfPath), { force: true }));
    return done;
  } catch (e) {
    return { status: "error", reason: "sidecarNotDeleted", message: errorMessage(e) };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Empty legacy sidecars
// ---------------------------------------------------------------------------------------------------------

/**
 * Deletes the sidecar of `pdfPath` if it holds no markup (`readSidecarContent` says `empty`: also a v1
 * file without pages). Never reads or writes the PDF. Sidecars with markup and unreadable files are kept.
 */
export function discardEmptyLegacySidecar(pdfPath: string): Promise<{ deleted: boolean }> {
  return serialized(pdfPath, async () => {
    if ((await readSidecarContent(pdfPath)).kind !== "empty") return { deleted: false };
    await fs.promises.rm(getSidecarPath(pdfPath), { force: true });
    return { deleted: true };
  });
}
