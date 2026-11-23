import { describe, expect, test } from "vitest";
import {
  FIT_VIEW,
  clampView,
  isZoomed,
  panBy,
  pinchView,
  toViewportTransform,
  viewCenter,
  wheelZoomFactor,
  zoomAt,
} from "../../src/markup/editZoom";

const size = { width: 600, height: 800 };

describe("edit zoom view math", () => {
  test("clampView limits zoom and offsets", () => {
    expect(clampView({ zoom: 0.5, x: -10, y: -10 }, size)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampView({ zoom: 30, x: 0, y: 0 }, size).zoom).toBe(20);
    expect(clampView({ zoom: 2, x: 10, y: 10 }, size)).toEqual({ zoom: 2, x: 0, y: 0 });
    expect(clampView({ zoom: 2, x: -900, y: -1200 }, size)).toEqual({ zoom: 2, x: -600, y: -800 });
  });

  test("zoomAt zooms around a screen point", () => {
    expect(zoomAt(FIT_VIEW, 2, { x: 300, y: 400 }, size)).toEqual({ zoom: 2, x: -300, y: -400 });
    const v = zoomAt(FIT_VIEW, 2, { x: 250, y: 300 }, size);
    expect(250 * v.zoom + v.x).toBeCloseTo(250 * 1, 9);
    expect(300 * v.zoom + v.y).toBeCloseTo(300, 9);
  });

  test("zoomAt keeps the canvas point under the screen point at higher zoom", () => {
    const start = { zoom: 2, x: -300, y: -400 };
    const at = { x: 250, y: 300 };
    const p = { x: (at.x - start.x) / 2, y: (at.y - start.y) / 2 };
    const v = zoomAt(start, 1.5, at, size);
    expect(p.x * v.zoom + v.x).toBeCloseTo(at.x, 9);
    expect(p.y * v.zoom + v.y).toBeCloseTo(at.y, 9);
  });

  test("zoomAt out below 1 returns FIT_VIEW and clamps at edges", () => {
    expect(zoomAt({ zoom: 2, x: -300, y: -400 }, 0.1, { x: 300, y: 400 }, size)).toEqual(FIT_VIEW);
    expect(zoomAt(FIT_VIEW, 2, { x: 0, y: 0 }, size)).toEqual({ zoom: 2, x: 0, y: 0 });
  });

  test("panBy moves and clamps", () => {
    const v = { zoom: 2, x: -300, y: -400 };
    expect(panBy(v, 20, -30, size)).toEqual({ zoom: 2, x: -280, y: -430 });
    expect(panBy(v, 1000, 1000, size)).toEqual({ zoom: 2, x: 0, y: 0 });
    expect(panBy(FIT_VIEW, 50, 50, size)).toEqual(FIT_VIEW);
  });

  test("pinchView zooms by the distance ratio around the midpoint", () => {
    const v = pinchView(
      FIT_VIEW,
      { x: 250, y: 400 },
      { x: 350, y: 400 },
      { x: 200, y: 400 },
      { x: 400, y: 400 },
      size,
    );
    expect(v.zoom).toBeCloseTo(2, 9);
    expect(300 * v.zoom + v.x).toBeCloseTo(300, 9);
    expect(400 * v.zoom + v.y).toBeCloseTo(400, 9);
  });

  test("pinchView pans with the midpoint and caps the zoom", () => {
    const start = { zoom: 2, x: -300, y: -400 };
    const a0 = { x: 250, y: 400 };
    const b0 = { x: 350, y: 400 };
    const v = pinchView(start, a0, b0, { x: 300, y: 400 }, { x: 400, y: 400 }, size);
    expect(v.zoom).toBeCloseTo(2, 9);
    expect(v.x).toBeCloseTo(-250, 9);
    expect(v.y).toBeCloseTo(-400, 9);
    const big = pinchView(start, a0, b0, { x: -300, y: 400 }, { x: 900, y: 400 }, size);
    expect(big.zoom).toBe(20);
  });

  test("wheelZoomFactor is symmetric and capped", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / wheelZoomFactor(-100), 12);
    expect(wheelZoomFactor(1000)).toBe(wheelZoomFactor(200));
  });

  test("transform, centre and isZoomed", () => {
    expect(toViewportTransform({ zoom: 3, x: -5, y: -7 })).toEqual([3, 0, 0, 3, -5, -7]);
    expect(viewCenter({ zoom: 2, x: -300, y: -400 }, size)).toEqual({ x: 300, y: 400 });
    expect(isZoomed(FIT_VIEW)).toBe(false);
    expect(isZoomed({ zoom: 1.5, x: 0, y: 0 })).toBe(true);
  });
});
