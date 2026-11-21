import fs from "fs";
import path from "path";
import { getSidecarPath } from "../pdfMarkup/markupFile";
import { isListedSheetEntry } from "../sheetFiles";
import type { ScanResult } from "./types";

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

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Identity of a folder or file for "visited once": its real path, or the resolved path when `realpath`
 * fails (some virtual or encrypted drives on Windows). A failing `realpath` alone is no scan error.
 */
async function visitKey(file: string): Promise<string> {
  try {
    return await fs.promises.realpath(file);
  } catch {
    return path.resolve(file);
  }
}

interface Visited {
  folders: Set<string>;
  /** Real PDF -> the real sidecars it was reported with. */
  pdfs: Map<string, Set<string>>;
}

async function scanFolder(dir: string, rel: string, visited: Visited, result: ScanResult): Promise<void> {
  const key = await visitKey(dir);
  if (visited.folders.has(key)) return;
  visited.folders.add(key);
  let entries: fs.Dirent[];
  try {
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
      // A PDF reached a second way (a file link) is skipped unless this way has a sidecar of its own: the
      // old app named the sidecar after the path it opened, so that one holds markup, too.
      const pdfKey = await visitKey(full);
      const sidecarKey = await visitKey(sidecarPath);
      const sidecars = visited.pdfs.get(pdfKey) ?? new Set<string>();
      if (sidecars.has(sidecarKey)) continue;
      sidecars.add(sidecarKey);
      visited.pdfs.set(pdfKey, sidecars);
      result.candidates.push({ pdfPath: full, sidecarPath, relativePath: relative });
    }
  }
}

/**
 * Scans exactly what the sheet list shows (links followed, hidden entries skipped) for PDFs that still
 * have a legacy `.data` sidecar. Folders and links that cannot be read are reported, never swallowed.
 * Every real folder is visited once, by the first way in name order; a real PDF too, unless another way to
 * it has a different sidecar (then that way is a candidate as well). Never throws.
 */
export async function scanMigrationCandidates(root: string): Promise<ScanResult> {
  const result: ScanResult = { candidates: [], errors: [] };
  try {
    await scanFolder(root, "", { folders: new Set(), pdfs: new Map() }, result);
  } catch (e) {
    result.errors.push({ relativePath: ".", kind: "folder", message: messageOf(e) });
  }
  result.candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "de"));
  return result;
}
