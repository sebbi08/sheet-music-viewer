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

/** Payload (points) -> canvas CSS pixels. `viewRect` null = whole page. */
export function displayTransform(
  viewRect: Rect | null,
  payload: MarkupPayload,
  viewport: Size,
  cssWidth: number,
): Transform2D {
  const vr = viewRect ?? [0, 0, viewport.width, viewport.height];
  const k = cssWidth / viewport.width;
  return {
    sx: ((vr[2] - vr[0]) / payload.width) * k,
    sy: ((vr[3] - vr[1]) / payload.height) * k,
    tx: vr[0] * k,
    ty: vr[1] * k,
  };
}

/** Canvas CSS pixels -> payload in points. */
export function payloadFromCanvas(
  json: { objects: unknown[] },
  cssWidth: number,
  viewport: Size,
): MarkupPayload {
  const inv = viewport.width / cssWidth;
  return {
    version: 1,
    width: viewport.width,
    height: viewport.height,
    fabric: transformFabricJson(json, { sx: inv, sy: inv, tx: 0, ty: 0 }),
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
