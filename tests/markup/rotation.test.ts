import { describe, expect, test } from "vitest";
import {
  displayTransform,
  legacyToPayload,
  payloadFromCanvas,
  rotatePayload,
  transformFabricJson,
} from "../../src/markup/fabricTransform";
import type { MarkupPayload } from "../../src/models/markup";

type Obj = { left: number; top: number; angle: number; width: number; height: number; scaleX: number; scaleY: number };
type Point = [number, number];

/**
 * Corners of a fabric object with `originX/originY: "center"` (fabric 7's default): its centre is at
 * left/top, rotated by `angle` degrees clockwise (y points down).
 */
function corners(o: Obj): Point[] {
  const a = (o.angle * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const hw = (o.width * o.scaleX) / 2;
  const hh = (o.height * o.scaleY) / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [o.left + x * cos - y * sin, o.top + x * sin + y * cos] as Point);
}

/** A point of the displayed page (w×h) after turning the display `delta` degrees clockwise. */
function turn([x, y]: Point, delta: number, w: number, h: number): Point {
  if (delta === 90) return [h - y, x];
  if (delta === 180) return [w - x, h - y];
  if (delta === 270) return [y, w - x];
  return [x, y];
}

const sortPoints = (points: Point[]) =>
  [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]).map(([x, y]) => [Number(x.toFixed(9)), Number(y.toFixed(9))]);

const obj = (extra: Partial<Obj> = {}): Obj => ({
  left: 10,
  top: 20,
  angle: 0,
  width: 30,
  height: 6,
  scaleX: 1.5,
  scaleY: 0.5,
  ...extra,
});

const payloadAt = (rotation: 0 | 90 | 180 | 270 | undefined, objects: Obj[], width = 100, height = 200): MarkupPayload => ({
  version: 1,
  width,
  height,
  ...(rotation === undefined ? {} : { rotation }),
  fabric: { objects },
});

const objectsOf = (p: MarkupPayload) => p.fabric.objects as Obj[];

describe("rotatePayload: page rotated in another program after saving (F3)", () => {
  test("0 -> 90: positions turn clockwise, angle +90, width/height swap", () => {
    const out = rotatePayload(payloadAt(0, [obj()]), 90);
    expect(out).toMatchObject({ width: 200, height: 100, rotation: 90 });
    expect(objectsOf(out)[0]).toMatchObject({ left: 180, top: 10, angle: 90, scaleX: 1.5, scaleY: 0.5 });
  });

  test("90 -> 0 undoes 0 -> 90", () => {
    const saved = payloadAt(90, [obj({ left: 180, top: 10, angle: 90 })], 200, 100);
    const out = rotatePayload(saved, 0);
    expect(out).toMatchObject({ width: 100, height: 200, rotation: 0 });
    expect(objectsOf(out)[0]).toMatchObject({ left: 10, top: 20, angle: 0 });
  });

  test("0 -> 180", () => {
    const out = rotatePayload(payloadAt(0, [obj({ angle: 30 })]), 180);
    expect(out).toMatchObject({ width: 100, height: 200, rotation: 180 });
    expect(objectsOf(out)[0]).toMatchObject({ left: 90, top: 180, angle: 210 });
  });

  test("270 -> 0 (a turn of +90)", () => {
    const saved = payloadAt(270, [obj({ left: 50, top: 5, angle: 315 })], 200, 100);
    const out = rotatePayload(saved, 0);
    expect(out).toMatchObject({ width: 100, height: 200, rotation: 0 });
    expect(objectsOf(out)[0]).toMatchObject({ left: 95, top: 50, angle: 45 });
  });

  test.each([
    [0, 90],
    [90, 0],
    [0, 180],
    [270, 0],
    [90, 270],
    [180, 90],
  ] as const)("%i -> %i keeps every object on the same spot of the page (corners turn with the page)", (from, to) => {
    const objects = [obj(), obj({ left: 70, top: 150, angle: 33, width: 12, height: 40 }), obj({ angle: 270, scaleX: 2 })];
    const saved = payloadAt(from, objects);
    const out = rotatePayload(saved, to);
    const delta = (to - from + 360) % 360;
    objectsOf(out).forEach((o, i) => {
      const expected = corners(objects[i]).map((p) => turn(p, delta, saved.width, saved.height));
      expect(sortPoints(corners(o))).toEqual(sortPoints(expected));
      expect(o.angle).toBeGreaterThanOrEqual(0);
      expect(o.angle).toBeLessThan(360);
    });
  });

  test("round trip 0 -> 90 -> 0 is exact", () => {
    const saved = payloadAt(0, [obj({ angle: 12.5 })]);
    const back = rotatePayload(rotatePayload(saved, 90), 0);
    expect(back.width).toBe(saved.width);
    expect(back.height).toBe(saved.height);
    const o = objectsOf(back)[0];
    expect(o.left).toBeCloseTo(10, 12);
    expect(o.top).toBeCloseTo(20, 12);
    expect(o.angle).toBeCloseTo(12.5, 12);
  });

  test("no correction when the rotation is unchanged or unknown (payloads saved before the field existed)", () => {
    const same = payloadAt(90, [obj()], 200, 100);
    expect(rotatePayload(same, 90)).toEqual(same);
    const old = payloadAt(undefined, [obj()]);
    expect(rotatePayload(old, 90)).toEqual(old);
    expect(rotatePayload(old, 0)).toEqual(old);
  });

  test("does not mutate its input and keeps other properties", () => {
    const saved = payloadAt(0, [{ ...obj(), type: "Path", __isText: true } as unknown as Obj]);
    const snapshot = structuredClone(saved);
    const out = rotatePayload(saved, 270);
    expect(saved).toEqual(snapshot);
    expect(objectsOf(out)[0]).toMatchObject({ type: "Path", __isText: true });
  });

  test("objects without angle count as 0°", () => {
    const saved = payloadAt(0, [{ left: 10, top: 20 } as Obj]);
    expect(objectsOf(rotatePayload(saved, 90))[0]).toMatchObject({ left: 180, top: 10, angle: 90 });
  });
});

