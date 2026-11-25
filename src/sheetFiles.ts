import fs from "fs";
import path from "path";

/** Which directory entries the sheet list shows: folders and PDFs, nothing hidden (leading dot). */
export function isListedSheetEntry(name: string, isDirectory: boolean): boolean {
  if (name.startsWith(".")) return false;
  return isDirectory || name.toLowerCase().endsWith(".pdf");
}

export interface SheetDirent {
  name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/**
 * Decides whether a directory entry is listed and whether it is a folder. Symlinks and junctions are
 * resolved (stat follows them); broken links and links to other files are hidden.
 */
export async function resolveListedEntry(
  folderPath: string,
  entry: SheetDirent,
): Promise<{ isDirectory: boolean } | undefined> {
  let isDirectory = entry.isDirectory();
  if (entry.isSymbolicLink()) {
    try {
      isDirectory = (await fs.promises.stat(path.join(folderPath, entry.name))).isDirectory();
    } catch {
      return undefined;
    }
  }
  return isListedSheetEntry(entry.name, isDirectory) ? { isDirectory } : undefined;
}

/**
 * Identity of a folder or file for "visited once": its real path, or the resolved path when `realpath`
 * fails (some virtual or encrypted drives on Windows).
 */
async function visitKey(file: string): Promise<string> {
  try {
    return await fs.promises.realpath(file);
  } catch {
    return path.resolve(file);
  }
}

interface PdfWalk {
  folders: Set<string>;
  pdfs: Set<string>;
  result: { key: string; file: string }[];
  /** False once a folder or a link could not be read: part of the tree was not looked at. */
  complete: boolean;
}

async function walkPdfs(dir: string, rel: string, walk: PdfWalk): Promise<void> {
  const folderKey = await visitKey(dir);
  if (walk.folders.has(folderKey)) return;
  walk.folders.add(folderKey);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    walk.complete = false;
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, "de"));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const file = path.join(dir, entry.name);
    const key = rel ? `${rel}/${entry.name}` : entry.name;
    let isDirectory = entry.isDirectory();
    let isRegularFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const stats = await fs.promises.stat(file);
        isDirectory = stats.isDirectory();
        isRegularFile = stats.isFile();
      } catch {
        // A broken link may be a folder on a drive that is offline right now.
        walk.complete = false;
        continue;
      }
    }
    if (!isListedSheetEntry(entry.name, isDirectory)) continue;
    if (isDirectory) {
      await walkPdfs(file, key, walk);
    } else if (isRegularFile) {
      const pdfKey = await visitKey(file);
      if (walk.pdfs.has(pdfKey)) continue;
      walk.pdfs.add(pdfKey);
      walk.result.push({ key, file });
    }
  }
}

/**
 * Every PDF the sheet list shows below `root`, recursively: hidden entries skipped, links (and Windows
 * junctions) followed, every real folder and real PDF once, by the first way in name order (like
 * `scanMigrationCandidates`). `key` is the path relative to `root` with "/" (a sheetKey). Folders and links
 * that cannot be read are skipped; `complete` is then false (a search over `pdfs` may have missed a file).
 * Never throws.
 */
export async function walkSheetPdfs(
  root: string,
): Promise<{ pdfs: { key: string; file: string }[]; complete: boolean }> {
  const walk: PdfWalk = { folders: new Set(), pdfs: new Set(), result: [], complete: true };
  try {
    await walkPdfs(root, "", walk);
  } catch {
    // Only what was found so far.
    walk.complete = false;
  }
  return { pdfs: walk.result, complete: walk.complete };
}

/** The PDFs of `walkSheetPdfs`, skipped folders and links ignored silently. Never throws. */
export async function listSheetPdfs(root: string): Promise<{ key: string; file: string }[]> {
  return (await walkSheetPdfs(root)).pdfs;
}
