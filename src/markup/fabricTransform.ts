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

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
 * Payload (points) -> canvas pixels. `viewRect` null = whole page. `canvasWidth`/`canvasHeight` are the
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
  viewport: Size,
): MarkupPayload {
  return {
    version: 1,
    width: viewport.width,
    height: viewport.height,
    fabric: transformFabricJson(json, {
      sx: viewport.width / canvasWidth,
      sy: viewport.height / canvasHeight,
      tx: 0,
      ty: 0,
    }),
  };
}

/** Legacy overlay (screen pixels + drawWidth/drawHeight) -> payload; x and y scaled separately, unrounded. */
export function legacyToPayload(legacy: OverlayData, viewport: Size): MarkupPayload {
  const data = legacy.data as { objects?: unknown[] };
  const json = { ...data, objects: Array.isArray(data.objects) ? data.objects : [] };
  return {
    version: 1,
    width: viewport.width,
    height: viewport.height,
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
