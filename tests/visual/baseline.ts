import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyCorpus, corpusDir, legacyDataPath, listCorpus, repoRoot } from "./corpus";
import { type AppUnderTest, buildAppAtRef, type Capture, openSheet } from "./electronDriver";
import { encodePng } from "./imageCompare";

export type CaptureMode = "edit" | "view";
export type CaptureLayer = "with" | "without";

/** `<dir>/<pdf name without .pdf>/<page>-<mode>-<layer>.png` */
export function baselineImagePath(dir: string, pdfPath: string, page: number, mode: CaptureMode, layer: CaptureLayer): string {
  return path.join(baselinePdfDir(dir, pdfPath), `${page}-${mode}-${layer}.png`);
}

export function baselinePdfDir(dir: string, pdfPath: string): string {
  return path.join(dir, pdfPath.replace(/\.pdf$/i, ""));
}

export function networkLogPath(dir: string, pdfPath: string): string {
  return path.join(baselinePdfDir(dir, pdfPath), "network.json");
}

function cssSizePath(dir: string, pdfPath: string): string {
  return path.join(baselinePdfDir(dir, pdfPath), "css-size.json");
}

/** Unrounded CSS size of the page in a baseline capture (`Capture.cssSize`). */
export function baselineCssSize(dir: string, pdfPath: string, page: number, mode: CaptureMode): Capture["cssSize"] {
  const sizes = JSON.parse(fs.readFileSync(cssSizePath(dir, pdfPath), "utf8")) as Record<string, Capture["cssSize"]>;
  const size = sizes[`${page}-${mode}`];
  if (!size) throw new Error(`no CSS size for page ${page} (${mode}) in ${cssSizePath(dir, pdfPath)}`);
  return size;
}

/** Written last for each PDF, so it also marks the PDF's images as complete. */
function fingerprintPath(dir: string, pdfPath: string): string {
  return path.join(baselinePdfDir(dir, pdfPath), "fingerprint.json");
}

/** Bump when the way the baseline is captured changes, so older images are captured again. */
const CAPTURE_VERSION = 1;

/**
 * What the images of one PDF depend on: the old app's commit, the PDF and its `.data` file (the
 * corpus changes: Sebastian adds and edits `.data` files) and the capture procedure.
 */
function fingerprint(commit: string, folder: string, pdfPath: string): string {
  const sha256 = (file: string) =>
    fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
  const pdfFile = path.join(folder, pdfPath);
  return JSON.stringify(
    { captureVersion: CAPTURE_VERSION, commit, pdf: sha256(pdfFile), data: sha256(legacyDataPath(pdfFile)) },
    null,
    2,
  );
}

function resolveCommit(ref: string): string {
  return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function isComplete(dir: string, pdfPath: string, markedPages: number[], expectedFingerprint: string): boolean {
  const file = fingerprintPath(dir, pdfPath);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expectedFingerprint) return false;
  if (!fs.existsSync(networkLogPath(dir, pdfPath)) || !fs.existsSync(cssSizePath(dir, pdfPath))) return false;
  return markedPages.every((page) =>
    (["edit", "view"] as const).every((mode) =>
      (["with", "without"] as const).every((layer) => fs.existsSync(baselineImagePath(dir, pdfPath, page, mode, layer))),
    ),
  );
}

function writeCapture(
  dir: string,
  pdfPath: string,
  page: number,
  mode: CaptureMode,
  capture: Capture,
  cssSizes: Record<string, Capture["cssSize"]>,
) {
  fs.writeFileSync(baselineImagePath(dir, pdfPath, page, mode, "with"), encodePng(capture.with));
  fs.writeFileSync(baselineImagePath(dir, pdfPath, page, mode, "without"), encodePng(capture.without));
  cssSizes[`${page}-${mode}`] = capture.cssSize;
}

async function captureSheet(
  app: AppUnderTest,
  commit: string,
  folder: string,
  dir: string,
  pdfPath: string,
  markedPages: number[],
) {
  // Of the copy, i.e. of exactly the files the old app showed.
  const capturedFingerprint = fingerprint(commit, folder, pdfPath);
  fs.rmSync(baselinePdfDir(dir, pdfPath), { recursive: true, force: true });
  fs.mkdirSync(baselinePdfDir(dir, pdfPath), { recursive: true });
  const requests: string[] = [];
  const cssSizes: Record<string, Capture["cssSize"]> = {};

  const viewSession = await openSheet(app, folder, pdfPath);
  try {
    for (const page of markedPages) {
      await viewSession.gotoPage(page);
      writeCapture(dir, pdfPath, page, "view", await viewSession.captureView(page), cssSizes);
    }
  } finally {
    await viewSession.close();
    requests.push(...viewSession.networkRequests());
  }

  // Leaving edit mode would save, and pages cannot be turned while editing: one app start per page.
  for (const page of markedPages) {
    const editSession = await openSheet(app, folder, pdfPath);
    try {
      writeCapture(dir, pdfPath, page, "edit", await editSession.captureEdit(page), cssSizes);
    } finally {
      await editSession.close();
      requests.push(...editSession.networkRequests());
    }
  }

  fs.writeFileSync(cssSizePath(dir, pdfPath), JSON.stringify(cssSizes, null, 2));
  fs.writeFileSync(networkLogPath(dir, pdfPath), JSON.stringify({ requests }, null, 2));
  fs.writeFileSync(fingerprintPath(dir, pdfPath), capturedFingerprint);
}

/**
 * Captures reference images of the old app (built from `ref`) for every marked corpus page into
 * test-results/visual/baseline/<ref>/, unless they exist and are current: captured from the same
 * commit, the same PDF and `.data` bytes and the same capture procedure. `only` limits this to
 * some corpus PDFs. Always works on a temporary copy of the corpus. Returns the baseline directory.
 */
export async function ensureBaseline(
  ref = process.env.VISUAL_BASELINE_REF ?? "8301b5d",
  only?: string[],
): Promise<string> {
  const dir = path.join(repoRoot, "test-results", "visual", "baseline", ref);
  const commit = resolveCommit(ref);
  const missing = listCorpus().filter(
    (entry) =>
      (!only || only.includes(entry.pdfPath)) &&
      !isComplete(dir, entry.pdfPath, entry.markedPages, fingerprint(commit, corpusDir, entry.pdfPath)),
  );
  if (missing.length === 0) return dir;

  const app = await buildAppAtRef(ref);
  const built = execFileSync("git", ["rev-parse", "HEAD"], { cwd: app.root, encoding: "utf8" }).trim();
  if (built !== commit) {
    throw new Error(`old app in ${app.root} is at ${built}, but ${ref} is ${commit}: remove that worktree to rebuild it`);
  }
  const folder = copyCorpus(os.tmpdir());
  try {
    for (const { pdfPath, markedPages } of missing) {
      await captureSheet(app, commit, folder, dir, pdfPath, markedPages);
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
  return dir;
}
