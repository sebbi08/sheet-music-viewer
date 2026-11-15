import { MARKUP_DPI, MAX_PNG_SIDE_PX } from "../models/markupConstants";
import type { MarkupPayload, Rect } from "../models/markup";
import type { OverlayData } from "../models/types";

/** x' = tx + x * sx, y' = ty + y * sy */
export interface Transform2D {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

type Size = { width: number; height: number };
/** Displayed page size in points; `rotation` = display rotation in degrees (pdf.js `PageViewport`). */
type Viewport = Size & { rotation?: number };
type Rotation = 0 | 90 | 180 | 270;

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A rotation in degrees as one of 0/90/180/270 (like pdf.js, anything else counts as 0). */
export function normalizeRotation(degrees: number): Rotation {
  const r = ((degrees % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

const rotationOf = (viewport: Viewport) =>
  viewport.rotation === undefined ? {} : { rotation: normalizeRotation(viewport.rotation) };

/**
 * The payload as seen on a page displayed with `currentRotation`: if the page was turned (in another
 * program) since the payload was saved, every top-level object's position (its origin point, a fixed point
 * of the object) is turned with the page, its `angle` is increased by the same 90° steps, and width/height
 * are swapped for quarter turns. A payload without `rotation`, or saved at the current rotation, is
 * returned unchanged. The input is not mutated.
 */
export function rotatePayload(payload: MarkupPayload, currentRotation: number): MarkupPayload {
  const current = normalizeRotation(currentRotation);
  if (payload.rotation === undefined || payload.rotation === current) return payload;
  const delta = (current - payload.rotation + 360) % 360;
  const { width: w, height: h } = payload;
  // A point of the displayed page after turning the display `delta` degrees clockwise (y points down).
  const turn = (x: number, y: number): [number, number] =>
    delta === 90 ? [h - y, x] : delta === 180 ? [w - x, h - y] : [y, w - x];
  const objects = payload.fabric.objects.map((o) => {
    if (o === null || typeof o !== "object") return o;
    const obj = o as Record<string, unknown>;
    const [left, top] = turn(num(obj.left, 0), num(obj.top, 0));
    return { ...obj, left, top, angle: (((num(obj.angle, 0) + delta) % 360) + 360) % 360 };
  });
  const quarter = delta !== 180;
  return {
    ...payload,
    width: quarter ? h : w,
    height: quarter ? w : h,
    rotation: current,
    fabric: { ...payload.fabric, objects },
  };
}

/** Transforms top-level objects only (left/top/scaleX/scaleY) on a copy; the input is not mutated. */
export function transformFabricJson<T extends { objects: unknown[] }>(json: T, t: Transform2D): T {
  const objects = json.objects.map((o) => {
    if (o === null || typeof o !== "object") return o;
    const obj = o as Record<string, unknown>;
    return {
      ...obj,
      left: t.tx + num(obj.left, 0) * t.sx,
      top: t.ty + num(obj.top, 0) * t.sy,
      scaleX: num(obj.scaleX, 1) * t.sx,
      scaleY: num(obj.scaleY, 1) * t.sy,
    };
  });
  return { ...json, objects };
}

/**
 * Payload (points) -> canvas pixels. `payload` must already be in the current display orientation
 * (`rotatePayload`). `viewRect` null = whole page. `canvasWidth`/`canvasHeight` are the
 * real (integer) canvas size covering the page; each axis is scaled by its own canvas side, which is
 * what the old edit mode did and what the user drew on (differs from uniform scaling by < 0.1 %).
 */
export function displayTransform(
  viewRect: Rect | null,
  payload: MarkupPayload,
  viewport: Size,
  canvasWidth: number,
  canvasHeight: number,
): Transform2D {
  const vr = viewRect ?? [0, 0, viewport.width, viewport.height];
  const kx = canvasWidth / viewport.width;
  const ky = canvasHeight / viewport.height;
  return {
    sx: ((vr[2] - vr[0]) / payload.width) * kx,
    sy: ((vr[3] - vr[1]) / payload.height) * ky,
    tx: vr[0] * kx,
    ty: vr[1] * ky,
  };
}

/** Canvas pixels (canvas covering the whole page, real integer size) -> payload in points; inverse of `displayTransform(null, …)`. */
export function payloadFromCanvas(
  json: { objects: unknown[] },
  canvasWidth: number,
  canvasHeight: number,
  viewport: Viewport,
): MarkupPayload {
  return {
    version: 1,
    width: viewport.width,
    height: viewport.height,
    ...rotationOf(viewport),
    fabric: transformFabricJson(json, {
      sx: viewport.width / canvasWidth,
      sy: viewport.height / canvasHeight,
      tx: 0,
      ty: 0,
    }),
  };
}

/** Legacy overlay (screen pixels + drawWidth/drawHeight) -> payload; x and y scaled separately, unrounded. */
export function legacyToPayload(legacy: OverlayData, viewport: Viewport): MarkupPayload {
  const data = legacy.data as { objects?: unknown[] };
  const json = { ...data, objects: Array.isArray(data.objects) ? data.objects : [] };
  return {
    version: 1,
    width: viewport.width,
    height: viewport.height,
    ...rotationOf(viewport),
    fabric: transformFabricJson(json, {
      sx: viewport.width / legacy.drawWidth,
      sy: viewport.height / legacy.drawHeight,
      tx: 0,
      ty: 0,
    }),
  };
}

export function pngMultiplier(width: number, height: number): number {
  return Math.min(MARKUP_DPI / 72, MAX_PNG_SIDE_PX / Math.max(width, height));
}

/**
 * Pixel size of the markup PNG for a payload of `width`×`height` points, and the per-axis scale that maps
 * points onto exactly those pixels. The PDF stretches the PNG over the whole width×height points, so the
 * scale has to be pixels / points on each axis; rendering at `pngMultiplier` onto a truncated canvas drew
 * the markup up to one pixel too large towards the bottom right.
 */
export function pngLayout(width: number, height: number): { pxWidth: number; pxHeight: number; scaleX: number; scaleY: number } {
  const m = pngMultiplier(width, height);
  const pxWidth = Math.max(1, Math.min(MAX_PNG_SIDE_PX, Math.round(width * m)));
  const pxHeight = Math.max(1, Math.min(MAX_PNG_SIDE_PX, Math.round(height * m)));
  return { pxWidth, pxHeight, scaleX: pxWidth / width, scaleY: pxHeight / height };
}
