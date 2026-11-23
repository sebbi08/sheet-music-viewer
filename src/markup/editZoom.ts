export const MIN_ZOOM = 1;
export const MAX_ZOOM = 20;

/** Screen position of a canvas point p: p * zoom + (x, y), in CSS px of the edit canvas; x, y <= 0. */
export interface ZoomView {
  zoom: number;
  x: number;
  y: number;
}
/** CSS size of the edit canvas. */
export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}

export const FIT_VIEW: ZoomView = { zoom: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function clampView(view: ZoomView, size: Size): ZoomView {
  const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
  return {
    zoom,
    x: clamp(view.x, size.width - size.width * zoom, 0),
    y: clamp(view.y, size.height - size.height * zoom, 0),
  };
}

/** Multiplies the zoom by `factor`, keeping the screen point `at` over the same canvas point (unless clamped). */
export function zoomAt(view: ZoomView, factor: number, at: Point, size: Size): ZoomView {
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const px = (at.x - view.x) / view.zoom;
  const py = (at.y - view.y) / view.zoom;
  return clampView({ zoom, x: at.x - px * zoom, y: at.y - py * zoom }, size);
}

export function panBy(view: ZoomView, dx: number, dy: number, size: Size): ZoomView {
  return clampView({ zoom: view.zoom, x: view.x + dx, y: view.y + dy }, size);
}

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** View for two fingers that moved from (a0, b0) to (a1, b1), starting from `start`: zoom by the distance
 *  ratio, and the canvas point under the start midpoint follows the current midpoint. */
export function pinchView(
  start: ZoomView,
  a0: Point,
  b0: Point,
  a1: Point,
  b1: Point,
  size: Size,
): ZoomView {
  const d0 = distance(a0, b0);
  const ratio = d0 > 0 ? distance(a1, b1) / d0 : 1;
  const m0 = midpoint(a0, b0);
  const m1 = midpoint(a1, b1);
  const zoomed = zoomAt(start, ratio, m0, size);
  return panBy(zoomed, m1.x - m0.x, m1.y - m0.y, size);
}

/** Zoom factor of one wheel event with Ctrl. */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-clamp(deltaY, -200, 200) * 0.0025);
}

export function toViewportTransform(
  view: ZoomView,
): [number, number, number, number, number, number] {
  return [view.zoom, 0, 0, view.zoom, view.x, view.y];
}

/** Canvas point shown at the centre of the screen area. */
export function viewCenter(view: ZoomView, size: Size): Point {
  return {
    x: (size.width / 2 - view.x) / view.zoom,
    y: (size.height / 2 - view.y) / view.zoom,
  };
}

export const isZoomed = (view: ZoomView): boolean => view.zoom > 1;

/** What a wheel event brings for the view. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/**
 * View after one wheel event over the edit canvas at the screen point `at`: Ctrl zooms around `at` (also a
 * trackpad pinch), the wheel alone pans, Shift pans sideways only: by deltaX, as Chromium delivers Shift +
 * wheel on Windows (a horizontal wheel, deltaY 0), or else by deltaY.
 */
export function viewForWheel(view: ZoomView, wheel: WheelInput, at: Point, size: Size): ZoomView {
  if (wheel.ctrlKey) return zoomAt(view, wheelZoomFactor(wheel.deltaY), at, size);
  if (wheel.shiftKey) return panBy(view, -(wheel.deltaX || wheel.deltaY), 0, size);
  return panBy(view, -wheel.deltaX, -wheel.deltaY, size);
}

/**
 * The view to show for `requested` (clamped), or null when there is nothing to do: the clamped view is the
 * current one, or it is zoomed while there is no sharp page picture to show below it (`canZoom`; the marks
 * would be zoomed over the 1x page). Back to the whole page always works.
 */
export function viewToApply(current: ZoomView, requested: ZoomView, size: Size, canZoom: boolean): ZoomView | null {
  const next = clampView(requested, size);
  if (next.zoom === current.zoom && next.x === current.x && next.y === current.y) return null;
  if (isZoomed(next) && !canZoom) return null;
  return next;
}
