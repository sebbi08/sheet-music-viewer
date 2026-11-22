/**
 * Settings stored in the sheet folder (main; spec 2026-11-22 "folder config"): `.config.json` holds the set
 * lists and the mark that the folder's markup is migrated, so every PC that syncs the folder sees the same.
 * A file that cannot be read, is not JSON or breaks the schema is `unreadable` and never overwritten; only a
 * missing file counts as empty. Writes change only the given parts on the state read fresh from disk, keep
 * every other field (also ones a newer version wrote), go through a temp file and a rename, and are skipped
 * when the content would not change. A legacy `.set-lists.json` is taken over into `.config.json` and
 * deleted only after the written file was read back. No Electron imports: this module is unit-tested in Node.
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
import { retryWhileLocked } from "./pdfMarkup/lockRetry";

export const CONFIG_FILE = ".config.json";
export const LEGACY_SET_LISTS_FILE = ".set-lists.json";

export const folderConfigSchema = z
  .object({
    version: z.literal(1),
    setLists: setListsWrapperSchema.optional(),
    markupMigrated: z.object({ at: z.string() }).passthrough().optional(),
  })
  .passthrough();
export type FolderConfig = z.infer<typeof folderConfigSchema>;

export type FolderConfigRead =
  | { kind: "missing" }
  | { kind: "ok"; config: FolderConfig }
  /** `file`: basename of the file that could not be read (`.config.json` or `.set-lists.json`). */
  | { kind: "unreadable"; file: string; message: string };

/** A settings file that cannot be read; `file` is its basename, `message` the reason. */
export class FolderConfigUnreadableError extends Error {
  readonly file: string;
  constructor(file: string, message: string) {
    super(message);
    this.name = "FolderConfigUnreadableError";
    this.file = file;
  }
}

export type FolderConfigPatch = { setLists?: SetListsWrapper; markupMigrated?: { at: string } };

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
 * Opening the temp file and the rename are retried while the file is locked. On any failure the temp file
 * is removed and `target` is untouched.
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
    verify(await fs.promises.readFile(temp, "utf8"));
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

/** Writes `raw` as `.config.json`, then reads the file back; throws if anything fails. */
async function writeConfig(folder: string, raw: JsonObject): Promise<void> {
  const target = path.join(folder, CONFIG_FILE);
  const expected = canonicalJson(raw);
  await atomicReplace(target, `${JSON.stringify(raw, null, 2)}\n`, (written) =>
    checkWritten(written, expected, CONFIG_FILE),
  );
  checkWritten(await fs.promises.readFile(target, "utf8"), expected, CONFIG_FILE);
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
  | { kind: "unreadable"; file: string; message: string };

const unreadable = (file: string, message: string) => ({ kind: "unreadable", file, message }) as const;

async function readDisk(folder: string): Promise<DiskState> {
  let text: string | null;
  try {
    text = await readTextIfExists(path.join(folder, CONFIG_FILE));
  } catch (e) {
    return unreadable(CONFIG_FILE, errorMessage(e));
  }
  if (text === null) return readLegacy(folder);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return unreadable(CONFIG_FILE, errorMessage(e));
  }
  const parsed = folderConfigSchema.safeParse(raw);
  if (!parsed.success) return unreadable(CONFIG_FILE, schemaMessage(parsed.error));
  return { kind: "ok", raw: raw as JsonObject, config: parsed.data };
}

/** `.config.json` is missing: reads `.set-lists.json` as before (version 1 converted to 2). */
async function readLegacy(folder: string): Promise<DiskState> {
  let setLists: unknown;
  try {
    const text = await readTextIfExists(path.join(folder, LEGACY_SET_LISTS_FILE));
    if (text === null) return { kind: "missing" };
    setLists = JSON.parse(migrateSetListsToV2(text));
  } catch (e) {
    return unreadable(LEGACY_SET_LISTS_FILE, errorMessage(e));
  }
  const raw: JsonObject = { version: 1, setLists };
  const parsed = folderConfigSchema.safeParse(raw);
  if (!parsed.success) return unreadable(LEGACY_SET_LISTS_FILE, schemaMessage(parsed.error));
  return { kind: "legacy", raw, config: parsed.data };
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
        // The set lists are still readable; the takeover is tried again on the next load or update.
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
 * Sets the given parts (others and unknown fields kept); reads fresh, writes atomically, skips unchanged
 * content. A folder with only `.set-lists.json` is taken over in the same write. Throws
 * FolderConfigUnreadableError for an unreadable file, and I/O errors as they are.
 */
export function updateFolderConfig(folder: string, patch: FolderConfigPatch): Promise<void> {
  return serialized(folder, async () => {
    const state = await readDisk(folder);
    if (state.kind === "unreadable") throw new FolderConfigUnreadableError(state.file, state.message);

    const base: JsonObject = state.kind === "missing" ? { version: 1 } : state.raw;
    const merged: JsonObject = { ...base };
    if (patch.setLists !== undefined) merged.setLists = patch.setLists;
    if (patch.markupMigrated !== undefined) merged.markupMigrated = patch.markupMigrated;
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
