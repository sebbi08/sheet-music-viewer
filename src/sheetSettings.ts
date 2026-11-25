/**
 * Settings of one sheet in the folder's `.config.json` (main; spec 2026-11-25 "favorites"): favorite and page
 * dividers, keyed by the path, with the fingerprint of the PDF's original bytes so an entry can follow a
 * moved or renamed PDF ("Umzug eines Eintrags"). An entry moves from A to B only when A is an orphan (it has
 * a fingerprint and `stat` reports A as not existing), B has no entry of its own, B's fingerprint equals A's
 * and no other orphan has it; or when A is B spelled in another case (same file, A's spelling no longer
 * listed). Nothing moves while the sheet folder is unreachable or a `stat` fails otherwise. Opening a sheet or
 * the main page writes `.config.json` only when an entry moves, and reads a PDF only when there are orphans.
 * No Electron imports: this module is unit-tested in Node.
 */
import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_FILE,
  FolderConfigUnreadableError,
  type FolderConfigPatch,
  loadFolderConfig,
  type SheetEntry,
  sheetKey,
  updateFolderConfig,
} from "./folderConfig";
import type { PageDividers } from "./pageDivider";
import { type Fingerprint, fingerprintFile } from "./pdfFingerprint";
import { walkSheetPdfs } from "./sheetFiles";

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errorCode = (e: unknown) => (e instanceof Error && "code" in e ? e.code : undefined);

/** The file of a sheetKey below `folder`. */
const fileOf = (folder: string, key: string) => path.join(folder, ...key.split("/"));

const sameFingerprint = (a: Fingerprint, b: Fingerprint) => a.sha256 === b.sha256 && a.length === b.length;

/** The fingerprint of `file`, or null when it cannot be read (locked, gone). */
async function fingerprintOrNull(file: string): Promise<Fingerprint | null> {
  try {
    return await fingerprintFile(file);
  } catch {
    return null;
  }
}

/** The result of an unexpected failure, worded like an unreadable `.config.json`. */
const unexpected = (e: unknown) => ({ kind: "unreadable", file: CONFIG_FILE, message: errorMessage(e) }) as const;

// ---------------------------------------------------------------------------------------------------------
// Move rules
// ---------------------------------------------------------------------------------------------------------

export type PathState = "exists" | "missing" | "unknown";

/**
 * Whether `file` exists; "missing" only when `stat` says so (ENOENT/ENOTDIR), any other error is "unknown".
 * With `folder` (the sheet folder above `file`), a missing file behind a link or junction between `folder`
 * and `file` whose target cannot be reached (a drive asleep or unplugged) is "unknown", too.
 */
export async function pathState(file: string, folder?: string): Promise<PathState> {
  try {
    await fs.promises.stat(file);
    return "exists";
  } catch (e) {
    const code = errorCode(e);
    if (code !== "ENOENT" && code !== "ENOTDIR") return "unknown";
  }
  return folder !== undefined && (await isBehindOfflineLink(folder, file)) ? "unknown" : "missing";
}

/**
 * Whether a path below `folder` on the way to `file` (the file itself included) is a link whose target
 * `stat` cannot reach. A part that does not exist ends the walk: the file is really missing.
 */
async function isBehindOfflineLink(folder: string, file: string): Promise<boolean> {
  const rel = path.relative(folder, file);
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return false;
  let current = folder;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    try {
      if (!(await fs.promises.lstat(current)).isSymbolicLink()) continue;
    } catch (e) {
      const code = errorCode(e);
      return code !== "ENOENT" && code !== "ENOTDIR";
    }
    try {
      await fs.promises.stat(current);
    } catch {
      return true;
    }
  }
  return false;
}

