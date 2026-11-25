/**
 * Settings stored in the sheet folder (main; spec 2026-11-22 "folder config"): `.config.json` holds the set
 * lists, the mark that the folder's markup is migrated and per sheet the page dividers (`sheets`, spec
 * 2026-11-23), so every PC that syncs the folder sees the same.
 * A file that cannot be read, is not JSON or breaks the schema is `unreadable` and never overwritten, and so
 * is a sheet folder that does not exist (drive asleep, unplugged); only a missing file counts as empty.
 * Writes change only the given parts on the state read fresh from disk, keep every other field (also ones a
 * newer version wrote), go through a temp file and a rename, and are skipped when the content would not
 * change; a set-list save writes only while the set lists on disk are the ones it was based on. A legacy
 * `.set-lists.json` is taken over into `.config.json` and deleted only after the written file was read back.
 * No Electron imports: this module is unit-tested in Node.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  type SetList,
  type SetListSheet,
  type SetListsWrapper,
  setListsWrapperSchema,
  type SetListV1,
} from "./models/types";
import type { Fingerprint } from "./pdfFingerprint";
import { retryWhileLocked } from "./pdfMarkup/lockRetry";

export const CONFIG_FILE = ".config.json";
export const LEGACY_SET_LISTS_FILE = ".set-lists.json";

export const folderConfigSchema = z
  .object({
    version: z.literal(1),
    setLists: setListsWrapperSchema.optional(),
    markupMigrated: z.object({ at: z.string() }).loose().optional(),
    sheets: z
      .record(
        z.string(),
        z
          .object({
            pageDividers: z.record(z.string(), z.number()).optional(),
            favorite: z.boolean().optional(),
            fingerprint: z.object({ sha256: z.string(), length: z.number() }).loose().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();
export type FolderConfig = z.infer<typeof folderConfigSchema>;
export type SheetEntry = NonNullable<FolderConfig["sheets"]>[string];

export type FolderConfigRead =
  | { kind: "missing" }
  | { kind: "ok"; config: FolderConfig }
  /**
   * `file`: basename of the file that could not be read (`.config.json` or `.set-lists.json`).
   * `newerVersion`: it breaks the schema and states a newer `version` (or `setLists.version`) than this app
   * knows; the remedy is to update the app, not to delete the file.
   */
  | { kind: "unreadable"; file: string; message: string; newerVersion?: true };

/** The message when the sheet folder itself does not exist or is not a folder. */
export const FOLDER_UNREACHABLE_MESSAGE = "Der Notenordner ist nicht erreichbar.";

/** A settings file that cannot be read; `file` is its basename, `message` the reason. */
export class FolderConfigUnreadableError extends Error {
  readonly file: string;
  constructor(file: string, message: string) {
    super(message);
    this.name = "FolderConfigUnreadableError";
    this.file = file;
  }
}

/** The set lists on disk are not the ones the caller based its change on (another PC changed them). */
export class FolderConfigChangedError extends Error {
  constructor() {
    super(`The set lists in ${CONFIG_FILE} were changed in the meantime`);
    this.name = "FolderConfigChangedError";
  }
}

export type FolderConfigPatch = {
  setLists?: SetListsWrapper;
  markupMigrated?: { at: string };
  /** Sets (`ratio` number) or removes (`ratio` null) one divider; `sheet` is a sheetKey, `page` the page left. */
  pageDivider?: { sheet: string; page: number; ratio: number | null };
  /**
   * Changes one sheet entry (`key` is a sheetKey). Applied in this order: `moveFrom` renames that entry to
   * `key` (only if it exists and `key` has none), then `pageDivider`, then `favorite` (true sets, false
   * removes the field), then `fingerprint` (only on an entry that exists by then). An entry left with
   * nothing but a fingerprint is removed.
   */
  sheet?: {
    key: string;
    moveFrom?: string;
    favorite?: boolean;
    fingerprint?: Fingerprint;
  };
};

