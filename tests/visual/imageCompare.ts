import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/** RGBA image, 4 bytes per pixel, row-major. */
export interface Img {
  width: number;
  height: number;
  data: Uint8Array;
}

export function decodePng(bytes: Uint8Array): Img {
  const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

export function encodePng(img: Img): Uint8Array {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return new Uint8Array(PNG.sync.write(png));
}

function assertSameSize(a: Img, b: Img): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
}

/** Share of pixels that pixelmatch reports as different (anti-aliasing ignored), plus its diff image. */
export function diffRatio(a: Img, b: Img, threshold = 0.1): { ratio: number; diff: Img } {
  assertSameSize(a, b);
  const diff: Img = { width: a.width, height: a.height, data: new Uint8Array(a.data.length) };
  const count = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold });
  return { ratio: count / (a.width * a.height), diff };
}

/** 1 where `withMarkup` differs from `without` (every differing pixel counts, including anti-aliased edges). */
export function markupMask(withMarkup: Img, without: Img, threshold = 0.1): Uint8Array {
  assertSameSize(withMarkup, without);
  const out = new Uint8Array(withMarkup.data.length);
  pixelmatch(withMarkup.data, without.data, out, withMarkup.width, withMarkup.height, {
    threshold,
    includeAA: true,
    diffMask: true,
  });
  const mask = new Uint8Array(withMarkup.width * withMarkup.height);
  for (let i = 0; i < mask.length; i++) mask[i] = out[i * 4 + 3] !== 0 ? 1 : 0;
  return mask;
}

/** Overlap (IoU) and centroid distance of two equally sized masks. */
export function maskMetrics(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
): { iou: number; centroidOffsetPx: number; areaA: number; areaB: number } {
  if (a.length !== b.length) throw new Error(`mask size mismatch: ${a.length} vs ${b.length}`);
  let areaA = 0, areaB = 0, both = 0, ax = 0, ay = 0, bx = 0, by = 0;
  for (let i = 0; i < a.length; i++) {
    const x = i % width;
    const y = (i - x) / width;
    if (a[i]) { areaA++; ax += x; ay += y; }
    if (b[i]) { areaB++; bx += x; by += y; }
    if (a[i] && b[i]) both++;
  }
  if (areaA === 0 && areaB === 0) return { iou: 1, centroidOffsetPx: 0, areaA, areaB };
  if (areaA === 0 || areaB === 0) return { iou: 0, centroidOffsetPx: Infinity, areaA, areaB };
  const centroidOffsetPx = Math.hypot(ax / areaA - bx / areaB, ay / areaA - by / areaB);
  return { iou: both / (areaA + areaB - both), centroidOffsetPx, areaA, areaB };
}

/**
 * How strongly the markup changes each pixel, 0..1: the largest channel difference between the
 * image with and without markup, / 255. Over a white page this is the markup's coverage (alpha)
 * for black or saturated colours, and it is low for anti-aliased edges and semi-transparent strokes.
 */
export function markupCoverage(withMarkup: Img, without: Img): Float32Array {
  assertSameSize(withMarkup, without);
  const out = new Float32Array(withMarkup.width * withMarkup.height);
  for (let i = 0; i < out.length; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(withMarkup.data[i * 4 + c] - without.data[i * 4 + c]));
    out[i] = d / 255;
  }
  return out;
}

/** A group is present in both masks when the lighter side has at least this share of the heavier side's weight. */
const MIN_COUNTERPART_SHARE = 0.5;

/**
 * Centroid offset per markup object: the union of both masks is split into groups of pixels at
 * most `joinPx` apart. Groups below `minPx` pixels in both masks (specks) are ignored. A group
 * whose weight (pixel count, or coverage with weights) in one mask is less than half of that in the
 * other is *unmatched*: the object is missing in one image, or so far off that it forms a group of
 * its own, so it has no defined position (a position failure, never offset 0). Every other group
 * is *matched*: its offset is the distance between its centroid in `a` and in `b`. Returns the
 * largest matched offset (0 if none) and the matched and unmatched group counts. Unlike
 * `maskMetrics`' global centroid, this does not shift when two objects far apart gain or lose a
 * few edge pixels each.
 *
 * With `weightA`/`weightB` (e.g. `markupCoverage`), each mask pixel counts with its weight, so
 * faint anti-aliased fringe pixels that one rendering has above the mask threshold and the other
 * below barely move the centroid.
 */
