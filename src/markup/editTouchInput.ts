import type * as fabric from "fabric";
import { createGestureTracker, type GestureAction } from "./editGestures";
import type { Size, ZoomView } from "./editZoom";

export interface EditTouchInputOptions {
  canvas: fabric.Canvas;
  /** The edit canvas's view now. */
  view: () => ZoomView;
  /** The edit canvas's size (CSS px). */
  size: () => Size;
  /** Shows the edit canvas at this view (it clamps). */
  applyView: (view: ZoomView) => void;
}

/** The finger fabric follows: it saw its touchstart and has not yet seen its end. */
interface FabricTouch {
  id: number;
  clientX: number;
  clientY: number;
  /** The stroke this finger drew (fabric adds it when the finger's input ends). */
  path?: fabric.FabricObject;
  /** The object this finger moves and its placement before (`before:transform`). */
  transform?: { target: fabric.FabricObject; placement: Partial<fabric.FabricObject> };
}

/** What a transform changes and an undone first finger restores. */
const PLACEMENT_KEYS = ["left", "top", "angle", "scaleX", "scaleY", "skewX", "skewY", "flipX", "flipY"] as const;

/** Pens and touches share the tracker's ids: a pen's pointer id becomes negative (touch ids are not). */
const penId = (pointerId: number) => -1 - pointerId;

/**
 * How far (CSS px) and how late (ms) a touchstart may come after a pen's pointerdown to be that pen's touch.
 * Chromium dispatches both for the same contact, right after each other and at the same point.
 */
const PEN_TOUCH_DISTANCE = 2;
const PEN_TOUCH_DELAY_MS = 100;

let endingFabricTouch = false;

/**
 * True while fabric handles the touchend that ends its finger's input for a gesture or a cancelled touch.
 * That touchend is no tap: fabric would call the mouse-up action of a control under the finger (delete,
 * clone, edit text), so those actions check this and do nothing.
 */
export const isEndingFabricTouch = (): boolean => endingFabricTouch;

/**
 * Two fingers zoom and pan the edit canvas (spec 2026-11-23-edit-zoom „Bedienung“): touch and pen input on
 * the canvas goes to the gesture tracker first. fabric listens to touch events (`enablePointerEvents` is
 * off), on its upper canvas and, while a finger is down, on the document, both in the bubble phase; a touch
 * event the gesture takes is stopped in the capture phase at the canvas container, so fabric never sees it.
 * When a gesture starts, fabric's input of the first finger is ended with a touchend of our own and, if the
 * finger was young, undone; a cancelled finger is ended the same way. The controls' mouse-up actions do not
 * run for that touchend (`isEndingFabricTouch`). Returns the function that disconnects everything again.
 */
