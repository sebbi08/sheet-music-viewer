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
    const p = payloadFromCanvas({ objects: [{ left: 119, top: 168.4, scaleX: 1, scaleY: 1 }] }, 1190, 1684, vp);
    expect(p.fabric.objects[0]).toMatchObject({ left: 59.5, top: 84.2, scaleX: 0.5, scaleY: 0.5 });
    const back = transformFabricJson(p.fabric, displayTransform(null, p, vp, 1190, 1684));
    expect(back.objects[0]).toMatchObject({ left: 119, top: 168.4, scaleX: 1, scaleY: 1 });
  });

  test("round trip payload -> display -> payload is exact for the same integer canvas size", () => {
    const vp = { width: 595.28, height: 841.89 };
    const obj = { left: 123.456, top: 789.012, scaleX: 0.83, scaleY: 1.21 };
    const payload = { version: 1 as const, width: vp.width, height: vp.height, fabric: { objects: [obj] } };
    for (const [w, h] of [[1097, 1552], [812, 1148], [595, 841]]) {
      const shown = transformFabricJson(payload.fabric, displayTransform(null, payload, vp, w, h));
      const back = payloadFromCanvas(shown, w, h, vp).fabric.objects[0] as typeof obj;
      expect(back.left).toBeCloseTo(obj.left, 9);
      expect(back.top).toBeCloseTo(obj.top, 9);
      expect(back.scaleX).toBeCloseTo(obj.scaleX, 9);
      expect(back.scaleY).toBeCloseTo(obj.scaleY, 9);
    }
  });

  test("moved/scaled annotation rect is followed", () => {
    const t = displayTransform(
      [100, 100, 397.5, 521],
      { version: 1, width: 595, height: 842, fabric: { objects: [] } },
      { width: 595, height: 842 },
      595,
      842,
    );
    expect(t).toEqual({ sx: 0.5, sy: 0.5, tx: 100, ty: 100 });
  });

  test("each axis is scaled by its own canvas side", () => {
    const t = displayTransform(
      [100, 200, 397.5, 621],
      { version: 1, width: 595, height: 842, fabric: { objects: [] } },
      { width: 595, height: 842 },
      1190,
      842,
    );
    expect(t).toEqual({ sx: 1, sy: 0.5, tx: 200, ty: 200 });
  });

  test("legacyToPayload", () => {
    const p = legacyToPayload(
      { page: 1, data: { objects: [{ left: 50, top: 70, scaleX: 1, scaleY: 1 }] }, drawWidth: 100, drawHeight: 140 },
      { width: 595, height: 842 },
    );
    expect(p.fabric.objects[0]).toMatchObject({ left: 297.5, top: 421 });
  });

  test("legacy -> payload -> display equals the old edit mode (x by canvas.width/drawWidth, y by canvas.height/drawHeight)", () => {
    const vp = { width: 595.28, height: 841.89 };
    const obj = { left: 37.3, top: 91.7, scaleX: 0.83, scaleY: 1.21 };
    // drawWidth/drawHeight aspect (1.0) differs from page aspect (~0.707)
    const legacy = { page: 1, data: { objects: [obj] }, drawWidth: 700, drawHeight: 700 };
    const payload = legacyToPayload(legacy, vp);
    // Canvas sizes are integer-truncated CSS sizes, so their aspect differs slightly from the page's.
    for (const cssHeight of [841.89, 1148.3, 1552]) {
      const canvasW = Math.trunc((cssHeight * vp.width) / vp.height);
      const canvasH = Math.trunc(cssHeight);
      const wScale = canvasW / legacy.drawWidth;
      const hScale = canvasH / legacy.drawHeight;
      const got = transformFabricJson(payload.fabric, displayTransform(null, payload, vp, canvasW, canvasH))
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
