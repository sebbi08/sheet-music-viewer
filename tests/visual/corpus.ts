import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** Local, gitignored test corpus of real sheet music. Only ever read from it. */
export const corpusDir = path.join(repoRoot, "Noten");

/** Legacy sidecar of `<name>.pdf`: `.<name>.data` next to it (see getOverlayDataFilePathFromSheetPath). */
export function legacyDataPath(pdfFile: string): string {
  return path.join(path.dirname(pdfFile), "." + path.basename(pdfFile, path.extname(pdfFile)) + ".data");
}

interface LegacyEntry {
  page: number;
  data?: { objects?: { type?: string; text?: string }[] };
}

/** A text object without text draws nothing. */
const isBlankText = (o: { type?: string; text?: string }) =>
  /^(text|i-text|textbox)$/i.test(o.type ?? "") && !(o.text ?? "").trim();

/**
 * Every `Noten/*.pdf` that has a legacy `.data` file. `pdfPath` is relative to the corpus
 * folder (so it is valid in a copy, too); `markedPages` are the 1-based pages with at least one
 * object; `blankPages` are those marked pages whose objects all draw nothing (empty text boxes).
 */
export function listCorpus(): { pdfPath: string; markedPages: number[]; blankPages: number[] }[] {
  if (!fs.existsSync(corpusDir)) return [];
  return fs
    .readdirSync(corpusDir)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort()
    .flatMap((pdfPath) => {
      const dataFile = legacyDataPath(path.join(corpusDir, pdfPath));
      if (!fs.existsSync(dataFile)) return [];
      const entries = JSON.parse(fs.readFileSync(dataFile, "utf8")) as LegacyEntry[];
      const objectsOf = (page: number) => entries.filter((e) => e.page === page).flatMap((e) => e.data?.objects ?? []);
      const markedPages = [...new Set(entries.map((e) => e.page))].filter((p) => objectsOf(p).length > 0).sort((a, b) => a - b);
      const blankPages = markedPages.filter((p) => objectsOf(p).every(isBlankText));
      return [{ pdfPath, markedPages, blankPages }];
    });
}

/** Copies the whole corpus (PDFs, `.data`, set lists) into a fresh folder below `target` and returns it. */
export function copyCorpus(target: string): string {
  fs.mkdirSync(target, { recursive: true });
  const dir = fs.mkdtempSync(path.join(target, "corpus-"));
  fs.cpSync(corpusDir, dir, { recursive: true, dereference: true });
  return dir;
}
