import * as fabric from "fabric";

/**
 * Tight selection boxes for the music symbols on the edit canvas.
 *
 * A symbol is a `FabricText` with font size 1, scaled up (×50 when added). fabric's box around it is far
 * larger than the glyph: it is as tall as the font's line, a combining mark (accent „>“, staccato, tenuto)
 * has no advance and gets fabric's minimum text width of 2 units, and the default `strokeWidth` of 1 is
 * added to both sides although a symbol has no stroke. At ×50 the accent's box is about 150×106 px around a
 * glyph of about 21×13 px, so it catches taps far away from it.
 *
 * On the edit canvas each symbol therefore gets a box around its ink (plus `ICON_HIT_PADDING` screen pixels)
 * and draws its glyph at the same place on the page as before. The box is used for hitting, the selection
 * border, the controls and a multi-selection. Serializing restores fabric's own box, so the saved markup is
 * exactly what it was without this (older app versions, the PNG in the PDF and the read-only overlay are
 * unaffected), and symbols saved before get the tight box whenever their page is edited.
 */

/** Screen pixels around a symbol's ink that still count as the symbol (fabric `padding`). */
export const ICON_HIT_PADDING = 8;
/** Pixels of the scratch picture along the longer side of fabric's box: 1 px is under 0.5 % of it. */
const INK_RESOLUTION = 256;

/** The ink of a text in its own units, relative to the top left corner of fabric's box. */
export interface InkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixel bounds (right/bottom exclusive) of the pixels with any alpha in RGBA data; null if there are none. */
export function alphaBounds(
  data: ArrayLike<number>,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } | null {
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x >= right) right = x + 1;
      if (y < top) top = y;
      bottom = y + 1;
    }
  }
  return right > left ? { left, top, right, bottom } : null;
}

/**
 * Where `text` puts ink, by drawing it on a scratch canvas (whatever font the system falls back to, with
 * shaping, also outside fabric's box). One pixel of slack on each side for antialiasing. Null if it draws
 * nothing.
 */
export function measureInk(text: fabric.FabricText): InkRect | null {
  const { width, height } = text;
  const size = Math.max(width, height);
  if (!(size > 0)) return null;
  const unit = INK_RESOLUTION / size; // pixels per unit
  const margin = size; // units around the box: glyphs may reach outside it
  const canvas = fabric.util.createCanvasElement();
  canvas.width = Math.ceil((width + 2 * margin) * unit);
  canvas.height = Math.ceil((height + 2 * margin) * unit);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate((margin + width / 2) * unit, (margin + height / 2) * unit);
  ctx.scale(unit, unit);
  text._render(ctx); // draws around the box's centre
  const bounds = alphaBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  if (!bounds) return null;
  const x = (bounds.left - 1) / unit - margin;
  const y = (bounds.top - 1) / unit - margin;
  return {
    x,
    y,
    width: (bounds.right + 1) / unit - margin - x,
    height: (bounds.bottom + 1) / unit - margin - y,
  };
}

/** A symbol: a plain text object that is not a user's text (those can be edited and change their size). */
export function isMarkupIcon(object: fabric.FabricObject): object is fabric.FabricText {
  return object instanceof fabric.FabricText && !(object instanceof fabric.IText) && !object.get("__isText");
}

const tightened = new WeakSet<fabric.FabricObject>();

/**
 * Gives a symbol on the edit canvas a box around its ink (see the file comment); does nothing for other
 * objects, for a symbol that draws nothing or is laid out in a way this does not handle (aligned, right to
 * left, on a path, skewed), and for one already done. The glyph stays where it is on the page.
 */
export function tightenIconBounds(object: fabric.FabricObject): void {
  if (!isMarkupIcon(object) || tightened.has(object)) return;
  const text = object;
  if (text.textAlign !== "left" || text.direction !== "ltr" || text.path || text.skewX || text.skewY) return;
  const ink = measureInk(text);
  if (!ink) return;

  const box = {
    width: text.width,
    height: text.height,
    strokeWidth: text.strokeWidth,
    leftOffset: text._getLeftOffset(),
    topOffset: text._getTopOffset(),
  };
  // A text without stroke draws none, whatever its strokeWidth; fabric adds it to the box all the same.
  const strokeWidth = text.stroke ? box.strokeWidth : 0;
  // From the centre of fabric's box to the centre of the ink, in the text's units.
  const shift = new fabric.Point(ink.x + ink.width / 2 - box.width / 2, ink.y + ink.height / 2 - box.height / 2);
  const inkCenter = shift.transform(text.calcOwnMatrix());

  const setTight = () => {
    text.width = ink.width;
    text.height = ink.height;
  };
  const initDimensions = text.initDimensions;
  // fabric lays the text out again when a layout property changes; it keeps the ink box.
  text.initDimensions = function () {
    initDimensions.call(this);
    setTight();
  };
  // The glyph is drawn relative to the box's centre: keep it where it was relative to the ink.
  text._getLeftOffset = () => box.leftOffset - shift.x;
  text._getTopOffset = () => box.topOffset - shift.y;

  const toObject = text.toObject as (this: fabric.FabricText, ...args: unknown[]) => ReturnType<typeof text.toObject>;
  text.toObject = function (this: fabric.FabricText, ...args: unknown[]) {
    const tight = { left: this.left, top: this.top, width: this.width, height: this.height, strokeWidth: this.strokeWidth };
    // Serialize fabric's own box: its centre lies `shift` before the ink's centre.
    const boxCenter = new fabric.Point(-shift.x, -shift.y).transform(this.calcOwnMatrix());
    Object.assign(this, { width: box.width, height: box.height, strokeWidth: box.strokeWidth });
    const origin = this.translateToOriginPoint(boxCenter, this.originX, this.originY);
    this.left = origin.x;
    this.top = origin.y;
    try {
      return toObject.apply(this, args);
    } finally {
      Object.assign(this, tight);
    }
  } as typeof text.toObject;

  setTight();
  text.strokeWidth = strokeWidth;
  text.padding = ICON_HIT_PADDING;
  text.setPositionByOrigin(inkCenter, "center", "center");
  text.dirty = true;
  text.setCoords();
  tightened.add(text);
}
