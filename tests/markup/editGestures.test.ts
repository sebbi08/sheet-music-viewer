import { describe, expect, test } from "vitest";
import { FIT_VIEW, pinchView } from "../../src/markup/editZoom";
import type { ZoomView } from "../../src/markup/editZoom";
import { createGestureTracker } from "../../src/markup/editGestures";

const size = { width: 600, height: 800 };
const pass = { kind: "pass" };
const block = { kind: "block" };

function setup(view: ZoomView = FIT_VIEW) {
  return createGestureTracker(
    () => view,
    () => size,
  );
}

describe("edit gesture tracker", () => {
  test("a single touch passes everything to fabric", () => {
    const t = setup();
    expect(t.down(1, "touch", { x: 10, y: 10 }, 0)).toEqual(pass);
    expect(t.move(1, { x: 20, y: 20 }, 10)).toEqual(pass);
    expect(t.up(1, 20)).toEqual(pass);
    expect(t.blocking()).toBe(false);
  });

  test("two touches start a gesture and discard a young first stroke", () => {
    const young = setup();
    young.down(1, "touch", { x: 0, y: 0 }, 0);
    expect(young.down(2, "touch", { x: 100, y: 0 }, 299)).toEqual({
      kind: "start",
      discardFirst: true,
    });
    const old = setup();
    old.down(1, "touch", { x: 0, y: 0 }, 0);
    expect(old.down(2, "touch", { x: 100, y: 0 }, 300)).toEqual({
      kind: "start",
      discardFirst: false,
    });
  });

  test("moves during the gesture give pinch views from the view at start", () => {
    let current: ZoomView = { zoom: 2, x: -100, y: -100 };
    const t = createGestureTracker(
      () => current,
      () => size,
    );
    const a0 = { x: 100, y: 200 };
    const b0 = { x: 200, y: 200 };
    t.down(1, "touch", a0, 0);
    t.down(2, "touch", b0, 500);
    const start = current;
    current = FIT_VIEW; // changes after start must not matter
    const a1 = { x: 50, y: 200 };
    expect(t.move(1, a1, 510)).toEqual({
      kind: "view",
      view: pinchView(start, a0, b0, a1, b0, size),
    });
    const b1 = { x: 260, y: 220 };
    expect(t.move(2, b1, 520)).toEqual({
      kind: "view",
      view: pinchView(start, a0, b0, a1, b1, size),
    });
    expect(t.blocking()).toBe(true);
  });

  test("a third touch is blocked", () => {
    const t = setup();
    t.down(1, "touch", { x: 0, y: 0 }, 0);
    t.down(2, "touch", { x: 100, y: 0 }, 500);
    expect(t.down(3, "touch", { x: 50, y: 50 }, 600)).toEqual(block);
    expect(t.move(3, { x: 60, y: 60 }, 610)).toEqual(block);
    expect(t.up(3, 620)).toEqual(block);
    expect(t.blocking()).toBe(true);
  });

  test("lifting a finger ends the gesture; the rest stays blocked until it lifts", () => {
    const t = setup();
    t.down(1, "touch", { x: 0, y: 0 }, 0);
    t.down(2, "touch", { x: 100, y: 0 }, 500);
    expect(t.up(1, 600)).toEqual({ kind: "end" });
    expect(t.blocking()).toBe(true);
    expect(t.move(2, { x: 120, y: 0 }, 610)).toEqual(block);
    expect(t.down(3, "touch", { x: 5, y: 5 }, 620)).toEqual(block);
    expect(t.up(2, 630)).toEqual(block);
    expect(t.blocking()).toBe(true);
    expect(t.up(3, 640)).toEqual(block);
    expect(t.blocking()).toBe(false);
    expect(t.down(4, "touch", { x: 0, y: 0 }, 700)).toEqual(pass);
  });

  test("touches while the pen is down never start a gesture", () => {
    const t = setup();
    expect(t.down(9, "pen", { x: 0, y: 0 }, 0)).toEqual(pass);
    expect(t.down(1, "touch", { x: 0, y: 0 }, 10)).toEqual(block);
    expect(t.down(2, "touch", { x: 100, y: 0 }, 20)).toEqual(block);
    expect(t.move(1, { x: 5, y: 5 }, 30)).toEqual(block);
    expect(t.move(2, { x: 105, y: 5 }, 30)).toEqual(block);
    expect(t.up(9, 40)).toEqual(pass);
    t.up(1, 50);
    t.up(2, 50);
    expect(t.blocking()).toBe(false);
    t.down(3, "touch", { x: 0, y: 0 }, 100);
    expect(t.down(4, "touch", { x: 100, y: 0 }, 150)).toMatchObject({ kind: "start" });
  });

  test("a pen stroke is never discarded", () => {
    const t = setup();
    expect(t.down(1, "touch", { x: 0, y: 0 }, 0)).toEqual(pass);
    expect(t.down(9, "pen", { x: 50, y: 50 }, 100)).toEqual(pass);
    expect(t.down(2, "touch", { x: 100, y: 0 }, 150)).toEqual(block);
    expect(t.move(1, { x: 1, y: 1 }, 160)).toEqual(pass);
    expect(t.up(1, 170)).toEqual(pass);
  });

  test("a touch that was down before the pen never becomes part of a gesture", () => {
    const t = setup();
    t.down(1, "touch", { x: 0, y: 0 }, 0);
    t.down(9, "pen", { x: 50, y: 50 }, 100);
    t.up(9, 110);
    expect(t.down(2, "touch", { x: 100, y: 0 }, 120)).toEqual(block);
    expect(t.move(1, { x: 1, y: 1 }, 130)).toEqual(pass);
  });

  test("a mouse never counts as a finger", () => {
    const t = setup();
    expect(t.down(5, "mouse", { x: 0, y: 0 }, 0)).toEqual(pass);
    expect(t.down(1, "touch", { x: 0, y: 0 }, 10)).toEqual(pass);
    expect(t.move(5, { x: 1, y: 1 }, 20)).toEqual(pass);
    expect(t.up(5, 30)).toEqual(pass);
    expect(t.blocking()).toBe(false);
  });

  test("up of an unknown id passes", () => {
    expect(setup().up(42, 0)).toEqual(pass);
  });
});
