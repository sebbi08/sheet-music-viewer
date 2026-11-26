/**
 * File layer of the markup feature, used by the Electron main process (spec 2026-11-20, sections 7 and 8):
 * markup is loaded from and saved into the PDF only, written atomically (temp file in the same folder,
 * verified, then renamed). A PDF that cannot be written (encrypted, unparseable, read-only, a structure the
 * writer cannot update, still locked after the retries) is a save error and stays byte-identical; this
 * module never writes a `.data` file, and loading never reads one. Loading only parses the PDF; why a PDF
 * cannot take markup at all is its write block, determined by a separate check (`checkMarkupOnOpen` for the
 * viewer, which also repairs orphaned stamps, `checkMarkupWritable` for the migration); the result of the
 * trial build is remembered per content (`setWriteCheckCache`). Legacy `.data` files are only
 * handled for the migration gate: `migrateSidecarToFile` moves one into its PDF, `discardEmptyLegacySidecar`
 * deletes one without markup. No Electron imports: this module is unit-tested in Node.
 */
import fs from "node:fs";
import path from "node:path";
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import {
  markupPayloadSchema,
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
import { isLockedError, retryWhileLocked, setLockRetryDelays } from "./lockRetry";
import { readMarkup, type ReadMarkupResult } from "./readMarkup";
import { contentKey, type CachedWriteCheck, type WriteCheckCache } from "./writeCheckCache";

export { getSidecarPath, legacySidecarHasMarkup, retryWhileLocked, setLockRetryDelays };

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
// Remembered trial builds
// ---------------------------------------------------------------------------------------------------------

let writeCheckCache: WriteCheckCache | null = null;

/**
 * Sets where the results of trial builds are remembered, keyed by the PDF's content (`contentKey`);
 * `null` (the default) remembers nothing.
 */
export function setWriteCheckCache(cache: WriteCheckCache | null): void {
  writeCheckCache = cache;
}

/** The remembered trial result for `key`; a cache that fails counts as a miss. */
async function rememberedCheck(key: string): Promise<CachedWriteCheck | undefined> {
  try {
    return await writeCheckCache?.get(key);
  } catch (e) {
    console.warn("Could not read the markup write check cache", e);
    return undefined;
  }
}

/** Remembers a trial result (or `ok` for bytes we wrote and read back). Never throws. */
async function remember(key: string, value: CachedWriteCheck): Promise<void> {
  try {
    await writeCheckCache?.set(key, value);
  } catch (e) {
    console.warn("Could not save the markup write check cache", e);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Inspection =
  | { kind: "unparseable"; message: string }
  | { kind: "encrypted" }
  | { kind: "parsed"; markup: ReadMarkupResult };

/** Parses the PDF; `unparseable` with pdf-lib's message if it cannot read it. */
async function inspectPdf(bytes: Uint8Array): Promise<Inspection> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    if (doc.isEncrypted) return { kind: "encrypted" };
    return { kind: "parsed", markup: readMarkup(doc) };
  } catch (e) {
    return { kind: "unparseable", message: errorMessage(e) };
  }
}

/** Embedded data = our stamps or our catalog metadata. */
const hasEmbeddedData = (inspection: Inspection): inspection is Extract<Inspection, { kind: "parsed" }> =>
  inspection.kind === "parsed" && (inspection.markup.pages.length > 0 || inspection.markup.meta !== null);

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
  if (inspection.kind !== "parsed") throw new VerificationError("verification failed: the written PDF is unreadable");
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
async function cheapWriteBlockOf(realPath: string, inspection: Inspection): Promise<CheapCheck> {
  if (inspection.kind === "unparseable") return { block: { reason: "unparseable", message: inspection.message } };
  if (inspection.kind === "encrypted") return { block: { reason: "encrypted" } };
  if (!(await isWritable(realPath))) return { block: { reason: "readOnly" } };
  return { block: null, markup: inspection.markup };
}

/** A save or migration failed on a write block: the error result with its reason (and message, if any). */
const blockedError = (block: WriteBlock) => ({
  status: "error" as const,
  reason: block.reason,
  ...(block.message !== undefined ? { message: block.message } : {}),
});

/**
 * Why markup cannot be saved into the PDF `bytes` read from `realPath`; `null` = it can. The trial build
 * runs only when no result is remembered for exactly these bytes, and its result is remembered;
 * unparseable, encrypted and read-only are determined every time. Never throws.
 */
async function writeBlockOf(
  realPath: string,
  bytes: Uint8Array,
  inspection: Inspection,
): Promise<WriteBlock | null> {
  const cheap = await cheapWriteBlockOf(realPath, inspection);
  if (cheap.block) return cheap.block;
  const key = contentKey(bytes);
  let result = await rememberedCheck(key);
  if (!result) {
    try {
      await trialBuild(bytes, cheap.markup);
      result = { ok: true };
    } catch (e) {
      result = { ok: false, message: errorMessage(e) };
    }
    await remember(key, result);
  }
  return result.ok ? null : { reason: "structure", message: result.message };
}

/** The real path and the bytes of a PDF, or the `unparseable` block of a file that cannot be read. */
async function readForCheck(
  pdfPath: string,
): Promise<{ realPath: string; bytes: Uint8Array; block?: undefined } | { block: WriteBlock }> {
  try {
    const realPath = await fs.promises.realpath(pdfPath);
    return { realPath, bytes: await fs.promises.readFile(realPath) };
  } catch (e) {
    return { block: { reason: "unparseable", message: errorMessage(e) } };
  }
}

const toLoadedPages = (markup: ReadMarkupResult): LoadedMarkupPage[] =>
  markup.pages.map(({ page, rect, payload }) => ({ page, rect, payload }));

/** Accepts plain Base64 as well as a `data:image/png;base64,` URL. */
const decodePng = (base64: string) => new Uint8Array(Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64"));

// ---------------------------------------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------------------------------------

/**
 * Markup of a PDF, from the PDF only: its embedded data (`source: "pdf"`) or none. A `.data` file next to
 * it is never read. Only parses: `writeBlock` is what parsing shows (`encrypted`, `unparseable`), else
 * `null`; no read-only check, no trial build, no repair, never writes (see `checkMarkupOnOpen`).
 */
export function loadMarkupFromFile(pdfPath: string): Promise<LoadMarkupResult> {
  return serialized(pdfPath, () => loadNow(pdfPath));
}

async function loadNow(pdfPath: string): Promise<LoadMarkupResult> {
  const realPath = await fs.promises.realpath(pdfPath);
  const inspection = await inspectPdf(await fs.promises.readFile(realPath));
  const writeBlock: WriteBlock | null =
    inspection.kind === "unparseable"
      ? { reason: "unparseable", message: inspection.message }
      : inspection.kind === "encrypted"
        ? { reason: "encrypted" }
        : null;
  if (hasEmbeddedData(inspection)) return { source: "pdf", pages: toLoadedPages(inspection.markup), writeBlock };
  return { source: "none", pages: [], writeBlock };
}

// ---------------------------------------------------------------------------------------------------------
// Write check
// ---------------------------------------------------------------------------------------------------------

/**
 * The write check of the viewer, run after `loadMarkupFromFile`: why markup cannot be saved into this PDF,
 * `null` = it can (unparseable, encrypted, readOnly, or structure from the remembered or a new trial
 * build). Reads the file itself, so the remembered result belongs to exactly the bytes checked. When the
 * PDF can be written and has orphaned stamps, they are repaired (a failed repair is logged, not fatal) and
 * `ok` is remembered for the repaired bytes; the repair changes nothing visible. Never throws: a file that
 * cannot be read is `unparseable` (with the error as `message`).
 */
export function checkMarkupOnOpen(pdfPath: string): Promise<WriteBlock | null> {
  return serialized(pdfPath, async () => {
    const read = await readForCheck(pdfPath);
    if (read.block) return read.block;
    const { realPath, bytes } = read;
    const inspection = await inspectPdf(bytes);
    const block = await writeBlockOf(realPath, bytes, inspection);
    if (block === null && inspection.kind === "parsed" && inspection.markup.orphans.length > 0)
      await repairOrphans(realPath, bytes, inspection.markup);
    return block;
  });
}

/**
 * Renames the orphaned stamps of the PDF `bytes` (the valid pages stay) and writes our catalog metadata,
 * atomically with a read-back; remembers `ok` for the written bytes. A failure is logged only.
 */
async function repairOrphans(realPath: string, bytes: Uint8Array, markup: ReadMarkupResult): Promise<void> {
  const expected = expectedFromMarkup(markup);
  try {
    const repaired = await buildMarkedPdf(bytes, []);
    await atomicReplace(realPath, repaired, (written) => verifyPages(written, expected));
    await remember(contentKey(repaired), { ok: true });
  } catch (e) {
    console.warn("Could not repair orphaned markup stamps", e);
  }
}

/**
 * Why markup cannot be saved into this PDF; null = it can. The same check as `checkMarkupOnOpen` (through
 * the remembered trial results) but without the repair: writes nothing but the folder probe (and the
 * cache). Never throws: a file that cannot be read is `unparseable` (with the error as `message`).
 */
export function checkMarkupWritable(pdfPath: string): Promise<WriteBlock | null> {
  return serialized(pdfPath, async () => {
    const read = await readForCheck(pdfPath);
    if (read.block) return read.block;
    return writeBlockOf(read.realPath, read.bytes, await inspectPdf(read.bytes));
  });
}

// ---------------------------------------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------------------------------------

/**
 * Saves the changed pages into the PDF (`payload: null` removes a page's markup). Never throws: failures
 * come back as `{ status: "error", reason, message }` with the PDF unchanged and no other file written
 * (encrypted, unparseable, readOnly, structure, or locked when the PDF stays locked after the retries).
 * Saves of the same file run one after another.
 */
export function saveMarkupToFile(input: SaveMarkupInput): Promise<SaveMarkupResult> {
  return serialized(input.path, () => saveNow(input));
}

async function saveNow(input: SaveMarkupInput): Promise<SaveMarkupResult> {
  try {
    const realPath = await fs.promises.realpath(input.path);
    const bytes = await fs.promises.readFile(realPath);
    // No probe stamp here: the real pages are built right below.
    const cheap = await cheapWriteBlockOf(realPath, await inspectPdf(bytes));
    if (cheap.block) return blockedError(cheap.block);

    const changes: PageChange[] = input.pages.map(({ page, payload, pngBase64 }) => ({
      page,
      payload,
      png: pngBase64 === null ? null : decodePng(pngBase64),
    }));
    const expected = expectedFromMarkup(cheap.markup);
    for (const { page, payload } of input.pages) {
      if (payload) expected.set(page, expectedPayload(payload));
      else expected.delete(page);
    }
    let marked: Uint8Array;
    try {
      marked = await buildMarkedPdf(bytes, changes);
    } catch (e) {
      // The file's structure (or the request, e.g. a page the PDF lacks) does not allow the update.
      const reason = e instanceof EncryptedPDFError ? "encrypted" : "structure";
      return { status: "error", message: errorMessage(e), reason };
    }
    await atomicReplace(realPath, marked, (written) => verifyPages(written, expected));
    // The save built an update and read it back: the file takes markup.
    await remember(contentKey(marked), { ok: true });
    return { status: "pdf" };
  } catch (e) {
    return { status: "error", message: errorMessage(e), reason: failureReason(e) };
  }
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
    if (cheap.block) return blockedError(cheap.block);

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
 * file without pages; retried while locked). Never reads or writes the PDF. Sidecars with markup and
 * unreadable files are kept.
 */
export function discardEmptyLegacySidecar(pdfPath: string): Promise<{ deleted: boolean }> {
  return serialized(pdfPath, async () => {
    if ((await readSidecarContent(pdfPath)).kind !== "empty") return { deleted: false };
    await retryWhileLocked(() => fs.promises.rm(getSidecarPath(pdfPath), { force: true }));
    return { deleted: true };
  });
}
