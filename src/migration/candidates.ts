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

async function walk(dir: string, rel: string, out: MigrationCandidate[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    const relative = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(full, relative, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
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
