import fs from "fs";
import path from "path";
import { getSidecarPath } from "../pdfMarkup/markupFile";
import { isListedSheetEntry } from "../sheetFiles";
import type { SkipList } from "./skipList";
import type { MigrationCandidate, ScanResult } from "./types";

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(file)).isFile();
  } catch {
    return false;
  }
}

type EntryTypes = Pick<fs.Dirent, "isSymbolicLink" | "isDirectory" | "isFile">;

/**
 * What to scan an entry as; `null` = skip. On Windows `readdir` reports every reparse point as a link,
 * also cloud placeholders (Nextcloud, OneDrive) that are plain files and folders; `lstat` tells them apart
 * from real links (symlinks, junctions), which are never followed.
 */
export async function entryKind(
  entry: EntryTypes,
  full: string,
  lstat: (p: string) => Promise<EntryTypes> = (p) => fs.promises.lstat(p),
): Promise<"directory" | "file" | null> {
  let types: EntryTypes = entry;
  if (entry.isSymbolicLink()) {
    try {
      types = await lstat(full);
    } catch {
      return null;
    }
    if (types.isSymbolicLink()) return null;
  }
  if (types.isDirectory()) return "directory";
  if (types.isFile()) return "file";
  return null;
}

async function walk(dir: string, rel: string, out: MigrationCandidate[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const relative = rel ? `${rel}/${entry.name}` : entry.name;
    const kind = await entryKind(entry, full);
    if (kind === "directory") {
      await walk(full, relative, out);
    } else if (kind === "file" && entry.name.toLowerCase().endsWith(".pdf")) {
      const sidecarPath = getSidecarPath(full);
      if (await isFile(sidecarPath)) out.push({ pdfPath: full, sidecarPath, relativePath: relative });
    }
  }
}

/** All PDFs below `root` that still have a legacy `.data` sidecar and are not on the skip list. */
export async function findMigrationCandidates(
  root: string,
  skips: SkipList,
): Promise<MigrationCandidate[]> {
  const all: MigrationCandidate[] = [];
  await walk(root, "", all);
  const result: MigrationCandidate[] = [];
  for (const c of all) if (!(await skips.isSkipped(c))) result.push(c);
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "de"));
}

/**
 * Whether a legacy sidecar has to be looked at. Only "does not exist" (ENOENT/ENOTDIR) and "is not a
 * regular file" mean no; any other stat failure counts as present, so the gate's read reports the error
 * for exactly this PDF instead of the scan silently finding nothing.
 */
async function hasSidecar(file: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(file)).isFile();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
}

const messageOf =(e: unknown) => (e instanceof Error ? e.message : String(e));

async function scanFolder(dir: string, rel: string, visited: Set<string>, result: ScanResult): Promise<void> {
  let entries: fs.Dirent[];
  try {
    const real = await fs.promises.realpath(dir);
    if (visited.has(real)) return;
    visited.add(real);
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    result.errors.push({ relativePath: rel || ".", kind: "folder", message: messageOf(e) });
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, "de"));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const relative = rel ? `${rel}/${entry.name}` : entry.name;
    let isDirectory = entry.isDirectory();
    let isRegularFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      // Like the sheet list: links (and Windows cloud placeholders) are resolved with stat.
      try {
        const stats = await fs.promises.stat(full);
        isDirectory = stats.isDirectory();
        isRegularFile = stats.isFile();
      } catch (e) {
        result.errors.push({ relativePath: relative, kind: "link", message: messageOf(e) });
        continue;
      }
    }
    if (!isListedSheetEntry(entry.name, isDirectory)) continue;
    if (isDirectory) {
      await scanFolder(full, relative, visited, result);
    } else if (isRegularFile) {
      const sidecarPath = getSidecarPath(full);
      if (!(await hasSidecar(sidecarPath))) continue;
      try {
        const real = await fs.promises.realpath(full);
        if (visited.has(real)) continue;
        visited.add(real);
      } catch (e) {
        result.errors.push({ relativePath: relative, kind: "link", message: messageOf(e) });
        continue;
      }
      result.candidates.push({ pdfPath: full, sidecarPath, relativePath: relative });
    }
  }
}

/**
 * Scans exactly what the sheet list shows (links followed, hidden entries skipped) for PDFs that still
 * have a legacy `.data` sidecar. Folders and links that cannot be read are reported, never swallowed.
 * Every real folder and PDF is visited once, by the first way in name order. Never throws.
 */
export async function scanMigrationCandidates(root: string): Promise<ScanResult> {
  const result: ScanResult = { candidates: [], errors: [] };
  try {
    await scanFolder(root, "", new Set(), result);
  } catch (e) {
    result.errors.push({ relativePath: ".", kind: "folder", message: messageOf(e) });
  }
  result.candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "de"));
  return result;
}
