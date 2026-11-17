import fs from "fs";
import path from "path";
import { getSidecarPath } from "../pdfMarkup/markupFile";
import type { SkipList } from "./skipList";
import type { MigrationCandidate } from "./types";

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
