import fs from "node:fs";
import { expect, test } from "vitest";
import { baselineImagePath, type CaptureMode, ensureBaseline, networkLogPath } from "./baseline";
import { listCorpus } from "./corpus";
import { decodePng, markupMask, maskMetrics } from "./imageCompare";

const corpus = listCorpus();

if (corpus.length === 0) test.skip("Noten/ corpus with .data files is missing");

for (const { pdfPath, markedPages, blankPages } of corpus) {
  test(`baseline of the old app: ${pdfPath}`, async () => {
    const dir = await ensureBaseline(undefined, [pdfPath]);

    const markup = (page: number, mode: CaptureMode) => {
      const withPath = baselineImagePath(dir, pdfPath, page, mode, "with");
      const withoutPath = baselineImagePath(dir, pdfPath, page, mode, "without");
      expect(fs.existsSync(withPath), withPath).toBe(true);
      expect(fs.existsSync(withoutPath), withoutPath).toBe(true);
      const withImg = decodePng(fs.readFileSync(withPath));
      return { mask: markupMask(withImg, decodePng(fs.readFileSync(withoutPath))), width: withImg.width };
    };

    for (const page of markedPages) {
      const edit = markup(page, "edit");
      const view = markup(page, "view");
      const editArea = edit.mask.reduce((sum, v) => sum + v, 0);
      if (blankPages.includes(page)) {
        expect(editArea, `markup pixels on page ${page} (edit mode, only empty text objects)`).toBe(0);
      } else {
        expect(editArea, `markup pixels on page ${page} (edit mode)`).toBeGreaterThan(0);
      }

      // Informational only: the old view rounds its scale factor (spec section 8).
      const m = maskMetrics(view.mask, edit.mask, edit.width);
      console.log(
        `${pdfPath} p${page}: view vs edit centroid offset ${m.centroidOffsetPx.toFixed(2)} px, ` +
          `IoU ${m.iou.toFixed(3)}, markup px view ${m.areaA} / edit ${m.areaB}`,
      );
    }

    // Informational only: the old app is a fixed reference (it loads Roboto from Google Fonts).
    // The requests were cancelled; the strict offline check applies to the new app.
    const networkLog = networkLogPath(dir, pdfPath);
    expect(fs.existsSync(networkLog), networkLog).toBe(true);
    const { requests } = JSON.parse(fs.readFileSync(networkLog, "utf8")) as { requests: string[] };
    console.log(
      `${pdfPath}: old app http(s) requests (cancelled, see ${networkLog}): ` +
        (requests.length ? [...new Set(requests)].map((u) => `${requests.filter((r) => r === u).length}x ${u}`).join(", ") : "none"),
    );
  });
}