export interface FolderConfigUpdateOptions {
  /**
   * Write only if the set lists on disk (`null`: missing file or field) equal these (canonical JSON);
   * otherwise nothing is written and FolderConfigChangedError is thrown.
   */
  expectedSetLists?: SetListsWrapper | null;
}

// ---------------------------------------------------------------------------------------------------------
// Per-folder serialization
// ---------------------------------------------------------------------------------------------------------

const queues = new Map<string, Promise<unknown>>();

/** Runs `task` after every earlier task for the same folder has settled. */
function serialized<T>(folder: string, task: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(folder);
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

type JsonObject = Record<string, unknown>;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errorCode = (e: unknown) => (e instanceof Error && "code" in e ? e.code : undefined);

/** JSON with sorted object keys, so equal data gives equal text whatever the key order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** The text without a leading byte order mark (some Windows editors write one), ready for `JSON.parse`. */
const withoutBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** One line per schema violation, joined, for a message shown to the user. */
const schemaMessage = (error: z.ZodError) => z.prettifyError(error).replace(/\s*\n\s*/g, " ");

/**
 * Reads a text file; `null` at once when it does not exist. A locked file (sync client, virus scanner) is
 * read again for about 3 s; other errors are thrown.
 */
async function readTextIfExists(file: string): Promise<string | null> {
  try {
    return await retryWhileLocked(() => fs.promises.readFile(file, "utf8"));
  } catch (e) {
    if (errorCode(e) === "ENOENT") return null;
    throw e;
  }
}

/**
 * Replaces `target` atomically: writes `.<name>.smv-tmp` in the same folder (flushed to disk, with the
 * target's permissions), lets `verify` check the text read back from it, then renames it over `target`.
 * Opening the temp file, reading it back and the rename are retried while the file is locked. On any
 * failure the temp file is removed and `target` is untouched.
 */
async function atomicReplace(target: string, text: string, verify: (written: string) => void): Promise<void> {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.smv-tmp`);
  try {
    const mode = await fs.promises.stat(target).then(
      (s) => s.mode & 0o777,
      () => null,
    );
    const handle = await retryWhileLocked(() => fs.promises.open(temp, "w"));
    try {
      await handle.writeFile(text, "utf8");
      if (mode !== null) await handle.chmod(mode).catch(() => undefined);
      await handle.sync();
    } finally {
      await handle.close();
    }
    verify(await retryWhileLocked(() => fs.promises.readFile(temp, "utf8")));
    await retryWhileLocked(() => fs.promises.rename(temp, target));
  } catch (e) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** Throws unless `text` is JSON with exactly the content `expected` (canonical JSON). */
function checkWritten(text: string, expected: string, file: string): void {
  if (canonicalJson(JSON.parse(text)) !== expected) throw new Error(`${file} reads back with other content`);
}

/** Writes `raw` as `.config.json`, then reads the file back (retried while locked); throws if anything fails. */
async function writeConfig(folder: string, raw: JsonObject): Promise<void> {
  const target = path.join(folder, CONFIG_FILE);
  const expected = canonicalJson(raw);
  await atomicReplace(target, `${JSON.stringify(raw, null, 2)}\n`, (written) =>
    checkWritten(written, expected, CONFIG_FILE),
  );
  checkWritten(await retryWhileLocked(() => fs.promises.readFile(target, "utf8")), expected, CONFIG_FILE);
}

/** Deletes `.set-lists.json` after its takeover; a failure is logged (the config wins from now on). */
async function deleteLegacy(folder: string): Promise<void> {
  const legacy = path.join(folder, LEGACY_SET_LISTS_FILE);
  try {
    await retryWhileLocked(() => fs.promises.rm(legacy));
  } catch (e) {
    console.warn(`Could not delete ${LEGACY_SET_LISTS_FILE} after its takeover in ${folder}:`, e);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------

/**
 * What is on disk. `raw` is the JSON as read (validated, with every field, also unknown ones inside the
 * set lists), the base for a write; `config` is the schema-parsed view. `legacy`: `.config.json` is missing
 * and `raw` was built from `.set-lists.json`, which still has to be written and deleted.
 */
type DiskState =
  | { kind: "missing" }
  | { kind: "ok" | "legacy"; raw: JsonObject; config: FolderConfig }
  | { kind: "unreadable"; file: string; message: string; newerVersion?: true };

const unreadable = (file: string, message: string) => ({ kind: "unreadable", file, message }) as const;

const isObject = (v: unknown): v is JsonObject => v !== null && typeof v === "object" && !Array.isArray(v);

/** `raw` states a newer format than this app knows: `version` above 1 or `setLists.version` above 2. */
function isNewerVersion(raw: unknown): boolean {
  const above = (v: unknown, known: number) => typeof v === "number" && v > known;
  return isObject(raw) && (above(raw.version, 1) || (isObject(raw.setLists) && above(raw.setLists.version, 2)));
}

/** The state for `raw` that breaks the schema; marked when it comes from a newer version of the app. */
function schemaViolation(file: string, raw: unknown, error: z.ZodError): DiskState {
  const state = unreadable(file, schemaMessage(error));
  return isNewerVersion(raw) ? { ...state, newerVersion: true } : state;
}

async function readDisk(folder: string): Promise<DiskState> {
  // A folder that is gone for a moment must not look like a folder without settings.
  let folderStat: fs.Stats | null;
  try {
    folderStat = await fs.promises.stat(folder);
  } catch (e) {
    if (errorCode(e) !== "ENOENT" && errorCode(e) !== "ENOTDIR") return unreadable(CONFIG_FILE, errorMessage(e));
    folderStat = null;
  }
  if (!folderStat?.isDirectory()) return unreadable(CONFIG_FILE, FOLDER_UNREACHABLE_MESSAGE);

  let text: string | null;
  try {
    text = await readTextIfExists(path.join(folder, CONFIG_FILE));
  } catch (e) {
    return unreadable(CONFIG_FILE, errorMessage(e));
  }
  if (text === null) return readLegacy(folder);

  let raw: unknown;
  try {
    raw = JSON.parse(withoutBom(text));
  } catch (e) {
    return unreadable(CONFIG_FILE, errorMessage(e));
  }
  const parsed = folderConfigSchema.safeParse(raw);
  if (!parsed.success) return schemaViolation(CONFIG_FILE, raw, parsed.error);
  return { kind: "ok", raw: raw as JsonObject, config: parsed.data };
}

/** `.config.json` is missing: reads `.set-lists.json` as before (version 1 converted to 2). */
async function readLegacy(folder: string): Promise<DiskState> {
  let setLists: unknown;
  try {
    const text = await readTextIfExists(path.join(folder, LEGACY_SET_LISTS_FILE));
    if (text === null) return { kind: "missing" };
    setLists = JSON.parse(migrateSetListsToV2(withoutBom(text)));
  } catch (e) {
    return unreadable(LEGACY_SET_LISTS_FILE, errorMessage(e));
  }
  const raw: JsonObject = { version: 1, setLists };
  const parsed = folderConfigSchema.safeParse(raw);
  if (!parsed.success) return schemaViolation(LEGACY_SET_LISTS_FILE, raw, parsed.error);
  return { kind: "legacy", raw, config: parsed.data };
}

/** PDF path relative to `folder` with "/"; null if it is not below `folder`. */
export function sheetKey(folder: string, pdfPath: string, pathApi: typeof path.posix = path): string | null {
  const rel = pathApi.relative(pathApi.resolve(folder), pathApi.resolve(pdfPath));
  if (rel === "" || rel === ".." || rel.startsWith(".." + pathApi.sep) || pathApi.isAbsolute(rel)) return null;
  return rel.split(pathApi.sep).join("/");
}

/** Reads the config; takes over `.set-lists.json` when `.config.json` is missing. Never throws. */
export function loadFolderConfig(folder: string): Promise<FolderConfigRead> {
  return serialized(folder, async (): Promise<FolderConfigRead> => {
    const state = await readDisk(folder);
    if (state.kind === "missing" || state.kind === "unreadable") return state;
    if (state.kind === "legacy") {
      try {
        await writeConfig(folder, state.raw);
        await deleteLegacy(folder);
      } catch (e) {
        // The set lists are still readable. If `.config.json` was not written, the takeover is tried again
        // on the next load or update; if it was written but did not read back, it wins from now on and
        // `.set-lists.json` stays (both files: the config wins, the legacy file is left alone).
        console.warn(`Could not take over ${LEGACY_SET_LISTS_FILE} in ${folder}:`, e);
      }
    }
    return { kind: "ok", config: state.config };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------------

/**
 * Sets or removes one divider in `merged.sheets`. Levels are copied, never changed in place (they belong to
 * the state read from disk); empty `pageDividers`, a sheet without other fields and an empty `sheets` go.
 */
function applyPageDivider(merged: JsonObject, { sheet, page, ratio }: NonNullable<FolderConfigPatch["pageDivider"]>) {
  const sheets: JsonObject = isObject(merged.sheets) ? { ...merged.sheets } : {};
  const { pageDividers: oldDividers, ...otherFields } = isObject(sheets[sheet]) ? sheets[sheet] : ({} as JsonObject);
  const dividers: JsonObject = isObject(oldDividers) ? { ...oldDividers } : {};
  if (ratio === null) delete dividers[String(page)];
  else dividers[String(page)] = ratio;

  const entry: JsonObject = { ...otherFields };
  if (Object.keys(dividers).length > 0) entry.pageDividers = dividers;
  if (Object.keys(entry).length > 0) sheets[sheet] = entry;
  else delete sheets[sheet];

  if (Object.keys(sheets).length > 0) merged.sheets = sheets;
  else delete merged.sheets;
}

/** The entry of `sheet` in `merged.sheets`, or undefined. */
const sheetEntry = (merged: JsonObject, sheet: string): JsonObject | undefined => {
  const entry = isObject(merged.sheets) ? merged.sheets[sheet] : undefined;
  return isObject(entry) ? entry : undefined;
};

/** Replaces (`entry`) or removes (`undefined`) one sheet entry; an empty `sheets` goes. Copies, never mutates. */
function setSheetEntry(merged: JsonObject, sheet: string, entry: JsonObject | undefined) {
  const sheets: JsonObject = isObject(merged.sheets) ? { ...merged.sheets } : {};
  if (entry === undefined) delete sheets[sheet];
  else sheets[sheet] = entry;
  if (Object.keys(sheets).length > 0) merged.sheets = sheets;
  else delete merged.sheets;
}

/** Renames the entry `moveFrom` to `key` unchanged; ignored unless `moveFrom` exists and `key` has none. */
function applyMove(merged: JsonObject, key: string, moveFrom: string) {
  const entry = sheetEntry(merged, moveFrom);
  if (entry === undefined || key === moveFrom || sheetEntry(merged, key) !== undefined) return;
  setSheetEntry(merged, moveFrom, undefined);
  setSheetEntry(merged, key, entry);
}

/** Sets or removes `favorite`, then sets `fingerprint` on an existing entry (copies, never mutates). */
function applyFavoriteAndFingerprint(
  merged: JsonObject,
  { key, favorite, fingerprint }: NonNullable<FolderConfigPatch["sheet"]>,
) {
  if (favorite === true) setSheetEntry(merged, key, { ...sheetEntry(merged, key), favorite: true });
  else if (favorite === false && sheetEntry(merged, key) !== undefined) {
    const { favorite: _removed, ...rest } = sheetEntry(merged, key)!;
    setSheetEntry(merged, key, rest);
  }
  const entry = sheetEntry(merged, key);
  if (fingerprint !== undefined && entry !== undefined) setSheetEntry(merged, key, { ...entry, fingerprint });
}

/** Removes the entry of `sheet` when it holds nothing but a fingerprint (or nothing at all). */
function dropEmptyEntry(merged: JsonObject, sheet: string) {
  const entry = sheetEntry(merged, sheet);
  if (entry !== undefined && Object.keys(entry).every((k) => k === "fingerprint"))
    setSheetEntry(merged, sheet, undefined);
}

/**
 * Sets the given parts (others and unknown fields kept); reads fresh, writes atomically, skips unchanged
 * content. A folder with only `.set-lists.json` is taken over in the same write. Throws
 * FolderConfigUnreadableError for an unreadable file, FolderConfigChangedError when `expectedSetLists`
 * does not match, and I/O errors as they are.
 * `patch` may be a function: it runs inside the serialized step on the freshly read config (`null` when the
 * file is missing) and returns the patch, or `null` to write nothing; a throw rejects without writing.
 * Apply order of one write: `sheet.moveFrom`, `pageDivider`, `sheet.favorite`, `sheet.fingerprint`, then an
 * entry touched by this write that holds nothing but a fingerprint is removed (and an empty `sheets`).
 */
export function updateFolderConfig(
  folder: string,
  patch:
    | FolderConfigPatch
    | ((current: FolderConfig | null) => Promise<FolderConfigPatch | null> | FolderConfigPatch | null),
  options: FolderConfigUpdateOptions = {},
): Promise<void> {
  return serialized(folder, async () => {
    const state = await readDisk(folder);
    if (state.kind === "unreadable") throw new FolderConfigUnreadableError(state.file, state.message);
    if (options.expectedSetLists !== undefined) {
      const onDisk = state.kind === "missing" ? null : (state.raw.setLists ?? null);
      if (canonicalJson(onDisk) !== canonicalJson(options.expectedSetLists)) throw new FolderConfigChangedError();
    }

    // A patch function runs here, on the state just read; null means nothing to write.
    const resolved = typeof patch === "function" ? await patch(state.kind === "missing" ? null : state.config) : patch;
    if (resolved === null) return;

    const base: JsonObject = state.kind === "missing" ? { version: 1 } : state.raw;
    const merged: JsonObject = { ...base };
    if (resolved.setLists !== undefined) merged.setLists = resolved.setLists;
    if (resolved.markupMigrated !== undefined) {
      // Merged into an existing mark, so fields a newer version wrote into it stay.
      const previous = isObject(base.markupMigrated) ? base.markupMigrated : {};
      merged.markupMigrated = { ...previous, ...resolved.markupMigrated };
    }
    if (resolved.sheet?.moveFrom !== undefined) applyMove(merged, resolved.sheet.key, resolved.sheet.moveFrom);
    if (resolved.pageDivider !== undefined) applyPageDivider(merged, resolved.pageDivider);
    if (resolved.sheet !== undefined) applyFavoriteAndFingerprint(merged, resolved.sheet);
    if (resolved.sheet !== undefined) dropEmptyEntry(merged, resolved.sheet.key);
    if (resolved.pageDivider !== undefined) dropEmptyEntry(merged, resolved.pageDivider.sheet);
    const valid = folderConfigSchema.safeParse(merged);
    if (!valid.success) throw new Error(`Invalid ${CONFIG_FILE} content: ${schemaMessage(valid.error)}`);

    if (state.kind !== "legacy" && canonicalJson(merged) === canonicalJson(base)) return;
    await writeConfig(folder, merged);
    if (state.kind === "legacy") await deleteLegacy(folder);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Legacy set lists
// ---------------------------------------------------------------------------------------------------------

/** Converts the text of a version 1 set list file (a plain array) to version 2; other text is returned as is. */
export function migrateSetListsToV2(setListsJson: string): string {
  const unsaveParsedSetLists = JSON.parse(setListsJson);

  if (Array.isArray(unsaveParsedSetLists)) {
    const setListsV1 = unsaveParsedSetLists as SetListV1[];
    const setListsV2: SetListsWrapper = {
      version: 2,
      setLists: setListsV1.map<SetList>((setList) => {
        return {
          ...setList,
          sheets: setList.sheets.map<SetListSheet>((sheet) => {
            return {
              ...sheet,
              path: sheet.path.split(sheet.path.charAt(0)).filter((v) => !!v),
            };
          }),
        };
      }),
    };
    return JSON.stringify(setListsV2);
  } else {
    return setListsJson;
  }
}
