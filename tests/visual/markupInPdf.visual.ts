import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { OCG_NAME } from "../../src/models/markupConstants";
import { baselineImagePath } from "./baseline";
import { copyCorpus, legacyDataPath, listCorpus, repoRoot } from "./corpus";
import { currentApp, openSheet } from "./electronDriver";
import { decodePng, diffRatio, encodePng, type Img, markupMask, maskMetrics } from "./imageCompare";
import { renderPdfPage } from "./pdfRender";

/**
 * Smoke test of the new app on a copy of one corpus PDF: migration of the legacy `.data` file into
 * the PDF, markup shown exactly once (pdf.js hides our stamp via its optional content group), save on
 * leaving edit mode, reload, the stamp in "another viewer", and no network requests.
 */
const PDF = "Pilatus - Alt-Sax 1.pdf";
const BASELINE_REF = process.env.VISUAL_BASELINE_REF ?? "8301b5d";
const entry = listCorpus().find((e) => e.pdfPath === PDF);
const outDir = path.join(repoRoot, "test-results", "visual", "markup-in-pdf");
const baselineDir = path.join(repoRoot, "test-results", "visual", "baseline", BASELINE_REF);

const area = (mask: Uint8Array) => mask.reduce((sum, v) => sum + v, 0);
const save = (name: string, img: Img) => fs.writeFileSync(path.join(outDir, name), encodePng(img));

