import { pinchView } from "./editZoom";
import type { Point, Size, ZoomView } from "./editZoom";

/** A first finger younger than this when the second one lands is treated as an accidental stroke. */
export const DISCARD_WINDOW_MS = 300;

export type PointerKind = "touch" | "pen" | "mouse";

export type GestureAction =
  | { kind: "pass" } // the event belongs to fabric as today
  | { kind: "block" } // keep the event away from fabric, nothing else happens
  | { kind: "start"; discardFirst: boolean } // a two-finger gesture begins; end the first finger's fabric
  // input and, if discardFirst, undo it (stroke / object drag)
  | { kind: "resume" } // a finger landed beside the rest of an ended gesture: a gesture begins with both
  // (fabric owns neither finger, so there is no input to end)
  | { kind: "view"; view: ZoomView } // apply this view
  | { kind: "end" }; // the gesture is over

export interface GestureTracker {
  down(id: number, kind: PointerKind, at: Point, timeMs: number): GestureAction;
  move(id: number, at: Point, timeMs: number): GestureAction;
  /** Also for cancel. */
  up(id: number, timeMs: number): GestureAction;
  /** True while a gesture runs or a finger of an ended gesture is still down. */
  blocking(): boolean;
}

interface Touch {
  at: Point;
  downMs: number;
  /** "pass": fabric owns this finger, or a gesture does; "block": it is kept away from fabric until it lifts. */
  mode: "pass" | "block";
  /** The pen went down while this finger was down: it never becomes part of a gesture. */
  penSeen: boolean;
  /** The finger that stayed down when the other finger of a gesture lifted. */
  rest?: boolean;
}

interface Gesture {
  a: number;
  b: number;
  a0: Point;
  b0: Point;
  start: ZoomView;
}

const PASS: GestureAction = { kind: "pass" };
const BLOCK: GestureAction = { kind: "block" };

export function createGestureTracker(currentView: () => ZoomView, size: () => Size): GestureTracker {
  const touches = new Map<number, Touch>();
  const pens = new Set<number>();
  let gesture: Gesture | null = null;

  const anyBlocked = (): boolean => [...touches.values()].some((t) => t.mode === "block");

  function down(id: number, kind: PointerKind, at: Point, timeMs: number): GestureAction {
    if (kind === "mouse") return PASS;
    if (kind === "pen") {
      pens.add(id);
      for (const t of touches.values()) t.penSeen = true;
      return PASS;
    }
    const others = [...touches.entries()];
    const [restId, rest] = others.length === 1 ? others[0] : [];
    if (pens.size === 0 && !gesture && rest?.rest && !rest.penSeen && restId !== undefined) {
      // The gesture takes the events of both fingers; fabric saw neither land.
      rest.rest = false;
      rest.mode = "pass";
      touches.set(id, { at, downMs: timeMs, mode: "pass", penSeen: false });
      gesture = { a: restId, b: id, a0: rest.at, b0: at, start: currentView() };
      return { kind: "resume" };
    }
    if (pens.size > 0 || gesture || anyBlocked()) {
      touches.set(id, { at, downMs: timeMs, mode: "block", penSeen: false });
      return BLOCK;
    }
    const first = others.length === 1 ? others[0] : undefined;
    if (!first) {
      touches.set(id, { at, downMs: timeMs, mode: "pass", penSeen: false });
      return PASS;
    }
    const [firstId, firstTouch] = first;
    if (firstTouch.penSeen || others.length > 1) {
      touches.set(id, { at, downMs: timeMs, mode: "block", penSeen: false });
      return BLOCK;
    }
    touches.set(id, { at, downMs: timeMs, mode: "pass", penSeen: false });
    gesture = { a: firstId, b: id, a0: firstTouch.at, b0: at, start: currentView() };
    return { kind: "start", discardFirst: timeMs - firstTouch.downMs < DISCARD_WINDOW_MS };
  }

  function move(id: number, at: Point): GestureAction {
    const touch = touches.get(id);
    if (!touch) return PASS;
    touch.at = at;
    if (touch.mode === "block") return BLOCK;
    if (gesture && (id === gesture.a || id === gesture.b)) {
      const a1 = touches.get(gesture.a)!.at;
      const b1 = touches.get(gesture.b)!.at;
      return { kind: "view", view: pinchView(gesture.start, gesture.a0, gesture.b0, a1, b1, size()) };
    }
    return PASS;
  }

  function up(id: number): GestureAction {
    const touch = touches.get(id);
    if (!touch) {
      pens.delete(id);
      return PASS;
    }
    touches.delete(id);
    if (gesture && (id === gesture.a || id === gesture.b)) {
      const rest = touches.get(id === gesture.a ? gesture.b : gesture.a);
      if (rest) Object.assign(rest, { mode: "block", rest: true });
      gesture = null;
      return { kind: "end" };
    }
    return touch.mode === "block" ? BLOCK : PASS;
  }

  return {
    down,
    move,
    up,
    blocking: () => gesture !== null || anyBlocked(),
  };
}