async function isReachableFolder(folder: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

/** Whether `name` is listed in `dir` exactly so; an unreadable folder counts as listed (nothing moves). */
async function isListed(dir: string, name: string): Promise<boolean> {
  try {
    return (await fs.promises.readdir(dir)).includes(name);
  } catch {
    return true;
  }
}

/**
 * Whether the entry `old` is `target` renamed only in case: the keys differ only in case, both paths `stat`
 * to the same file (`dev` + `ino`), and every spelling of `old` that differs from `target` is no longer
 * listed in its folder (a link under a second name is listed, so it never counts).
 */
async function isCaseOnlyRename(folder: string, old: string, target: string): Promise<boolean> {
  const oldParts = old.split("/");
  const targetParts = target.split("/");
  if (old === target || oldParts.length !== targetParts.length) return false;
  if (oldParts.some((part, i) => part.toLowerCase() !== targetParts[i].toLowerCase())) return false;
  try {
    const [a, b] = await Promise.all([fs.promises.stat(fileOf(folder, old)), fs.promises.stat(fileOf(folder, target))]);
    if (a.dev !== b.dev || a.ino !== b.ino) return false;
  } catch {
    return false;
  }
  for (let i = 0; i < oldParts.length; i++) {
    if (oldParts[i] === targetParts[i]) continue;
    if (await isListed(fileOf(folder, targetParts.slice(0, i).join("/")), oldParts[i])) return false;
  }
  return true;
}

/**
 * The key of the entry that moves to `target` under the rules of spec "Umzug eines Eintrags", or null:
 * `target` has an entry of its own → null; the sheet folder is not a reachable folder → null; exactly one
 * entry is `target` renamed only in case → that key; otherwise the orphans (entries with a fingerprint whose
 * PDF `stat` reports missing, not behind an unreachable link) are compared with `targetFingerprint()`, which
 * is called only when there are orphans: exactly one orphan with an equal fingerprint → its key. Never throws.
 */
export async function findMoveSource(
  folder: string,
  sheets: Record<string, SheetEntry>,
  target: string,
  targetFingerprint: () => Promise<Fingerprint | null>,
): Promise<string | null> {
  try {
    if (Object.hasOwn(sheets, target)) return null;
    if (!(await isReachableFolder(folder))) return null;
    const keys = Object.keys(sheets);

    const renamed: string[] = [];
    for (const key of keys) if (await isCaseOnlyRename(folder, key, target)) renamed.push(key);
    if (renamed.length === 1) return renamed[0];

    const withFingerprint = keys.filter((key) => sheets[key].fingerprint !== undefined);
    const states = await Promise.all(withFingerprint.map((key) => pathState(fileOf(folder, key), folder)));
    const orphans = withFingerprint.filter((_key, i) => states[i] === "missing");
    if (orphans.length === 0) return null;

    const fingerprint = await targetFingerprint();
    if (fingerprint === null) return null;
    const matches = orphans.filter((key) => sameFingerprint(sheets[key].fingerprint!, fingerprint));
    return matches.length === 1 ? matches[0] : null;
  } catch (e) {
    console.warn(`Could not look for a moved entry for ${target} in ${folder}:`, e);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// One sheet
// ---------------------------------------------------------------------------------------------------------

export type LoadSheetSettingsResult =
  | { kind: "ok"; dividers: PageDividers; favorite: boolean }
  | { kind: "unreadable"; file: string; message: string; newerVersion?: true }
  /** The sheet is not below the sheet folder: no settings (the file is not read). */
  | { kind: "outside" };

/** The stored dividers of an entry; only keys that are whole pages >= 1 are taken. */
function dividersOf(entry: SheetEntry | undefined): PageDividers {
  const dividers: PageDividers = {};
  for (const [page, ratio] of Object.entries(entry?.pageDividers ?? {})) {
    if (/^[1-9]\d*$/.test(page)) dividers[Number(page)] = ratio;
  }
  return dividers;
}

/**
 * Moves the entry found for `key` (spec case 1, on open) in one write that checks the rules again on the
 * state read fresh; returns the entry `key` has afterwards. A failed write is logged and nothing moves.
 */
async function moveOnOpen(
  folder: string,
  key: string,
  targetFingerprint: () => Promise<Fingerprint | null>,
): Promise<SheetEntry | undefined> {
  let entry: SheetEntry | undefined;
  try {
    await updateFolderConfig(folder, async (current) => {
      const sheets = current?.sheets ?? {};
      const source = await findMoveSource(folder, sheets, key, targetFingerprint);
      entry = sheets[source ?? key];
      return source === null ? null : { sheet: { key, moveFrom: source } };
    });
    return entry;
  } catch (e) {
    console.warn(`Could not move the settings of a moved PDF to ${key} in ${folder}:`, e);
    return undefined;
  }
}

/**
 * Favorite and page dividers of one sheet. A sheet without an entry of its own takes the entry of its moved
 * or renamed PDF (written at once; only then is the PDF read, and only when there are orphans). An unreadable
 * file is reported, never treated as empty. Never throws.
 */
export async function loadSheetSettings(input: { folder: string; pdfPath: string }): Promise<LoadSheetSettingsResult> {
  try {
    const key = sheetKey(input.folder, input.pdfPath);
    if (key === null) return { kind: "outside" };
    const read = await loadFolderConfig(input.folder);
    if (read.kind === "unreadable") return read;
    const sheets = (read.kind === "ok" ? read.config.sheets : undefined) ?? {};
    let entry: SheetEntry | undefined = sheets[key];
    if (entry === undefined) {
      let fingerprint: Promise<Fingerprint | null> | undefined;
      const targetFingerprint = () => (fingerprint ??= fingerprintOrNull(input.pdfPath));
      if ((await findMoveSource(input.folder, sheets, key, targetFingerprint)) !== null)
        entry = await moveOnOpen(input.folder, key, targetFingerprint);
    }
    return { kind: "ok", dividers: dividersOf(entry), favorite: entry?.favorite === true };
  } catch (e) {
    return unexpected(e);
  }
}

/** The requested state of the favorite (not a toggle), or one divider (`ratio` null removes it). */
export type SheetSettingChange = { favorite: boolean } | { page: number; ratio: number | null };

/**
 * Saves one change of a sheet's settings with the PDF's current fingerprint (an unreadable PDF is saved
 * without one; a stored one stays). When the sheet has no entry yet, the entry of its moved PDF is taken over
 * first in the same write (spec case 0). Never throws.
 */
export async function saveSheetSetting(input: {
  folder: string;
  pdfPath: string;
  change: SheetSettingChange;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const key = sheetKey(input.folder, input.pdfPath);
    if (key === null) return { ok: false, message: "Das Blatt liegt nicht im Notenordner." };
    let fingerprint: Fingerprint | null = null;
    try {
      fingerprint = await fingerprintFile(input.pdfPath);
    } catch (e) {
      console.warn(`Could not fingerprint ${input.pdfPath}; saving without:`, e);
    }
    const { change } = input;
    await updateFolderConfig(input.folder, async (current) => {
      const sheets = current?.sheets ?? {};
      const moveFrom = Object.hasOwn(sheets, key)
        ? null
        : await findMoveSource(input.folder, sheets, key, async () => fingerprint);
      const patch: FolderConfigPatch = {
        sheet: {
          key,
          ...(moveFrom !== null && { moveFrom }),
          ...("favorite" in change && { favorite: change.favorite }),
          ...(fingerprint !== null && { fingerprint }),
        },
      };
      if ("page" in change) patch.pageDivider = { sheet: key, page: change.page, ratio: change.ratio };
      return patch;
    });
    return { ok: true };
  } catch (e) {
    console.warn(`Could not save the sheet settings in ${input.folder}:`, e);
    const message = errorMessage(e);
    return {
      ok: false,
      message: e instanceof FolderConfigUnreadableError ? `„${e.file}“ kann nicht gelesen werden: ${message}` : message,
    };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------------------------------------

/** A favorite for the main page: `name` without `.pdf`, `dir` its folder with "/" (`""` on the top level). */
export interface FavoriteSheet {
  key: string;
  pdfPath: string;
  name: string;
  dir: string;
}

export type LoadFavoritesResult =
  | { kind: "ok"; favorites: FavoriteSheet[]; missing: number }
  | { kind: "unreadable"; file: string; message: string; newerVersion?: true };

const byName = (a: string, b: string) => a.localeCompare(b, "de", { sensitivity: "base" });

/** The favorite keys and entries of the folder, or the reason the file cannot be read. */
async function readFavorites(
  folder: string,
): Promise<
  | { kind: "ok"; sheets: Record<string, SheetEntry>; keys: string[] }
  | { kind: "unreadable"; file: string; message: string; newerVersion?: true }
> {
  const read = await loadFolderConfig(folder);
  if (read.kind === "unreadable") return read;
  const sheets = (read.kind === "ok" ? read.config.sheets : undefined) ?? {};
  return { kind: "ok", sheets, keys: Object.keys(sheets).filter((key) => sheets[key].favorite === true) };
}

/**
 * The favorites whose PDF exists or might exist (`stat` failed otherwise), sorted by name (German, ignoring
 * case), then by folder; favorites whose PDF is missing are only counted (their mark stays). Never writes,
 * never reads a PDF. Never throws.
 */
export async function loadFavorites(folder: string): Promise<LoadFavoritesResult> {
  try {
    const read = await readFavorites(folder);
    if (read.kind === "unreadable") return read;
    const favorites: FavoriteSheet[] = [];
    let missing = 0;
    for (const key of read.keys) {
      const pdfPath = fileOf(folder, key);
      // A key that is no plain path below the folder ("../x.pdf", "a//b.pdf") is no sheet of this folder.
      if (sheetKey(folder, pdfPath) !== key) continue;
      if ((await pathState(pdfPath, folder)) === "missing") {
        missing++;
        continue;
      }
      const slash = key.lastIndexOf("/");
      favorites.push({
        key,
        pdfPath,
        name: key.slice(slash + 1).replace(/\.pdf$/i, ""),
        dir: slash < 0 ? "" : key.slice(0, slash),
      });
    }
    favorites.sort((a, b) => byName(a.name, b.name) || byName(a.dir, b.dir));
    return { kind: "ok", favorites, missing };
  } catch (e) {
    return unexpected(e);
  }
}

/** The keys of all favorites, for the hearts of the folder view; no `stat`, no PDF read. Never throws. */
export async function loadFavoriteKeys(
  folder: string,
): Promise<{ kind: "ok"; keys: string[] } | { kind: "unreadable"; file: string; message: string; newerVersion?: true }> {
  try {
    const read = await readFavorites(folder);
    return read.kind === "unreadable" ? read : { kind: "ok", keys: read.keys };
  } catch (e) {
    return unexpected(e);
  }
}

/** Favorites searched completely in this process (`folder + "\0" + key`): each one is searched once. */
const searchedFavorites = new Set<string>();

/** For tests: forgets which favorites were searched. */
export function resetRelinkMemory(): void {
  searchedFavorites.clear();
}

/** `candidates` in search order: same file name (moved), then same folder (renamed), then the rest. */
function searchOrder(key: string, candidates: { key: string; file: string }[]) {
  const slash = key.lastIndexOf("/");
  const name = key.slice(slash + 1);
  const dir = slash < 0 ? "" : key.slice(0, slash);
  const rank = (candidate: string) => {
    const s = candidate.lastIndexOf("/");
    if (candidate.slice(s + 1) === name) return 0;
    return (s < 0 ? "" : candidate.slice(0, s)) === dir ? 1 : 2;
  };
  return candidates.map((c) => ({ c, r: rank(c.key) })).sort((a, b) => a.r - b.r).map(({ c }) => c);
}

/**
 * Searches the sheet folder for the PDFs of favorites that are missing (spec case 2): a PDF without an entry
 * of its own with the favorite's fingerprint takes the entry over (in a write that checks the rules again).
 * Each favorite is searched completely at most once per process; a search cut short by an unreadable PDF, a
 * folder or link the walk could not read, or a failed write runs again next time. Never throws.
 */
export async function relinkMissingFavorites(folder: string): Promise<{ moved: number }> {
  let moved = 0;
  try {
    const read = await readFavorites(folder);
    if (read.kind === "unreadable") return { moved };
    const { sheets } = read;
    const lost: string[] = [];
    for (const key of read.keys.sort()) {
      if (sheets[key].fingerprint === undefined || searchedFavorites.has(`${folder}\0${key}`)) continue;
      if ((await pathState(fileOf(folder, key), folder)) === "missing") lost.push(key);
    }
    if (lost.length === 0) return { moved };

    // A walk that skipped a folder or link may have missed the PDF: nothing counts as searched then.
    const walk = await walkSheetPdfs(folder);
    let candidates = walk.pdfs.filter((pdf) => !Object.hasOwn(sheets, pdf.key));
    for (const key of lost) {
      const wanted = sheets[key].fingerprint!;
      let complete = walk.complete;
      for (const candidate of searchOrder(key, candidates)) {
        let fingerprint: Fingerprint;
        try {
          if ((await fs.promises.stat(candidate.file)).size < wanted.length) continue;
          fingerprint = await fingerprintFile(candidate.file);
        } catch {
          complete = false;
          continue;
        }
        if (!sameFingerprint(fingerprint, wanted)) continue;
        try {
          let took = false;
          await updateFolderConfig(folder, async (current) => {
            const source = await findMoveSource(folder, current?.sheets ?? {}, candidate.key, async () => fingerprint);
            took = source !== null;
            return took ? { sheet: { key: candidate.key, moveFrom: source! } } : null;
          });
          if (took) {
            moved++;
            candidates = candidates.filter((c) => c !== candidate);
          }
        } catch (e) {
          console.warn(`Could not move the favorite ${key} to ${candidate.key} in ${folder}:`, e);
          complete = false;
        }
        break;
      }
      if (complete) searchedFavorites.add(`${folder}\0${key}`);
    }
  } catch (e) {
    console.warn(`Could not search for missing favorites in ${folder}:`, e);
  }
  return { moved };
}
