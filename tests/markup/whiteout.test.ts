import { describe, expect, test } from "vitest";
import { isOpaqueWhite, isWhiteout, whiteoutFirst, whiteoutIndex } from "../../src/markup/whiteout";

const white = (id: string) => ({ id, type: "Path", stroke: "rgba(255,255,255,1)", fill: null });
const black = (id: string) => ({ id, type: "Path", stroke: "rgba(0,0,0,1)", fill: null });

describe("isOpaqueWhite", () => {
  test.each(["rgba(255,255,255,1)", "rgba(255, 255, 255, 1.0)", "rgb(255,255,255)", "#fff", "#FFFFFF", "white"])(
    "%s is white",
    (c) => expect(isOpaqueWhite(c)).toBe(true),
  );
  test.each(["rgba(255,255,255,0.25)", "rgba(255,0,0,1)", "rgb(254,255,255)", "#ffffff80", "", null, undefined, 3])(
    "%s is not",
    (c) => expect(isOpaqueWhite(c)).toBe(false),
  );
});

describe("isWhiteout", () => {
  test("a path with an opaque white stroke, in fabric's JSON or as an object (type in any case)", () => {
    expect(isWhiteout(white("a"))).toBe(true);
    expect(isWhiteout({ type: "path", stroke: "rgba(255,255,255,1)" })).toBe(true);
  });

  test("other marks are not", () => {
    expect(isWhiteout(black("a"))).toBe(false);
    expect(isWhiteout({ type: "Path", stroke: "rgba(255,255,255,0.25)" })).toBe(false);
    expect(isWhiteout({ type: "Text", fill: "white", stroke: null })).toBe(false);
    expect(isWhiteout({ type: "Rect", fill: "white", stroke: "white" })).toBe(false);
    expect(isWhiteout(null)).toBe(false);
  });
});

describe("whiteoutFirst", () => {
  test("white strokes go below every other mark, both groups keep their order", () => {
    const objects = [black("b1"), white("w1"), { type: "Text", id: "t" }, white("w2"), black("b2")];
    expect(whiteoutFirst(objects).map((o) => o.id)).toEqual(["w1", "w2", "b1", "t", "b2"]);
  });

  test("an array already in that order is returned as it is", () => {
    const objects = [white("w1"), white("w2"), black("b1")];
    expect(whiteoutFirst(objects)).toBe(objects);
    const none = [black("b1"), black("b2")];
    expect(whiteoutFirst(none)).toBe(none);
  });

  test("the input is not changed", () => {
    const objects = [black("b1"), white("w1")];
    whiteoutFirst(objects);
    expect(objects.map((o) => o.id)).toEqual(["b1", "w1"]);
  });
});

describe("whiteoutIndex", () => {
  test("right above the white strokes already there", () => {
    const added = white("new");
    expect(whiteoutIndex([white("w1"), black("b1"), white("w2"), added], added)).toBe(2);
    expect(whiteoutIndex([black("b1"), added], added)).toBe(0);
  });
});
