import { describe, expect, test, vi } from "vitest";

// fabric's browser build needs a DOM; its node build brings jsdom and node-canvas.
vi.mock("fabric", async () => await import("fabric/node"));

import * as fabric from "fabric";
import { alphaBounds, ICON_HIT_PADDING, isMarkupIcon, measureInk, tightenIconBounds } from "../../src/markup/iconBounds";

/** Accent „>“: a combining mark without advance, the case with the largest box. */
const ACCENT = "\u{1D17B}";
const SHARP = "\u{266F}";

/** A symbol as `addMusicIcon` creates it (font size 1, ×50), at a position on a 600×800 canvas. */
function icon(code: string, extra: Partial<fabric.TextProps> = {}): fabric.FabricText {
  return new fabric.FabricText(code, {
    fill: "red",
    fontSize: 1,
    fontWeight: 500,
    fontFamily: "noto-icons",
    scaleX: 50,
    scaleY: 50,
    left: 300,
    top: 400,
    ...extra,
  });
}

/** The ink of `object` as drawn on a canvas of its own (pixel bounds). */
function drawnInk(object: fabric.FabricObject) {
  const canvas = fabric.util.createCanvasElement();
  canvas.width = 600;
  canvas.height = 800;
  const ctx = canvas.getContext("2d")!;
  object.render(ctx);
  return alphaBounds(ctx.getImageData(0, 0, 600, 800).data, 600, 800);
}

function boxSize(object: fabric.FabricObject) {
  const [tl, tr, , bl] = object.getCoords();
  return { width: tl.distanceFrom(tr), height: tl.distanceFrom(bl) };
}

describe("alphaBounds", () => {
  test("bounds of the pixels with alpha, right/bottom exclusive", () => {
    const data = new Uint8ClampedArray(4 * 5 * 4);
    data[(1 * 5 + 2) * 4 + 3] = 1;
    data[(3 * 5 + 3) * 4 + 3] = 255;
    expect(alphaBounds(data, 5, 4)).toEqual({ left: 2, top: 1, right: 4, bottom: 4 });
  });

  test("null without any pixel", () => {
    expect(alphaBounds(new Uint8ClampedArray(4 * 9), 3, 3)).toBeNull();
  });
});

describe("tightenIconBounds", () => {
  const cases: [string, Partial<fabric.TextProps>][] = [
    ["accent", {}],
    ["accent, origin left/top", { originX: "left", originY: "top" }],
    ["accent, turned 90° and scaled unevenly", { angle: 90, scaleX: 70, scaleY: 40 }],
    ["accent, flipped", { flipX: true, angle: 180 }],
  ];

  test.each(cases)("%s: saved exactly as before", (_, extra) => {
    const text = icon(ACCENT, extra);
    const before = text.toObject();
    tightenIconBounds(text);
    expect(text.toObject()).toEqual(before);
  });

  test.each(cases)("%s: the glyph stays on the same pixels", (_, extra) => {
    const plain = icon(ACCENT, extra);
    const text = icon(ACCENT, extra);
    tightenIconBounds(text);
    const expected = drawnInk(plain);
    expect(expected).not.toBeNull();
    expect(drawnInk(text)).toEqual(expected);
  });

  test("the box shrinks to the ink (plus padding on screen)", () => {
    for (const code of [ACCENT, SHARP, "x"]) {
      const text = icon(code);
      const before = boxSize(text);
      const ink = measureInk(text)!;
      tightenIconBounds(text);
      const after = boxSize(text);
      expect(after.width).toBeCloseTo(ink.width * 50, 6);
      expect(after.height).toBeCloseTo(ink.height * 50, 6);
      // At least the phantom stroke (1 unit × 50) is gone on each axis.
      expect(after.width).toBeLessThan(before.width - 50);
      expect(after.height).toBeLessThan(before.height - 50);
      expect(text.padding).toBe(ICON_HIT_PADDING);

      // The box covers the glyph as drawn (to the pixel its antialiased edge touches).
      const drawn = drawnInk(text)!;
      const [tl, , br] = text.getCoords();
      expect(tl.x).toBeLessThan(drawn.left + 1);
      expect(tl.y).toBeLessThan(drawn.top + 1);
      expect(br.x).toBeGreaterThan(drawn.right - 1);
      expect(br.y).toBeGreaterThan(drawn.bottom - 1);
    }
  });

  test("a moved symbol is saved moved by the same distance", () => {
    const text = icon(ACCENT, { originX: "left", originY: "top" });
    const before = text.toObject();
    tightenIconBounds(text);
    text.set({ left: text.left + 30, top: text.top - 12 });
    const saved = text.toObject();
    expect(saved.left).toBeCloseTo(before.left + 30, 6);
    expect(saved.top).toBeCloseTo(before.top - 12, 6);
    expect(saved.width).toBe(before.width);
    expect(saved.strokeWidth).toBe(1);
  });

  test("a clone is a plain symbol at the clone's place", async () => {
    const text = icon(ACCENT);
    const before = text.toObject();
    tightenIconBounds(text);
    const clone = (await text.clone()) as fabric.FabricText;
    expect(clone.toObject()).toEqual(before);
    tightenIconBounds(clone);
    expect(boxSize(clone)).toEqual(boxSize(text));
  });

  test("a new layout keeps the ink box", () => {
    const text = icon(ACCENT);
    tightenIconBounds(text);
    const size = { width: text.width, height: text.height };
    text.initDimensions();
    expect({ width: text.width, height: text.height }).toEqual(size);
  });

  test("applied once", () => {
    const text = icon(ACCENT);
    tightenIconBounds(text);
    const left = text.left;
    const width = text.width;
    tightenIconBounds(text);
    expect([text.left, text.width]).toEqual([left, width]);
  });

  test("user texts, editable texts and other objects stay as they are", () => {
    const userText = new fabric.FabricText("Hallo", { fontSize: 16, __isText: true } as Partial<fabric.TextProps>);
    const iText = new fabric.IText("Hallo", { fontSize: 16 });
    const rect = new fabric.Rect({ width: 10, height: 10 });
    const objects: fabric.FabricObject[] = [userText, iText, rect];
    expect(objects.map((o) => isMarkupIcon(o))).toEqual([false, false, false]);
    for (const object of objects) {
      const before = { ...object.toObject(), w: object.width, h: object.height, padding: object.padding };
      tightenIconBounds(object);
      expect({ ...object.toObject(), w: object.width, h: object.height, padding: object.padding }).toEqual(before);
    }
  });

  test("a text that draws nothing keeps fabric's box", () => {
    const text = icon(" ");
    const width = text.width;
    tightenIconBounds(text);
    expect(text.width).toBe(width);
    expect(text.padding).toBe(0);
  });
});
