import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CONFIG_FILE } from "../src/folderConfig";
import type { SetListsWrapper } from "../src/models/types";
import { setLockRetryDelays } from "../src/pdfMarkup/lockRetry";
import { setListsSaveFailedText, setListsUnreadableText } from "../src/store/setListTexts";
import { loadSetLists, saveSetLists } from "../src/trcpLib";

// trcpLib.ts imports Electron at the top; the set list functions do not use it.
vi.mock("electron", () => ({ app: { isPackaged: false }, autoUpdater: {}, dialog: {} }));

/** chmod-based tests do not work as root (root ignores permission bits). */
const isRoot = process.getuid?.() === 0;

const setLists: SetListsWrapper = {
  version: 2,
  setLists: [{ id: 1, name: "Advent", sheets: [{ path: ["Weihnachten"], name: "a.pdf", isFile: true, isSearch: false }] }],
};
const mark = { at: "2026-11-22T10:15:00.000Z" };
const empty: SetListsWrapper = { version: 2, setLists: [] };

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
  test("no file -> ok with no set lists, nothing written", async () => {
    expect(await loadSetLists(dir)).toEqual({ kind: "ok", setLists: empty });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("a file without set lists -> ok with no set lists", async () => {
    fs.writeFileSync(configPath(), JSON.stringify({ version: 1, markupMigrated: mark }));
    expect(await loadSetLists(dir)).toEqual({ kind: "ok", setLists: empty });
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
    expect(await saveSetLists({ basePath: dir, setListsWrapper: setLists })).toEqual({ ok: true });
    expect(readConfig()).toEqual({ version: 1, setLists, markupMigrated: mark });
  });

  test("an unreadable file -> not ok, bytes unchanged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fs.writeFileSync(configPath(), "{");
    const result = await saveSetLists({ basePath: dir, setListsWrapper: setLists });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message.length).toBeGreaterThan(0);
    expect(fs.readFileSync(configPath(), "utf8")).toBe("{");
    expect(fs.readdirSync(dir)).toEqual([CONFIG_FILE]);
    expect(warn).toHaveBeenCalled();
  });

  test.skipIf(isRoot)("a read-only folder -> not ok, nothing written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fs.chmodSync(dir, 0o555);
    const result = await saveSetLists({ basePath: dir, setListsWrapper: setLists });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message.length).toBeGreaterThan(0);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe("notice texts", () => {
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
