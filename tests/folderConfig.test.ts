import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CONFIG_FILE,
  FolderConfigUnreadableError,
  LEGACY_SET_LISTS_FILE,
  loadFolderConfig,
  migrateSetListsToV2,
  updateFolderConfig,
} from "../src/folderConfig";
import { setLockRetryDelays } from "../src/pdfMarkup/lockRetry";
import type { SetListsWrapper } from "../src/models/types";

/** chmod-based tests do not work as root (root ignores permission bits). */
const isRoot = process.getuid?.() === 0;

const setListsA: SetListsWrapper = {
  version: 2,
  setLists: [
    {
      id: 1,
      name: "Advent",
      sheets: [{ path: ["Weihnachten", "Stille Nacht.pdf"], name: "Stille Nacht.pdf", isFile: true, isSearch: false }],
    },
  ],
};
const setListsB: SetListsWrapper = { version: 2, setLists: [{ id: 2, name: "Ostern", sheets: [] }] };
const mark = { at: "2026-11-22T10:15:00.000Z" };

let dir: string;
let previousDelays: readonly number[];
const configPath = () => path.join(dir, CONFIG_FILE);
const legacyPath = () => path.join(dir, LEGACY_SET_LISTS_FILE);
const writeConfig = (value: unknown) =>
  fs.writeFileSync(configPath(), typeof value === "string" ? value : JSON.stringify(value));
