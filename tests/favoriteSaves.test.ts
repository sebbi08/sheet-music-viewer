import { describe, expect, test } from "vitest";
import { FavoriteSaves, type SaveResult } from "../src/favoriteSaves";

function setup(outcomes: boolean[]) {
  let state = false;
  const saved: boolean[] = [];
  const notices: string[] = [];
  let i = 0;
  const saves = new FavoriteSaves(
    async (_id, fav) => {
      saved.push(fav);
      await Promise.resolve();
      const ok = outcomes[i++];
      return (ok ? { ok: true } : { ok: false, message: "kaputt" }) as SaveResult;
    },
    (_id, fav) => {
      state = fav;
    },
    (m) => notices.push(m),
  );
  const press = (fav: boolean) => saves.set("k", fav, state);
  return { press, get: () => state, saved, notices };
}

describe("FavoriteSaves", () => {
  test("two presses succeed: last press, saves in order", async () => {
    const t = setup([true, true]);
    await Promise.all([t.press(true), t.press(false)]);
    expect(t.get()).toBe(false);
    expect(t.saved).toEqual([true, false]);
    expect(t.notices).toEqual([]);
  });
  test("both fail: confirmed state, one notice", async () => {
    const t = setup([false, false]);
    await Promise.all([t.press(true), t.press(false)]);
    expect(t.get()).toBe(false);
    expect(t.notices).toEqual(["kaputt"]);
  });
  test("both fail, ending on true: reverts to unmarked", async () => {
    const t = setup([false, false, false]);
    await Promise.all([t.press(true), t.press(false), t.press(true)]);
    expect(t.get()).toBe(false);
    expect(t.notices).toHaveLength(1);
  });
  test("A fails, B succeeds: state B, no notice", async () => {
    const t = setup([false, true]);
    await Promise.all([t.press(true), t.press(false)]);
    expect(t.get()).toBe(false);
    expect(t.notices).toEqual([]);
  });
  test("A fails, B succeeds (B differs from disk)", async () => {
    const t = setup([false, true]);
    await Promise.all([t.press(true), t.press(true)]);
    expect(t.get()).toBe(true);
    expect(t.notices).toEqual([]);
  });
  test("A succeeds, B fails: state A, one notice", async () => {
    const t = setup([true, false]);
    await Promise.all([t.press(true), t.press(false)]);
    expect(t.get()).toBe(true);
    expect(t.notices).toEqual(["kaputt"]);
  });
  test("later press after a failed one starts from the confirmed state", async () => {
    const t = setup([false, false]);
    await t.press(true);
    expect(t.get()).toBe(false);
    await t.press(true);
    expect(t.get()).toBe(false);
    expect(t.notices).toHaveLength(2);
  });
});