describe("rotation in the save/load path", () => {
  test("payloadFromCanvas and legacyToPayload record the display rotation of the viewport", () => {
    const vp = { width: 842, height: 595, rotation: 90 };
    expect(payloadFromCanvas({ objects: [] }, 842, 595, vp).rotation).toBe(90);
    expect(legacyToPayload({ page: 1, data: { objects: [] }, drawWidth: 842, drawHeight: 595 }, vp).rotation).toBe(90);
    expect(payloadFromCanvas({ objects: [] }, 595, 842, { width: 595, height: 842 })).not.toHaveProperty("rotation");
  });

  test("saved at 0°, shown after a 90° turn, saved again and shown at 0°: back on the same spot", () => {
    const A4 = { width: 595, height: 842 };
    const saved = payloadFromCanvas({ objects: [obj({ left: 119, top: 168.4, angle: 20 })] }, 1190, 1684, { ...A4, rotation: 0 });

    // The page now shows turned by 90°: 842×595 points, drawn on a 1684×1190 canvas.
    const turnedVp = { width: 842, height: 595, rotation: 90 };
    const rotated = rotatePayload(saved, turnedVp.rotation);
    const shown = transformFabricJson(rotated.fabric, displayTransform(null, rotated, turnedVp, 1684, 1190));
    const o = shown.objects[0] as Obj;
    // (x, y) on the 0° page (points) -> (842 - y, x) on the turned page, times 2 px/pt.
    expect(o.left).toBeCloseTo((842 - 84.2) * 2, 9);
    expect(o.top).toBeCloseTo(59.5 * 2, 9);
    expect(o.angle).toBeCloseTo(110, 9);

    const resaved = payloadFromCanvas(shown, 1684, 1190, turnedVp);
    expect(resaved.rotation).toBe(90);
    const back = rotatePayload(resaved, 0);
    const shownAgain = transformFabricJson(back.fabric, displayTransform(null, back, A4, 1190, 1684)).objects[0] as Obj;
    expect(shownAgain.left).toBeCloseTo(119, 9);
    expect(shownAgain.top).toBeCloseTo(168.4, 9);
    expect(shownAgain.angle).toBeCloseTo(20, 9);
  });
});