export function attachEditTouchInput({ canvas, view, size, applyView }: EditTouchInputOptions): () => void {
  const tracker = createGestureTracker(view, size);
  const container = canvas.wrapperEl;
  const upper = canvas.upperCanvasEl;
  let fabricTouch: FabricTouch | null = null;
  const pensDown = new Set<number>();
  /**
   * Chromium on Windows delivers a pen on the page as pen pointer events plus touch events (its touches carry
   * no `touchType`); fabric draws from those touch events. The touch that starts where a pen just went down
   * is that pen's: it goes to fabric untouched and is never a finger of the tracker.
   */
  let penLanding: { clientX: number; clientY: number; timeStamp: number } | null = null;
  const penTouches = new Set<number>();
  const isPenTouch = (event: TouchEvent, t: Touch): boolean => {
    if (penTouches.has(t.identifier)) return true;
    if (event.type !== "touchstart" || !penLanding) return false;
    const near =
      Math.abs(t.clientX - penLanding.clientX) <= PEN_TOUCH_DISTANCE &&
      Math.abs(t.clientY - penLanding.clientY) <= PEN_TOUCH_DISTANCE &&
      event.timeStamp - penLanding.timeStamp <= PEN_TOUCH_DELAY_MS;
    if (!near) return false;
    penLanding = null;
    penTouches.add(t.identifier);
    return true;
  };

  /** Ends fabric's input of its finger, as if the finger lifted where it is now. */
  function endFabricTouch(): FabricTouch | null {
    const ending = fabricTouch;
    if (!ending) return null;
    const touch = new Touch({ identifier: ending.id, target: upper, clientX: ending.clientX, clientY: ending.clientY });
    // onTouch below lets it through (endingFabricTouch); fabric's touchend listener on the document handles it.
    endingFabricTouch = true;
    try {
      upper.dispatchEvent(
        new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }),
      );
    } finally {
      endingFabricTouch = false;
    }
    fabricTouch = null;
    return ending;
  }

  /** Removes the stroke of an ended first finger, or puts the object it moved back. */
  function undo(first: FabricTouch): void {
    if (first.path) canvas.remove(first.path);
    if (first.transform) {
      first.transform.target.set(first.transform.placement);
      first.transform.target.setCoords();
    }
    canvas.requestRenderAll();
  }

  const offPath = canvas.on("path:created", ({ path }) => {
    if (fabricTouch) fabricTouch.path = path;
  });
  const offTransform = canvas.on("before:transform", ({ transform }) => {
    if (!fabricTouch || fabricTouch.transform) return;
    const target = transform.target;
    const placement: Partial<fabric.FabricObject> = {};
    for (const key of PLACEMENT_KEYS) (placement as Record<string, unknown>)[key] = target[key];
    fabricTouch.transform = { target, placement };
  });

  /** Keeps track of the finger fabric follows, for touch events that reach fabric. */
  function follow(event: TouchEvent): void {
    for (const t of Array.from(event.changedTouches)) {
      if (penTouches.has(t.identifier)) continue; // a pen stroke is never ended or undone for a gesture
      if (event.type === "touchstart") {
        fabricTouch ??= { id: t.identifier, clientX: t.clientX, clientY: t.clientY };
      } else if (fabricTouch?.id === t.identifier) {
        if (event.type === "touchmove") Object.assign(fabricTouch, { clientX: t.clientX, clientY: t.clientY });
        else fabricTouch = null;
      }
    }
  }

  function onTouch(event: TouchEvent): void {
    if (endingFabricTouch) return; // the touchend of endFabricTouch, meant for fabric
    // fabric listens to no touchcancel: a cancelled finger would leave it in the middle of its input.
    const following = fabricTouch?.id;
    if (event.type === "touchcancel" && Array.from(event.changedTouches).some((t) => t.identifier === following)) {
      endFabricTouch();
    }
    const rect = upper.getBoundingClientRect();
    let stop = false;
    let pen = false;
    let nextView: ZoomView | null = null;
    for (const t of Array.from(event.changedTouches)) {
      if (isPenTouch(event, t)) {
        pen = true;
        if (event.type === "touchend" || event.type === "touchcancel") penTouches.delete(t.identifier);
        continue;
      }
      const at = { x: t.clientX - rect.left, y: t.clientY - rect.top };
      let action: GestureAction;
      if (event.type === "touchstart") action = tracker.down(t.identifier, "touch", at, event.timeStamp);
      else if (event.type === "touchmove") action = tracker.move(t.identifier, at, event.timeStamp);
      else action = tracker.up(t.identifier, event.timeStamp);
      if (action.kind === "pass") continue;
      stop = true;
      if (action.kind === "start") {
        const first = endFabricTouch();
        if (first && action.discardFirst) undo(first);
      } else if (action.kind === "resume") {
        // fabric owns neither finger (both were blocked): there is no input to end.
      } else if (action.kind === "view") {
        nextView = action.view;
      }
    }
    if (nextView) applyView(nextView);
    // An event that carries the pen's touch always reaches fabric: the pen beats any finger in it.
    if (!pen && (stop || tracker.blocking())) {
      endFabricTouch();
      event.stopPropagation();
      event.preventDefault();
    } else {
      follow(event);
    }
  }

  // A pen reaches fabric as mouse events or (Windows) as touch events; the tracker only needs to know when it
  // is down.
  function onPenDown(event: PointerEvent): void {
    if (event.pointerType !== "pen") return;
    const rect = upper.getBoundingClientRect();
    pensDown.add(event.pointerId);
    penLanding = { clientX: event.clientX, clientY: event.clientY, timeStamp: event.timeStamp };
    tracker.down(penId(event.pointerId), "pen", { x: event.clientX - rect.left, y: event.clientY - rect.top }, event.timeStamp);
  }
  function onPenUp(event: PointerEvent): void {
    if (event.pointerType !== "pen" || !pensDown.delete(event.pointerId)) return;
    penLanding = null;
    tracker.up(penId(event.pointerId), event.timeStamp);
  }
  /** A hovering pen (no button pressed) is up, even if its pointerup never arrived. */
  function onPenMove(event: PointerEvent): void {
    if (event.buttons === 0) onPenUp(event);
  }

  const touchOptions = { capture: true, passive: false };
  const touchTypes = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;
  for (const type of touchTypes) container.addEventListener(type, onTouch, touchOptions);
  container.addEventListener("pointerdown", onPenDown, { capture: true });
  // On the document: the pen may lift outside the canvas, and nothing below can stop the capture phase here.
  document.addEventListener("pointerup", onPenUp, { capture: true });
  document.addEventListener("pointercancel", onPenUp, { capture: true });
  document.addEventListener("pointermove", onPenMove, { capture: true });

  return () => {
    for (const type of touchTypes) container.removeEventListener(type, onTouch, touchOptions);
    container.removeEventListener("pointerdown", onPenDown, { capture: true });
    document.removeEventListener("pointerup", onPenUp, { capture: true });
    document.removeEventListener("pointercancel", onPenUp, { capture: true });
    document.removeEventListener("pointermove", onPenMove, { capture: true });
    offPath();
    offTransform();
    fabricTouch = null;
    penTouches.clear();
  };
}
