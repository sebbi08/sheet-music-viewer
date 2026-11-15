import { describe, expect, test } from "vitest";
import {
  displayTransform,
  legacyToPayload,
  payloadFromCanvas,
  pngMultiplier,
  transformFabricJson,
} from "../../src/markup/fabricTransform";

describe("fabricTransform", () => {
  test("transformFabricJson", () => {
    const out = transformFabricJson(
      { objects: [{ left: 10, top: 20, scaleX: 1, scaleY: 2 }] },
      { sx: 2, sy: 3, tx: 5, ty: 7 },
    );
    expect(out.objects[0]).toMatchObject({ left: 25, top: 67, scaleX: 2, scaleY: 6 });
  });

  test("does not mutate input, keeps custom props, defaults missing numbers", () => {
    const input = { objects: [{ __isText: true, left: 1 }], other: 1 };
    const snapshot = structuredClone(input);
    const out = transformFabricJson(input, { sx: 2, sy: 2, tx: 1, ty: 1 });
    expect(input).toEqual(snapshot);
    expect(out.objects[0]).toEqual({ __isText: true, left: 3, top: 1, scaleX: 2, scaleY: 2 });
    expect(out.other).toBe(1);
  });

  test("display <-> payload round trip", () => {
    const vp = { width: 595, height: 842 };
    const p = payloadFromCanvas({ objects: [{ left: 119, top: 168.4, scaleX: 1, scaleY: 1 }] }, 1190, vp);
    expect(p.fabric.objects[0]).toMatchObject({ left: 59.5, top: 84.2, scaleX: 0.5, scaleY: 0.5 });
    const back = transformFabricJson(p.fabric, displayTransform(null, p, vp, 1190));
    expect(back.objects[0]).toMatchObject({ left: 119, top: 168.4, scaleX: 1, scaleY: 1 });
  });

  test("moved/scaled annotation rect is followed", () => {
    const t = displayTransform(
      [100, 100, 397.5, 521],
      { version: 1, width: 595, height: 842, fabric: { objects: [] } },
      { width: 595, height: 842 },
      595,
    );
    expect(t).toEqual({ sx: 0.5, sy: 0.5, tx: 100, ty: 100 });
  });

  test("legacyToPayload", () => {
    const p = legacyToPayload(
      { page: 1, data: { objects: [{ left: 50, top: 70, scaleX: 1, scaleY: 1 }] }, drawWidth: 100, drawHeight: 140 },
      { width: 595, height: 842 },
    );
    expect(p.fabric.objects[0]).toMatchObject({ left: 297.5, top: 421 });
  });

  test("legacy -> payload -> display equals old separate x/y scaling (non-uniform)", () => {
    const vp = { width: 595, height: 842 };
    const obj = { left: 37.3, top: 91.7, scaleX: 0.83, scaleY: 1.21 };
    // drawWidth/drawHeight aspect (1.0) differs from page aspect (~0.707)
    const legacy = { page: 1, data: { objects: [obj] }, drawWidth: 700, drawHeight: 700 };
    const payload = legacyToPayload(legacy, vp);
    for (const cssWidth of [595, 800, 1234.5]) {
      const canvasH = (cssWidth * vp.height) / vp.width;
      const wScale = cssWidth / legacy.drawWidth;
      const hScale = canvasH / legacy.drawHeight;
      const got = transformFabricJson(payload.fabric, displayTransform(null, payload, vp, cssWidth))
        .objects[0] as typeof obj;
      expect(got.left).toBeCloseTo(obj.left * wScale, 9);
      expect(got.top).toBeCloseTo(obj.top * hScale, 9);
      expect(got.scaleX).toBeCloseTo(obj.scaleX * wScale, 9);
      expect(got.scaleY).toBeCloseTo(obj.scaleY * hScale, 9);
    }
  });

  test("pngMultiplier caps huge pages", () => {
    expect(pngMultiplier(595, 842)).toBeCloseTo(300 / 72);
    expect(pngMultiplier(2384, 3370) * 3370).toBeLessThanOrEqual(4096);
  });
});
