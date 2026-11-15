import { expect, test } from "vitest";
import { makePdf } from "../pdfMarkup/fixtures";
import {
  decodePng,
  diffRatio,
  encodePng,
  type Img,
  markupMask,
  maskMetrics,
  maxObjectOffset,
  sideBySide,
} from "./imageCompare";
import { renderPdfPage } from "./pdfRender";

/** RGBA image, black where px() returns 1, white elsewhere. */
const solid = (w: number, h: number, px: (x: number, y: number) => number): Img => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = px(x, y) ? 0 : 255;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
};

test("identical images have ratio 0", () => {
  const a = solid(20, 20, () => 0);
  expect(diffRatio(a, a).ratio).toBe(0);
});

test("diffRatio counts differing pixels and rejects size mismatch", () => {
  const a = solid(10, 10, () => 0);
  const b = solid(10, 10, (x, y) => +(x < 5 && y < 2));
  const { ratio, diff } = diffRatio(a, b);
  expect(ratio).toBeCloseTo(10 / 100);
  expect(diff.width).toBe(10);
  expect(() => diffRatio(a, solid(10, 11, () => 0))).toThrow();
});

test("mask metrics detect a 1px shift", () => {
  const blank = solid(40, 40, () => 0);
  const a = markupMask(solid(40, 40, (x, y) => +(x >= 10 && x < 20 && y >= 10 && y < 20)), blank);
  const b = markupMask(solid(40, 40, (x, y) => +(x >= 11 && x < 21 && y >= 10 && y < 20)), blank);
  const m = maskMetrics(a, b, 40);
  expect(m.centroidOffsetPx).toBeCloseTo(1);
  expect(m.iou).toBeCloseTo(90 / 110);
});

test("per-object offset ignores edge pixels gained by objects far apart, but sees a shifted object", () => {
  const w = 200;
  const box = (x0: number, y0: number, size: number) => (x: number, y: number) =>
    +(x >= x0 && x < x0 + size && y >= y0 && y < y0 + size);
  const blank = solid(w, 50, () => 0);
  const ref = markupMask(solid(w, 50, (x, y) => box(10, 10, 20)(x, y) | box(150, 10, 20)(x, y)), blank);
  // The right object grows by one pixel on every side: same position, more edge pixels.
  const grown = markupMask(solid(w, 50, (x, y) => box(10, 10, 20)(x, y) | box(149, 9, 22)(x, y)), blank);
  expect(maskMetrics(grown, ref, w).centroidOffsetPx).toBeGreaterThan(1);
  expect(maxObjectOffset(grown, ref, w)).toEqual({ maxOffsetPx: 0, objects: 2 });
  // The left object moves by 2 px.
  const moved = markupMask(solid(w, 50, (x, y) => box(12, 10, 20)(x, y) | box(150, 10, 20)(x, y)), blank);
  expect(maxObjectOffset(moved, ref, w).maxOffsetPx).toBeCloseTo(2);
});

test("empty vs non-empty mask", () => {
  const blank = solid(10, 10, () => 0);
  const m = maskMetrics(markupMask(blank, blank), markupMask(solid(10, 10, (x) => +(x === 1)), blank), 10);
  expect(m).toMatchObject({ iou: 0, centroidOffsetPx: Infinity });
});

test("two empty masks are a perfect match", () => {
  const blank = solid(10, 10, () => 0);
  const m = maskMetrics(markupMask(blank, blank), markupMask(blank, blank), 10);
  expect(m).toEqual({ iou: 1, centroidOffsetPx: 0, areaA: 0, areaB: 0 });
});

test("png round trip and side by side", () => {
  const a = solid(4, 3, (x) => +(x === 0));
  expect(decodePng(encodePng(a))).toEqual(a);
  const s = sideBySide(a, solid(2, 5, () => 1));
  expect([s.width, s.height]).toEqual([6, 5]);
  expect([...s.data.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
  expect([...s.data.subarray((4 * 6 + 4) * 4, (4 * 6 + 4) * 4 + 4)]).toEqual([0, 0, 0, 255]);
});

test("renderPdfPage renders offline at requested width", async () => {
  const img = await renderPdfPage(await makePdf({ xref: "table" }), 1, 600, { annotations: true });
  expect(img.width).toBe(600);
  expect(img.height).toBe(Math.round((600 * 842) / 595));
  // white background with some dark text pixels
  expect(img.data[3]).toBe(255);
  expect(img.data.some((v, i) => i % 4 === 0 && v < 128)).toBe(true);
});
