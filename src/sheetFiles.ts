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