const readConfig = () => JSON.parse(fs.readFileSync(configPath(), "utf8"));
const tempFiles = () => fs.readdirSync(dir).filter((f) => f.includes("smv-tmp"));
const errorWithCode = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-folder-config-"));
  previousDelays = setLockRetryDelays([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  setLockRetryDelays(previousDelays);
  for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o644);
  fs.chmodSync(dir, 0o755);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadFolderConfig", () => {
  test("no file -> missing, nothing written", async () => {
    expect(await loadFolderConfig(dir)).toEqual({ kind: "missing" });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("a valid file -> ok with its content", async () => {
    writeConfig({ version: 1, setLists: setListsA, markupMigrated: mark, other: { x: 1 } });
    expect(await loadFolderConfig(dir)).toEqual({
      kind: "ok",
      config: { version: 1, setLists: setListsA, markupMigrated: mark, other: { x: 1 } },
    });
  });

  test.each([
    ["broken JSON", "{"],
    ["wrong schema", '{"version":1,"setLists":7}'],
    ["unknown version", '{"version":2}'],
  ])("%s -> unreadable", async (_name, text) => {
    writeConfig(text);
    const read = await loadFolderConfig(dir);
    expect(read).toMatchObject({ kind: "unreadable", file: CONFIG_FILE });
    expect(read.kind === "unreadable" && read.message.length).toBeGreaterThan(0);
    expect(fs.readFileSync(configPath(), "utf8")).toBe(text);
  });

  test.each([
    ["version 2", { version: 2 }],
    ["set lists version 3", { version: 1, setLists: { version: 3, setLists: "anders" } }],
    ["both", { version: 7, setLists: { version: 9 } }],
  ])("a file of a newer app (%s) -> unreadable with newerVersion, never overwritten", async (_name, content) => {
    const text = JSON.stringify(content);
    writeConfig(text);
    const read = await loadFolderConfig(dir);
    expect(read).toMatchObject({ kind: "unreadable", file: CONFIG_FILE, newerVersion: true });
    const error = await updateFolderConfig(dir, { markupMigrated: mark }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FolderConfigUnreadableError);
    expect(fs.readFileSync(configPath(), "utf8")).toBe(text);
  });

  test.each([
    ["version as text", { version: "2" }],
    ["version 0", { version: 0 }],
    ["set lists version 1", { version: 1, setLists: { version: 1, setLists: [] } }],
    ["broken set lists, known versions", { version: 1, setLists: { version: 2, setLists: 7 } }],
  ])("an invalid file that is not newer (%s) -> unreadable without newerVersion", async (_name, content) => {
    writeConfig(content);
    const read = await loadFolderConfig(dir);
    expect(read).toMatchObject({ kind: "unreadable", file: CONFIG_FILE });
    expect(read).not.toHaveProperty("newerVersion");
  });

  test.skipIf(isRoot)("a file that cannot be read -> unreadable with the error", async () => {
    writeConfig({ version: 1 });
    fs.chmodSync(configPath(), 0o000);
    expect(await loadFolderConfig(dir)).toEqual({
      kind: "unreadable",
      file: CONFIG_FILE,
      message: expect.stringContaining("EACCES"),
    });
  });

  test.each([
    ["config", CONFIG_FILE, { version: 1, setLists: setListsA }],
    ["legacy", LEGACY_SET_LISTS_FILE, setListsA],
  ])("a locked %s file is read again", async (_name, file, content) => {
    setLockRetryDelays([1, 1]);
    fs.writeFileSync(path.join(dir, file), JSON.stringify(content));
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let failed = false;
    const readFile = vi.spyOn(fs.promises, "readFile").mockImplementation(((target: fs.PathLike, ...rest: unknown[]) => {
      if (!failed && String(target) === path.join(dir, file)) {
        failed = true;
        return Promise.reject(errorWithCode("EBUSY"));
      }
      return (realReadFile as (...a: unknown[]) => Promise<unknown>)(target, ...rest);
    }) as typeof fs.promises.readFile);

    expect(await loadFolderConfig(dir)).toEqual({ kind: "ok", config: { version: 1, setLists: setListsA } });
    expect(failed).toBe(true);
    expect(readFile.mock.calls.filter(([target]) => String(target) === path.join(dir, file)).length).toBeGreaterThan(1);
  });

  test.each([
    ["does not exist", () => path.join(dir, "weg")],
    [
      "is a file",
      () => {
        fs.writeFileSync(path.join(dir, "datei"), "x");
        return path.join(dir, "datei");
      },
    ],
  ])("a sheet folder that %s -> unreadable, nothing created", async (_name, makeFolder) => {
    const folder = makeFolder();
    const before = fs.readdirSync(dir);
    const unreachable = { kind: "unreadable", file: CONFIG_FILE, message: "Der Notenordner ist nicht erreichbar." };
    expect(await loadFolderConfig(folder)).toEqual(unreachable);
    const error = await updateFolderConfig(folder, { markupMigrated: mark }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FolderConfigUnreadableError);
    expect(error).toMatchObject({ file: CONFIG_FILE, message: unreachable.message });
    expect(fs.readdirSync(dir)).toEqual(before);
  });

  test("a file with a byte order mark loads and is not rewritten by the load", async () => {
    const text = `\uFEFF${JSON.stringify({ version: 1, setLists: setListsA, markupMigrated: mark })}`;
    writeConfig(text);
    const before = fs.statSync(configPath());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await loadFolderConfig(dir)).toEqual({
      kind: "ok",
      config: { version: 1, setLists: setListsA, markupMigrated: mark },
    });
    expect(fs.readFileSync(configPath(), "utf8")).toBe(text);
    expect(fs.statSync(configPath()).mtimeMs).toBe(before.mtimeMs);
    expect(fs.readdirSync(dir)).toEqual([CONFIG_FILE]);
  });

  test("a missing file is not retried", async () => {
    setLockRetryDelays([1, 1]);
    const readFile = vi.spyOn(fs.promises, "readFile");
    expect(await loadFolderConfig(dir)).toEqual({ kind: "missing" });
    expect(readFile.mock.calls.map(([target]) => String(target))).toEqual([configPath(), legacyPath()]);
  });
});