export function maxObjectOffset(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  opts: { joinPx?: number; minPx?: number; weightA?: Float32Array; weightB?: Float32Array } = {},
): { maxOffsetPx: number; objects: number; unmatched: number } {
  if (a.length !== b.length) throw new Error(`mask size mismatch: ${a.length} vs ${b.length}`);
  const { joinPx = 6, minPx = 20, weightA, weightB } = opts;
  if ((weightA && weightA.length !== a.length) || (weightB && weightB.length !== b.length)) {
    throw new Error("weight size mismatch");
  }
  const height = a.length / width;
  const seen = new Uint8Array(a.length);
  let maxOffsetPx = 0;
  let objects = 0;
  let unmatched = 0;
  for (let start = 0; start < a.length; start++) {
    if (seen[start] || !(a[start] || b[start])) continue;
    let areaA = 0, areaB = 0, wa = 0, wb = 0, ax = 0, ay = 0, bx = 0, by = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % width;
      const y = (i - x) / width;
      if (a[i]) { const w = weightA ? weightA[i] : 1; areaA++; wa += w; ax += w * x; ay += w * y; }
      if (b[i]) { const w = weightB ? weightB[i] : 1; areaB++; wb += w; bx += w * x; by += w * y; }
      for (let ny = Math.max(0, y - joinPx); ny <= Math.min(height - 1, y + joinPx); ny++) {
        for (let nx = Math.max(0, x - joinPx); nx <= Math.min(width - 1, x + joinPx); nx++) {
          const j = ny * width + nx;
          if (!seen[j] && (a[j] || b[j])) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (areaA < minPx && areaB < minPx) continue; // speck
    // Present in both: comparable weight on both sides (not a cut-off at minPx, which a 5×5 px object
    // with 18 px in one rendering and 20 px in the other would cross).
    if (Math.min(wa, wb) < MIN_COUNTERPART_SHARE * Math.max(wa, wb)) {
      unmatched++;
      continue;
    }
    objects++;
    maxOffsetPx = Math.max(maxOffsetPx, Math.hypot(ax / wa - bx / wb, ay / wa - by / wb));
  }
  return { maxOffsetPx, objects, unmatched };
}

/**
 * Per-object position check on a `maxObjectOffset` result: fails when an object is unmatched (missing
 * or far off in one image) or a matched object is more than `limitPx` off. Returns the violations,
 * [] when it passes.
 */
export function objectPositionProblems(
  result: { maxOffsetPx: number; objects: number; unmatched: number },
  limitPx: number,
): string[] {
  const problems: string[] = [];
  if (result.unmatched > 0) {
    problems.push(`${result.unmatched} markup object(s) without a counterpart (missing or far off; ${result.objects} matched)`);
  }
  if (!(result.maxOffsetPx <= limitPx)) {
    problems.push(`markup object centroid offset ${result.maxOffsetPx.toFixed(2)} px > ${limitPx} px`);
  }
  return problems;
}

/** Places the images next to each other on a white canvas (e.g. reference | new | diff). */
export function sideBySide(...imgs: Img[]): Img {
  const width = imgs.reduce((sum, img) => sum + img.width, 0);
  const height = Math.max(0, ...imgs.map((img) => img.height));
  const data = new Uint8Array(width * height * 4).fill(255);
  let offsetX = 0;
  for (const img of imgs) {
    for (let y = 0; y < img.height; y++) {
      const row = img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
      data.set(row, (y * width + offsetX) * 4);
    }
    offsetX += img.width;
  }
  return { width, height, data };
}
