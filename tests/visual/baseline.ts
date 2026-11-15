import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyCorpus, listCorpus, repoRoot } from "./corpus";
import { type AppUnderTest, buildAppAtRef, openSheet } from "./electronDriver";
import { encodePng, type Img } from "./imageCompare";

export type CaptureMode = "edit" | "view";
export type CaptureLayer = "with" | "without";

/** `<dir>/<pdf name without .pdf>/<page>-<mode>-<layer>.png` */
export function baselineImagePath(dir: string, pdfPath: string, page: number, mode: CaptureMode, layer: CaptureLayer): string {
  return path.join(baselinePdfDir(dir, pdfPath), `${page}-${mode}-${layer}.png`);
}

export function baselinePdfDir(dir: string, pdfPath: string): string {
  return path.join(dir, pdfPath.replace(/\.pdf$/i, ""));
}

/** Written last for each PDF, so it also marks the PDF's images as complete. */
export function networkLogPath(dir: string, pdfPath: string): string {
  return path.join(baselinePdfDir(dir, pdfPath), "network.json");
}

function isComplete(dir: string, pdfPath: string, markedPages: number[]): boolean {
  if (!fs.existsSync(networkLogPath(dir, pdfPath))) return false;
  return markedPages.every((page) =>
    (["edit", "view"] as const).every((mode) =>
      (["with", "without"] as const).every((layer) => fs.existsSync(baselineImagePath(dir, pdfPath, page, mode, layer))),
    ),
  );
}

function writeCapture(dir: string, pdfPath: string, page: number, mode: CaptureMode, capture: { with: Img; without: Img }) {
  fs.writeFileSync(baselineImagePath(dir, pdfPath, page, mode, "with"), encodePng(capture.with));
  fs.writeFileSync(baselineImagePath(dir, pdfPath, page, mode, "without"), encodePng(capture.without));
}

async function captureSheet(app: AppUnderTest, folder: string, dir: string, pdfPath: string, markedPages: number[]) {
  fs.rmSync(baselinePdfDir(dir, pdfPath), { recursive: true, force: true });
  fs.mkdirSync(baselinePdfDir(dir, pdfPath), { recursive: true });
  const requests: string[] = [];

  const viewSession = await openSheet(app, folder, pdfPath);
  try {
    for (const page of markedPages) {
      await viewSession.gotoPage(page);
      writeCapture(dir, pdfPath, page, "view", await viewSession.captureView(page));
    }
  } finally {
    await viewSession.close();
    requests.push(...viewSession.networkRequests());
  }

  // Leaving edit mode would save, and pages cannot be turned while editing: one app start per page.
  for (const page of markedPages) {
    const editSession = await openSheet(app, folder, pdfPath);
    try {
      writeCapture(dir, pdfPath, page, "edit", await editSession.captureEdit(page));
    } finally {
      await editSession.close();
      requests.push(...editSession.networkRequests());
    }
  }

  fs.writeFileSync(networkLogPath(dir, pdfPath), JSON.stringify({ requests }, null, 2));
}

/**
 * Captures reference images of the old app (built from `ref`) for every marked corpus page that
 * has none yet, into test-results/visual/baseline/<ref>/. `only` limits this to some corpus PDFs.
 * Always works on a temporary copy of the corpus. Returns the baseline directory.
 */
export async function ensureBaseline(
  ref = process.env.VISUAL_BASELINE_REF ?? "8301b5d",
  only?: string[],
): Promise<string> {
  const dir = path.join(repoRoot, "test-results", "visual", "baseline", ref);
  const missing = listCorpus().filter(
    (entry) => (!only || only.includes(entry.pdfPath)) && !isComplete(dir, entry.pdfPath, entry.markedPages),
  );
  if (missing.length === 0) return dir;

  const app = await buildAppAtRef(ref);
  const folder = copyCorpus(os.tmpdir());
  try {
    for (const { pdfPath, markedPages } of missing) {
      await captureSheet(app, folder, dir, pdfPath, markedPages);
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
  return dir;
}