describe("updateFolderConfig", () => {
  test("updating set lists keeps the mark and unknown fields", async () => {
    writeConfig({ version: 1, setLists: setListsA, markupMigrated: { ...mark, by: "PC-2" }, future: [1, 2] });
    await updateFolderConfig(dir, { setLists: setListsB });
    expect(readConfig()).toEqual({
      version: 1,
      setLists: setListsB,
      markupMigrated: { ...mark, by: "PC-2" },
      future: [1, 2],
    });

    // A re-mark merges into the existing mark: fields a newer version wrote into it stay.
    await updateFolderConfig(dir, { markupMigrated: { at: "2026-11-23T08:00:00.000Z" } });
    expect(readConfig()).toEqual({
      version: 1,
      setLists: setListsB,
      markupMigrated: { at: "2026-11-23T08:00:00.000Z", by: "PC-2" },
      future: [1, 2],
    });
  });

  test("unknown fields inside the set lists are kept by a load and an update", async () => {
    const withUnknown = {
      version: 2,
      color: "rot",
      setLists: [{ id: 1, name: "Advent", pinned: true, sheets: [{ ...setListsA.setLists[0].sheets[0], page: 3 }] }],
    };
    writeConfig({ version: 1, setLists: withUnknown });
    expect(await loadFolderConfig(dir)).toEqual({ kind: "ok", config: { version: 1, setLists: withUnknown } });
    await updateFolderConfig(dir, { markupMigrated: mark });
    expect(readConfig()).toEqual({ version: 1, setLists: withUnknown, markupMigrated: mark });
  });

  test("updating set lists keeps a mark written by someone else", async () => {
    writeConfig({ version: 1, setLists: setListsA });
    expect(await loadFolderConfig(dir)).toMatchObject({ kind: "ok", config: { setLists: setListsA } });
    // Another PC marks the folder in the meantime (the file arrives through the sync client).
    writeConfig({ version: 1, setLists: setListsA, markupMigrated: mark });

    await updateFolderConfig(dir, { setLists: setListsB });
    expect(readConfig()).toEqual({ version: 1, setLists: setListsB, markupMigrated: mark });
  });

  test("unchanged content is not written", async () => {
    // Other key order and formatting than this module would write: still the same content.
    writeConfig(`{"markupMigrated":{"at":"${mark.at}"},"setLists":${JSON.stringify(setListsA)},"version":1}`);
    const before = fs.statSync(configPath());
    await new Promise((resolve) => setTimeout(resolve, 20));

    await updateFolderConfig(dir, { setLists: structuredClone(setListsA) });
    await updateFolderConfig(dir, { markupMigrated: { ...mark } });
    await updateFolderConfig(dir, {});

    const after = fs.statSync(configPath());
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
  });

  test("an unreadable file is never overwritten", async () => {
    writeConfig("{");
    const error = await updateFolderConfig(dir, { setLists: setListsB }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FolderConfigUnreadableError);
    expect(error).toMatchObject({ file: CONFIG_FILE });
    expect(fs.readFileSync(configPath(), "utf8")).toBe("{");
    expect(fs.readdirSync(dir)).toEqual([CONFIG_FILE]);
  });

  test("an unknown version is unreadable and never overwritten", async () => {
    const text = JSON.stringify({ version: 2, setLists: setListsA, markupMigrated: mark });
    writeConfig(text);
    expect(await loadFolderConfig(dir)).toMatchObject({ kind: "unreadable", file: CONFIG_FILE });
    await expect(updateFolderConfig(dir, { markupMigrated: mark })).rejects.toBeInstanceOf(FolderConfigUnreadableError);
    expect(fs.readFileSync(configPath(), "utf8")).toBe(text);
    expect(fs.readdirSync(dir)).toEqual([CONFIG_FILE]);
  });

  test("no temp file is left after a write", async () => {
    await updateFolderConfig(dir, { setLists: setListsA });
    expect(readConfig()).toEqual({ version: 1, setLists: setListsA });
    expect(tempFiles()).toEqual([]);

    // A write that fails at the rename leaves the old file and no temp file.
    const before = fs.readFileSync(configPath());
    vi.spyOn(fs.promises, "rename").mockRejectedValue(errorWithCode("EIO"));
    await expect(updateFolderConfig(dir, { setLists: setListsB })).rejects.toThrow("EIO");
    expect(fs.readFileSync(configPath()).equals(before)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([CONFIG_FILE]);
  });

  test("a locked file is retried", async () => {
    setLockRetryDelays([1, 1]);
    await updateFolderConfig(dir, { setLists: setListsA });
    const rename = vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(errorWithCode("EBUSY"));
    await updateFolderConfig(dir, { setLists: setListsB });
    expect(rename).toHaveBeenCalledTimes(2);
    expect(readConfig()).toEqual({ version: 1, setLists: setListsB });
    expect(tempFiles()).toEqual([]);
  });

  test.each([
    ["the temp file", () => path.join(dir, `.${CONFIG_FILE}.smv-tmp`)],
    ["the written file", () => configPath()],
  ])("a read-back of %s that is locked once is retried", async (_name, lockedFile) => {
    setLockRetryDelays([1, 1]);
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let failed = false;
    vi.spyOn(fs.promises, "readFile").mockImplementation(((target: fs.PathLike, ...rest: unknown[]) => {
      // Only a read of a file that exists is a read-back (the first read of the missing config is not).
      if (!failed && String(target) === lockedFile() && fs.existsSync(lockedFile())) {
        failed = true;
        return Promise.reject(errorWithCode("EBUSY"));
      }
      return (realReadFile as (...a: unknown[]) => Promise<unknown>)(target, ...rest);
    }) as typeof fs.promises.readFile);

    await updateFolderConfig(dir, { setLists: setListsA });
    expect(failed).toBe(true);
    expect(readConfig()).toEqual({ version: 1, setLists: setListsA });
    expect(tempFiles()).toEqual([]);
  });

  test("calls for one folder run one after another", async () => {
    await Promise.all([
      updateFolderConfig(dir, { setLists: setListsA }),
      updateFolderConfig(dir, { markupMigrated: mark }),
      updateFolderConfig(dir, { setLists: setListsB }),
    ]);
    expect(readConfig()).toEqual({ version: 1, setLists: setListsB, markupMigrated: mark });
  });
});

describe("takeover of .set-lists.json", () => {
  const v1Text = JSON.stringify([
    {
      id: 1,
      name: "Advent",
      sheets: [{ path: "/Weihnachten/Stille Nacht.pdf", name: "Stille Nacht.pdf", isFile: true, isSearch: false }],
    },
  ]);

  test("a legacy v2 file is taken over and deleted after the read-back", async () => {
    fs.writeFileSync(legacyPath(), JSON.stringify(setListsA, null, 2));
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    const order: string[] = [];
    vi.spyOn(fs.promises, "readFile").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      if (String(file) === configPath() && fs.existsSync(configPath())) order.push("read-back");
      return (realReadFile as (...a: unknown[]) => Promise<unknown>)(file, ...rest);
    }) as typeof fs.promises.readFile);
    const realRm = fs.promises.rm.bind(fs.promises);
    vi.spyOn(fs.promises, "rm").mockImplementation((file, ...rest) => {
      if (String(file) === legacyPath()) order.push("delete legacy");
      return realRm(file, ...rest);
    });

    expect(await loadFolderConfig(dir)).toEqual({ kind: "ok", config: { version: 1, setLists: setListsA } });
    expect(readConfig()).toEqual({ version: 1, setLists: setListsA });
    expect(fs.readdirSync(dir)).toEqual([CONFIG_FILE]);
    expect(order).toEqual(["read-back", "delete legacy"]);
  });

  test("a takeover whose read-back is locked once still deletes the legacy file", async () => {
    setLockRetryDelays([1, 1]);
    fs.writeFileSync(legacyPath(), JSON.stringify(setListsA));
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let failed = false;
    vi.spyOn(fs.promises, "readFile").mockImplementation(((target: fs.PathLike, ...rest: unknown[]) => {
      if (!failed && String(target) === configPath() && fs.existsSync(configPath())) {
        failed = true;
        return Promise.reject(errorWithCode("EBUSY"));
      }
      return (realReadFile as (...a: unknown[]) => Promise<unknown>)(target, ...rest);
    }) as typeof fs.promises.readFile);

    expect(await loadFolderConfig(dir)).toEqual({ kind: "ok", config: { version: 1, setLists: setListsA } });
    expect(failed).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([CONFIG_FILE]);
  });

  test("a legacy file with a byte order mark is taken over", async () => {
    fs.writeFileSync(legacyPath(), `\uFEFF${v1Text}`);
    expect(await loadFolderConfig(dir)).toEqual({ kind: "ok", config: { version: 1, setLists: setListsA } });
    expect(readConfig()).toEqual({ version: 1, setLists: setListsA });
    expect(fs.readdirSync(dir)).toEqual([CONFIG_FILE]);
  });

  test("a legacy v1 file is converted to v2 on takeover", async () => {
    fs.writeFileSync(legacyPath(), v1Text);
    expect(await loadFolderConfig(dir)).toEqual({ kind: "ok", config: { version: 1, setLists: setListsA } });
    expect(readConfig()).toEqual({ version: 1, setLists: setListsA });
    expect(fs.existsSync(legacyPath())).toBe(false);
  });

  test("a broken legacy file stays and the folder is unreadable", async () => {
    for (const text of ["[", '{"version":2,"setLists":"x"}', '[{"id":1}]']) {
      fs.writeFileSync(legacyPath(), text);
      const read = await loadFolderConfig(dir);
      expect(read, text).toMatchObject({ kind: "unreadable", file: LEGACY_SET_LISTS_FILE });
      expect(read.kind === "unreadable" && read.message.length, text).toBeGreaterThan(0);
      expect(fs.readFileSync(legacyPath(), "utf8"), text).toBe(text);
      expect(fs.readdirSync(dir), text).toEqual([LEGACY_SET_LISTS_FILE]);
    }
  });

  test("with both files the config wins and the legacy file is left alone", async () => {
    writeConfig({ version: 1, setLists: setListsB });
    fs.writeFileSync(legacyPath(), JSON.stringify(setListsA));
    expect(await loadFolderConfig(dir)).toEqual({ kind: "ok", config: { version: 1, setLists: setListsB } });
    await updateFolderConfig(dir, { markupMigrated: mark });
    expect(readConfig()).toEqual({ version: 1, setLists: setListsB, markupMigrated: mark });
    expect(fs.readFileSync(legacyPath(), "utf8")).toBe(JSON.stringify(setListsA));
  });

  test("a legacy file that cannot be deleted stays, the config wins", async () => {
    fs.writeFileSync(legacyPath(), JSON.stringify(setListsA));
    const realRm = fs.promises.rm.bind(fs.promises);
    vi.spyOn(fs.promises, "rm").mockImplementation((file, ...rest) =>
      String(file) === legacyPath() ? Promise.reject(errorWithCode("EPERM")) : realRm(file, ...rest),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await loadFolderConfig(dir)).toEqual({ kind: "ok", config: { version: 1, setLists: setListsA } });
    expect(fs.readdirSync(dir).sort()).toEqual([LEGACY_SET_LISTS_FILE, CONFIG_FILE].sort());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(LEGACY_SET_LISTS_FILE), expect.anything());

    // The next load reads the config and leaves the legacy file alone.
    await updateFolderConfig(dir, { setLists: setListsB });
    expect(await loadFolderConfig(dir)).toEqual({ kind: "ok", config: { version: 1, setLists: setListsB } });
    expect(fs.existsSync(legacyPath())).toBe(true);
  });

  test("a takeover that cannot be written keeps the legacy file and still loads", async () => {
    fs.writeFileSync(legacyPath(), JSON.stringify(setListsA));
    vi.spyOn(fs.promises, "rename").mockRejectedValue(errorWithCode("EIO"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await loadFolderConfig(dir)).toEqual({ kind: "ok", config: { version: 1, setLists: setListsA } });
    expect(fs.readdirSync(dir)).toEqual([LEGACY_SET_LISTS_FILE]);
    expect(warn).toHaveBeenCalled();
  });

  test("updating a folder that only has .set-lists.json takes it over first", async () => {
    fs.writeFileSync(legacyPath(), v1Text);
    await updateFolderConfig(dir, { markupMigrated: mark });
    expect(readConfig()).toEqual({ version: 1, setLists: setListsA, markupMigrated: mark });
    expect(fs.readdirSync(dir)).toEqual([CONFIG_FILE]);
  });

  test("updating a folder with a broken .set-lists.json throws and writes nothing", async () => {
    fs.writeFileSync(legacyPath(), "[");
    const error = await updateFolderConfig(dir, { markupMigrated: mark }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FolderConfigUnreadableError);
    expect(error).toMatchObject({ file: LEGACY_SET_LISTS_FILE });
    expect(fs.readdirSync(dir)).toEqual([LEGACY_SET_LISTS_FILE]);
    expect(fs.readFileSync(legacyPath(), "utf8")).toBe("[");
  });
});

describe("migrateSetListsToV2", () => {
  test("converts a v1 array and keeps v2 text as it is", () => {
    const sheet = { name: "b.pdf", isFile: true, isSearch: false };
    const v1 = JSON.stringify([{ id: 1, name: "A", sheets: [{ ...sheet, path: "/a/b.pdf" }] }]);
    expect(JSON.parse(migrateSetListsToV2(v1))).toEqual({
      version: 2,
      setLists: [{ id: 1, name: "A", sheets: [{ ...sheet, path: ["a", "b.pdf"] }] }],
    });
    const v2 = JSON.stringify(setListsB);
    expect(migrateSetListsToV2(v2)).toBe(v2);
  });
});
