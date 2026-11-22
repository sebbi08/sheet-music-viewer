import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CONFIG_FILE } from "../src/folderConfig";
import type { SetListsWrapper } from "../src/models/types";
import { setLockRetryDelays } from "../src/pdfMarkup/lockRetry";
import {
  setListsChangedText,
  setListsNewerVersionText,
  setListsSaveFailedText,
  setListsUnreadableText,
} from "../src/store/setListTexts";
import { loadSetLists, saveSetLists, saveSetListsInputSchema } from "../src/trcpLib";

// trcpLib.ts imports Electron at the top; the set list functions do not use it.
vi.mock("electron", () => ({ app: { isPackaged: false }, autoUpdater: {}, dialog: {} }));

/** chmod-based tests do not work as root (root ignores permission bits). */
const isRoot = process.getuid?.() === 0;

const setLists: SetListsWrapper = {
  version: 2,
  setLists: [{ id: 1, name: "Advent", sheets: [{ path: ["Weihnachten"], name: "a.pdf", isFile: true, isSearch: false }] }],
};
const mark = { at: "2026-11-22T10:15:00.000Z" };
const other: SetListsWrapper = { version: 2, setLists: [{ id: 2, name: "Ostern", sheets: [] }] };

let dir: string;
let previousDelays: readonly number[];
const configPath = () => path.join(dir, CONFIG_FILE);
const readConfig = () => JSON.parse(fs.readFileSync(configPath(), "utf8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-set-lists-"));
  previousDelays = setLockRetryDelays([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  setLockRetryDelays(previousDelays);
  fs.chmodSync(dir, 0o755);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadSetLists", () => {
  test("no file -> ok with null (none stored), nothing written", async () => {
    expect(await loadSetLists(dir)).toEqual({ kind: "ok", setLists: null });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("a file without set lists -> ok with null", async () => {
    fs.writeFileSync(configPath(), JSON.stringify({ version: 1, markupMigrated: mark }));
    expect(await loadSetLists(dir)).toEqual({ kind: "ok", setLists: null });
  });

  test("a missing sheet folder -> unreadable, never empty set lists", async () => {
    expect(await loadSetLists(path.join(dir, "weg"))).toEqual({
      kind: "unreadable",
      file: CONFIG_FILE,
      message: "Der Notenordner ist nicht erreichbar.",
    });
  });

  test("a file with set lists -> ok with them", async () => {
    fs.writeFileSync(configPath(), JSON.stringify({ version: 1, setLists }));
    expect(await loadSetLists(dir)).toEqual({ kind: "ok", setLists });
  });

  test("broken JSON -> unreadable with the file and a message", async () => {
    fs.writeFileSync(configPath(), "{");
    const result = await loadSetLists(dir);
    expect(result).toMatchObject({ kind: "unreadable", file: CONFIG_FILE });
    expect(result.kind === "unreadable" && result.message.length).toBeGreaterThan(0);
    expect(fs.readFileSync(configPath(), "utf8")).toBe("{");
  });
});

describe("saveSetLists", () => {
  test("keeps an existing markupMigrated", async () => {
    fs.writeFileSync(configPath(), JSON.stringify({ version: 1, markupMigrated: mark }));
    expect(await saveSetLists({ basePath: dir, setListsWrapper: setLists, base: null })).toEqual({ ok: true });
    expect(readConfig()).toEqual({ version: 1, setLists, markupMigrated: mark });
  });

  test("base null against a missing file -> written", async () => {
    expect(await saveSetLists({ basePath: dir, setListsWrapper: setLists, base: null })).toEqual({ ok: true });
    expect(readConfig()).toEqual({ version: 1, setLists });
  });

  test("the base the renderer loaded -> written", async () => {
    fs.writeFileSync(configPath(), JSON.stringify({ version: 1, setLists, markupMigrated: mark }));
    const loaded = await loadSetLists(dir);
    expect(loaded.kind).toBe("ok");
    const base = loaded.kind === "ok" ? loaded.setLists : null;
    const next: SetListsWrapper = { version: 2, setLists: [...setLists.setLists, { id: 2, name: "Ostern", sheets: [] }] };
    expect(await saveSetLists({ basePath: dir, setListsWrapper: next, base })).toEqual({ ok: true });
    expect(readConfig()).toEqual({ version: 1, setLists: next, markupMigrated: mark });
  });

  test.each([
    ["other set lists on disk", { version: 1, setLists: other }, setLists],
    ["set lists on disk, base null", { version: 1, setLists: other }, null],
    ["no set lists on disk, base set", { version: 1, markupMigrated: mark }, setLists],
    ["no file, base set", null, setLists],
  ])("a stale base (%s) -> changed, file unchanged", async (_name, onDisk, base) => {
    if (onDisk !== null) fs.writeFileSync(configPath(), JSON.stringify(onDisk));
    const before = onDisk === null ? null : fs.readFileSync(configPath(), "utf8");
    const mine: SetListsWrapper = { version: 2, setLists: [{ id: 9, name: "Meine", sheets: [] }] };
    expect(await saveSetLists({ basePath: dir, setListsWrapper: mine, base })).toEqual({ ok: false, reason: "changed" });
    expect(fs.existsSync(configPath()) ? fs.readFileSync(configPath(), "utf8") : null).toBe(before);
    expect(fs.readdirSync(dir)).toEqual(onDisk === null ? [] : [CONFIG_FILE]);
  });

  test("the base is compared by content, not by key order", async () => {
    fs.writeFileSync(
      configPath(),
      `{"setLists":{"setLists":[{"sheets":[],"name":"Ostern","id":2}],"version":2},"version":1}`,
    );
    expect(await saveSetLists({ basePath: dir, setListsWrapper: setLists, base: other })).toEqual({ ok: true });
    expect(readConfig()).toEqual({ version: 1, setLists });
  });

  test("a missing sheet folder -> failed, nothing created", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const gone = path.join(dir, "weg");
    const result = await saveSetLists({ basePath: gone, setListsWrapper: setLists, base: null });
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(!result.ok && result.reason === "failed" && result.message).toContain("Der Notenordner ist nicht erreichbar.");
    expect(fs.existsSync(gone)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  test("an unreadable file -> not ok, bytes unchanged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fs.writeFileSync(configPath(), "{");
    const result = await saveSetLists({ basePath: dir, setListsWrapper: setLists, base: null });
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(!result.ok && result.reason === "failed" && result.message.length).toBeGreaterThan(0);
    expect(fs.readFileSync(configPath(), "utf8")).toBe("{");
    expect(fs.readdirSync(dir)).toEqual([CONFIG_FILE]);
    expect(warn).toHaveBeenCalled();
  });

  test.skipIf(isRoot)("a read-only folder -> not ok, nothing written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fs.chmodSync(dir, 0o555);
    const result = await saveSetLists({ basePath: dir, setListsWrapper: setLists, base: null });
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(!result.ok && result.reason === "failed" && result.message.length).toBeGreaterThan(0);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe("unknown fields of a newer version", () => {
  test("survive load -> save -> load at wrapper, list and sheet level", async () => {
    const sheet = { path: ["Weihnachten"], name: "a.pdf", isFile: true, isSearch: false, page: 3 };
    const stored = { version: 2, color: "rot", setLists: [{ id: 1, name: "Advent", pinned: true, sheets: [sheet] }] };
    fs.writeFileSync(configPath(), JSON.stringify({ version: 1, setLists: stored }));

    const loaded = await loadSetLists(dir);
    expect(loaded).toEqual({ kind: "ok", setLists: stored });
    const base = loaded.kind === "ok" ? loaded.setLists : null;
    // The renderer adds a sheet; the input goes through the tRPC schema like in the app.
    const edited = structuredClone(base!);
    edited.setLists[0].sheets.push({ path: [], name: "b.pdf", isFile: true, isSearch: false });
    const input = saveSetListsInputSchema.parse({ basePath: dir, setListsWrapper: edited, base });
    expect(await saveSetLists(input)).toEqual({ ok: true });

    const expected = {
      ...stored,
      setLists: [{ ...stored.setLists[0], sheets: [sheet, { path: [], name: "b.pdf", isFile: true, isSearch: false }] }],
    };
    expect(readConfig().setLists).toEqual(expected);
    expect(await loadSetLists(dir)).toEqual({ kind: "ok", setLists: expected });
  });

  test("a file of a newer app -> unreadable with newerVersion", async () => {
    fs.writeFileSync(configPath(), JSON.stringify({ version: 1, setLists: { version: 3, setLists: [] } }));
    expect(await loadSetLists(dir)).toMatchObject({ kind: "unreadable", file: CONFIG_FILE, newerVersion: true });
  });
});

describe("notice texts", () => {
  test("set lists of a newer app", () => {
    expect(setListsNewerVersionText).toBe(
      "Die Setlisten stammen von einer neueren Version der App. Bitte die App aktualisieren; Änderungen an Setlisten werden nicht gespeichert.",
    );
  });

  test("set lists changed on another PC", () => {
    expect(setListsChangedText).toBe(
      "Die Setlisten wurden inzwischen an einem anderen PC geändert und neu geladen. Bitte die letzte Änderung wiederholen.",
    );
  });

  test("unreadable set lists", () => {
    expect(setListsUnreadableText(".config.json", "Unexpected end of JSON input")).toBe(
      "Die Setlisten konnten nicht geladen werden („.config.json“: Unexpected end of JSON input). Änderungen an Setlisten werden nicht gespeichert.",
    );
  });

  test("a failed save, without a second period", () => {
    expect(setListsSaveFailedText("EACCES: permission denied")).toBe(
      "Die Setlisten konnten nicht gespeichert werden: EACCES: permission denied.",
    );
    expect(setListsSaveFailedText("Der Ordner ist schreibgeschützt.")).toBe(
      "Die Setlisten konnten nicht gespeichert werden: Der Ordner ist schreibgeschützt.",
    );
  });
});