async function waitUntil(what: string, probe: () => boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const hasBaseline = entry !== undefined && fs.existsSync(baselineImagePath(baselineDir, PDF, 1, "edit", "without"));

if (!entry || !hasBaseline) test.skip(`${PDF} with .data and its old-app baseline (${BASELINE_REF}) are required`);
else {
  test(`markup inside the PDF: ${PDF}`, async () => {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const folder = copyCorpus(path.join(repoRoot, "test-results", "visual", "work"));
    const pdfFile = path.join(folder, PDF);
    const dataFile = legacyDataPath(pdfFile);
    const originalSize = fs.statSync(pdfFile).size;
    expect(fs.existsSync(dataFile)).toBe(true);

    const app = await currentApp();

    // 1. Open: migration writes into the PDF and removes the legacy file; markup shown exactly once.
    const first = await openSheet(app, folder, PDF);
    const views = new Map<number, Img>();
    let migratedSize: number;
    try {
      await waitUntil("migration (.data removed)", () => !fs.existsSync(dataFile));
      migratedSize = fs.statSync(pdfFile).size;
      console.log(`${PDF}: ${originalSize} -> ${migratedSize} bytes after migration`);
      expect(migratedSize).toBeGreaterThan(originalSize);

      for (const page of entry.markedPages) {
        await first.gotoPage(page);
        const view = await first.captureView(page);
        save(`${page}-view-with.png`, view.with);
        save(`${page}-view-without.png`, view.without);
        views.set(page, view.with);
        const markup = markupMask(view.with, view.without);
        expect(area(markup), `markup pixels on page ${page}`).toBeGreaterThan(0);

        // The page canvas alone must not contain the stamp: it equals the old app's page without markup.
        const oldWithout = decodePng(fs.readFileSync(baselineImagePath(baselineDir, PDF, page, "edit", "without")));
        const { ratio, diff } = diffRatio(view.without, oldWithout);
        save(`${page}-page-vs-old-diff.png`, diff);
        console.log(`page ${page}: page canvas vs old page canvas: ${(ratio * 100).toFixed(4)} % differing pixels`);
        expect(ratio, `page ${page} canvas differs from the old one (stamp rendered twice?)`).toBeLessThan(0.001);

        // Informational: position against the old edit mode (strict checks are the visual comparison task's).
        const oldWith = decodePng(fs.readFileSync(baselineImagePath(baselineDir, PDF, page, "edit", "with")));
        const m = maskMetrics(markup, markupMask(oldWith, oldWithout), view.with.width);
        console.log(
          `page ${page}: new view vs old edit: centroid offset ${m.centroidOffsetPx.toFixed(2)} px, IoU ${m.iou.toFixed(3)}, ` +
            `markup px ${m.areaA} / ${m.areaB}`,
        );
      }

      // 2. Edit mode on the last marked page and leave it: saves again, the file does not grow.
      const lastPage = entry.markedPages[entry.markedPages.length - 1];
      const edit = await first.captureEdit(lastPage);
      save(`${lastPage}-edit-with.png`, edit.with);
      const before = fs.statSync(pdfFile).mtimeMs;
      await first.toggleEdit();
      await waitUntil("save after leaving edit mode", () => fs.statSync(pdfFile).mtimeMs !== before);
      const resavedSize = fs.statSync(pdfFile).size;
      console.log(`${PDF}: ${resavedSize} bytes after saving again (was ${migratedSize})`);
      expect(Math.abs(resavedSize - migratedSize)).toBeLessThan(migratedSize * 0.001);
      expect(first.networkRequests()).toEqual([]);
    } finally {
      await first.close();
    }

    // 3. Reopen: markup comes from the PDF and looks the same.
    const second = await openSheet(app, folder, PDF);
    try {
      expect(fs.existsSync(dataFile)).toBe(false);
      for (const page of entry.markedPages) {
        await second.gotoPage(page);
        const view = await second.captureView(page);
        save(`${page}-reopened-view-with.png`, view.with);
        const { ratio } = diffRatio(view.with, views.get(page) as Img);
        console.log(`page ${page}: reopened vs first view: ${(ratio * 100).toFixed(4)} % differing pixels`);
        expect(ratio).toBeLessThan(0.001);
      }
      expect(second.networkRequests()).toEqual([]);
    } finally {
      await second.close();
    }

    // 4. "Another viewer": pdf.js with annotations shows the stamp; hiding our group removes it.
    const bytes = new Uint8Array(fs.readFileSync(pdfFile));
    for (const page of entry.markedPages) {
      const width = (views.get(page) as Img).width;
      const shown = await renderPdfPage(bytes, page, width, { annotations: true });
      const hidden = await renderPdfPage(bytes, page, width, { annotations: true, hideOcgNamed: OCG_NAME });
      save(`${page}-other-viewer.png`, shown);
      save(`${page}-other-viewer-hidden.png`, hidden);
      expect(area(markupMask(shown, hidden)), `stamp pixels on page ${page} in another viewer`).toBeGreaterThan(0);
    }

    fs.rmSync(folder, { recursive: true, force: true });
  });
}

const LEGACY_UNREADABLE = "Die alte Markierungsdatei konnte nicht gelesen werden und bleibt unverändert liegen.";

async function waitForSnackbar(session: { snackbarText(): Promise<string> }, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await session.snackbarText();
    if (text || Date.now() > deadline) return text;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

if (entry) {
  test(`unparseable legacy file: warning, file and PDF untouched: ${PDF}`, async () => {
    const folder = copyCorpus(path.join(repoRoot, "test-results", "visual", "work"));
    try {
      const pdfFile = path.join(folder, PDF);
      const dataFile = legacyDataPath(pdfFile);
      const corrupt = '[{"page": 1, "data": {"objects": [ broken';
      fs.writeFileSync(dataFile, corrupt);
      const pdfBefore = fs.readFileSync(pdfFile);
      const session = await openSheet(await currentApp(), folder, PDF); // resolves once all pages rendered
      try {
        expect(await waitForSnackbar(session)).toContain(LEGACY_UNREADABLE);
        expect(fs.readFileSync(dataFile, "utf8")).toBe(corrupt);
        expect(fs.readFileSync(pdfFile).equals(pdfBefore)).toBe(true);
      } finally {
        await session.close();
      }
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  test(`partly unconvertible legacy file: readable pages go into the writable PDF, file kept: ${PDF}`, async () => {
    const folder = copyCorpus(path.join(repoRoot, "test-results", "visual", "work"));
    try {
      const pdfFile = path.join(folder, PDF);
      const dataFile = legacyDataPath(pdfFile);
      const legacy = JSON.parse(fs.readFileSync(dataFile, "utf8")) as { page: number; drawWidth: number }[];
      const broken = legacy.find((e) => e.page === 2);
      if (!broken) throw new Error("expected legacy data for page 2");
      broken.drawWidth = 0; // cannot be converted
      const legacyText = JSON.stringify(legacy);
      fs.writeFileSync(dataFile, legacyText);
      const sizeBefore = fs.statSync(pdfFile).size;
      const app = await currentApp();

      const first = await openSheet(app, folder, PDF);
      try {
        expect(await waitForSnackbar(first)).toContain(LEGACY_UNREADABLE);
        await waitUntil("pages 1 and 3 saved into the PDF", () => fs.statSync(pdfFile).size > sizeBefore);
        expect(fs.readFileSync(dataFile, "utf8")).toBe(legacyText);
        const view = await first.captureView(1);
        expect(area(markupMask(view.with, view.without))).toBeGreaterThan(0);
      } finally {
        await first.close();
      }

      // Embedded data wins now: no warning, page 1 from the PDF, the legacy file still untouched.
      const second = await openSheet(app, folder, PDF);
      try {
        expect(await waitForSnackbar(second, 8000)).toBe("");
        const view = await second.captureView(1);
        expect(area(markupMask(view.with, view.without))).toBeGreaterThan(0);
        expect(fs.readFileSync(dataFile, "utf8")).toBe(legacyText);
        expect(second.networkRequests()).toEqual([]);
      } finally {
        await second.close();
      }
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
}
