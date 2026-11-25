/**
 * The white pen covers printed notes. It lies below every other mark (pen, highlighter, symbols, texts), so
 * it never hides markup, whenever it was drawn. No Electron or fabric imports (unit-tested).
 */

/** An opaque white colour as fabric stores it (`rgba(255,255,255,1)` from the pen; also rgb, hex, `white`). */
export function isOpaqueWhite(color: unknown): boolean {
  if (typeof color !== "string") return false;
  const c = color.replace(/\s+/g, "").toLowerCase();
  if (c === "white" || c === "#fff" || c === "#ffffff" || c === "#ffff" || c === "#ffffffff") return true;
  const m = /^rgba?\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(?:,(\d*\.?\d+))?\)$/.exec(c);
  return !!m && [m[1], m[2], m[3]].every((v) => Number(v) >= 255) && (m[4] === undefined || Number(m[4]) >= 1);
}

/** A stroke of the white pen: a path (fabric object or its JSON) with an opaque white stroke. */
export function isWhiteout(object: unknown): boolean {
  if (object === null || typeof object !== "object") return false;
  const { type, stroke } = object as { type?: unknown; stroke?: unknown };
  return typeof type === "string" && type.toLowerCase() === "path" && isOpaqueWhite(stroke);
}

/**
 * The objects with the white pen's strokes first (drawn first = lowest), both groups in their order. Returns
 * `objects` itself when it is already in that order.
 */
export function whiteoutFirst<T>(objects: T[]): T[] {
  const white = objects.filter(isWhiteout);
  if (white.every((o, i) => objects[i] === o)) return objects;
  return [...white, ...objects.filter((o) => !isWhiteout(o))];
}

/** Where a newly added white stroke belongs in `objects` (which holds it): right above the other ones. */
export function whiteoutIndex<T>(objects: T[], object: T): number {
  return objects.filter((o) => o !== object && isWhiteout(o)).length;
}
