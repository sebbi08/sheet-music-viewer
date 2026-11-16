import { afterEach, describe, expect, test, vi } from "vitest";
import { legacyToPayload } from "../../src/markup/fabricTransform";
import {
  convertLegacyOverlayData,
  hasMarkup,
  sidecarPagesToChanges,
  type ViewportOf,
} from "../../src/markup/legacyMigration";
import type { MarkupPayload } from "../../src/models/markup";

afterEach(() => vi.restoreAllMocks());

const viewportOf: ViewportOf = async () => ({ width: 600, height: 800, rotation: 0 });
const rect = { type: "rect", left: 100, top: 200, width: 50, height: 40, angle: 0, scaleX: 1, scaleY: 1 };
const entry = (page: number, objects: unknown = [rect], extra: object = {}) => ({
  page,
  data: { version: "7", objects },
  drawWidth: 300,
  drawHeight: 400,
  ...extra,
});
const convert = (value: unknown, numPages = 5, skip?: ReadonlySet<number>) =>
  convertLegacyOverlayData(typeof value === "string" ? value : JSON.stringify(value), numPages, viewportOf, skip);

describe("convertLegacyOverlayData", () => {
  test("empty text is no markup", async () => {
    expect(await convert("")).toEqual({ changes: [], unreadable: false });
    expect(await convert("  \n")).toEqual({ changes: [], unreadable: false });
  });

  test("first entry of a page wins", async () => {
    const { changes } = await convert([entry(1, [rect]), entry(1, [])]);
    expect(changes).toHaveLength(1);
    expect(changes[0][1]).not.toBeNull();
  });

  test("pages beyond numPages are ignored", async () => {
    const { changes, unreadable } = await convert([entry(1), entry(6)], 5);
    expect(changes.map(([p]) => p)).toEqual([1]);
    expect(unreadable).toBe(false);
  });

  test("page with empty objects becomes null", async () => {
    const { changes } = await convert([entry(2, []), { page: 3, data: {}, drawWidth: 1, drawHeight: 1 }]);
    expect(changes).toEqual([
      [2, null],
      [3, null],
    ]);
  });

  test("invalid drawWidth marks unreadable but keeps readable pages", async () => {
    const { changes, unreadable } = await convert([entry(1, [rect], { drawWidth: 0 }), entry(2)]);
    expect(unreadable).toBe(true);
    expect(changes.map(([p]) => p)).toEqual([2]);
  });

  test("invalid page number is unreadable", async () => {
    expect((await convert([entry(0), { data: {} }])).unreadable).toBe(true);
  });

  test("non-array json is unreadable", async () => {
    expect(await convert({ page: 1 })).toEqual({ changes: [], unreadable: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await convert("{not json")).toEqual({ changes: [], unreadable: true });
  });

  test("skipPages are left out", async () => {
    const { changes } = await convert([entry(1), entry(2), entry(3, [])], 5, new Set([1, 3]));
    expect(changes.map(([p]) => p)).toEqual([2]);
  });

  test("converted payload equals legacyToPayload for a corpus-like entry", async () => {
    const e = entry(1);
    const { changes } = await convert([e]);
    const state = changes[0][1];
    expect(state?.rect).toBeNull();
    expect(state?.payload).toEqual(legacyToPayload(e, { width: 600, height: 800, rotation: 0 }));
    expect(state?.payload.fabric.objects).toHaveLength(1);
  });
});

describe("sidecarPagesToChanges", () => {
  const payload = (rotation?: 0 | 90 | 180 | 270): MarkupPayload => ({
    version: 1,
    width: 600,
    height: 800,
    ...(rotation === undefined ? {} : { rotation }),
    fabric: { objects: [{ ...rect }] },
  });

  test("v1 pages are rotated to the current rotation", async () => {
    const turned: ViewportOf = async () => ({ width: 800, height: 600, rotation: 90 });
    const r: [number, number, number, number] = [0, 0, 10, 10];
    const changes = await sidecarPagesToChanges([{ page: 1, rect: r, payload: payload(0) }], 3, turned);
    const state = changes[0][1];
    expect(state?.rect).toEqual(r);
    expect(state?.payload.rotation).toBe(90);
    expect(state?.payload.fabric.objects[0]).not.toEqual(payload(0).fabric.objects[0]);
  });

  test("skips pages beyond numPages and skipPages; keeps unrotated payloads", async () => {
    const p = payload();
    const changes = await sidecarPagesToChanges(
      [
        { page: 1, rect: null, payload: p },
        { page: 2, rect: null, payload: p },
        { page: 9, rect: null, payload: p },
      ],
      3,
      viewportOf,
      new Set([2]),
    );
    expect(changes).toEqual([[1, { rect: null, payload: p }]]);
  });
});

describe("hasMarkup", () => {
  test("only null changes carry no markup", () => {
    const state = { rect: null, payload: { version: 1 as const, width: 1, height: 1, fabric: { objects: [] } } };
    expect(hasMarkup([])).toBe(false);
    expect(hasMarkup([[1, null]])).toBe(false);
    expect(hasMarkup([[1, null], [2, state]])).toBe(true);
  });
});
