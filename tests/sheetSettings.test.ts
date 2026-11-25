import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CONFIG_FILE } from "../src/folderConfig";
import { clearFingerprintCache, fingerprintFile, fingerprintOf } from "../src/pdfFingerprint";
import { setLockRetryDelays } from "../src/pdfMarkup/lockRetry";
import {
  diskSpelling,
  findMoveSource,
  loadFavoriteKeys,
  loadFavorites,
  loadSheetSettings,
  relinkMissingFavorites,
  resetRelinkMemory,
  saveSheetSetting,
} from "../src/sheetSettings";
import { makePdf } from "./pdfMarkup/fixtures";

// fingerprintFile is wrapped so tests can count and fail its calls; by default it runs the real one.
vi.mock("../src/pdfFingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/pdfFingerprint")>();
  return { ...actual, fingerprintFile: vi.fn(actual.fingerprintFile) };
});
const fingerprintMock = vi.mocked(fingerprintFile);

/** Whether the temp dir's file system ignores case (Windows, macOS): a file is found under another spelling. */
const caseInsensitiveFs = (() => {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-case-"));
  try {
    fs.writeFileSync(path.join(probeDir, "probe"), "");
    fs.statSync(path.join(probeDir, "PROBE"));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
})();

let dir: string;
let previousDelays: readonly number[];
const full = (key: string) => path.join(dir, ...key.split("/"));
const configPath = () => path.join(dir, CONFIG_FILE);
const writeConfig = (sheets: Record<string, unknown>) =>
  fs.writeFileSync(configPath(), JSON.stringify({ version: 1, sheets }, null, 2));
const readSheets = () => JSON.parse(fs.readFileSync(configPath(), "utf8")).sheets;
const writePdf = (key: string, bytes: Uint8Array) => {
  fs.mkdirSync(path.dirname(full(key)), { recursive: true });
  fs.writeFileSync(full(key), bytes);
  return full(key);
};
const movePdf = (from: string, to: string) => {
  fs.mkdirSync(path.dirname(full(to)), { recursive: true });
  fs.renameSync(full(from), full(to));
};
/** Sets the config's mtime into the past, so any later write shows. */
const ageConfig = () => {
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(configPath(), past, past);
  return fs.statSync(configPath()).mtimeMs;
};
const errorWithCode = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code });
/** Lets `stat` of `file` fail with `code`; every other path is stat'ed for real. */
const failStat = (file: string, code: string) => {
  const original = fs.promises.stat;
  vi.spyOn(fs.promises, "stat").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) =>
    p === file
      ? Promise.reject(errorWithCode(code))
      : (original as (...args: unknown[]) => Promise<fs.Stats>)(p, ...rest)) as typeof fs.promises.stat);
};

/** chmod-based tests do not work as root (root ignores permission bits). */
const isRoot = process.getuid?.() === 0;
/** A folder outside the sheet folder (another drive), removed after the test. */
const outsideDirs: string[] = [];
const makeOutside = () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "smv-sheet-settings-drive-"));
  outsideDirs.push(outside);
  return outside;
};
/** A link at `key` to the folder `target`. */
const linkFolder = (key: string, target: string) => {
  fs.mkdirSync(path.dirname(full(key)), { recursive: true });
  fs.symlinkSync(target, full(key), "dir");
};

let pdfA: Uint8Array;
let pdfB: Uint8Array;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-sheet-settings-"));
  previousDelays = setLockRetryDelays([]);
  clearFingerprintCache();
  resetRelinkMemory();
  const actual = await vi.importActual<typeof import("../src/pdfFingerprint")>("../src/pdfFingerprint");
  fingerprintMock.mockReset();
  fingerprintMock.mockImplementation(actual.fingerprintFile);
  pdfA ??= await makePdf({ pages: 1, xref: "table" });
  pdfB ??= await makePdf({ pages: 2, xref: "table" });
});
afterEach(() => {
  vi.restoreAllMocks();
  setLockRetryDelays(previousDelays);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const outside of outsideDirs.splice(0)) fs.rmSync(outside, { recursive: true, force: true });
});

describe("loadSheetSettings: an entry follows a moved PDF on open", () => {
  test("a moved PDF takes its entry on open", async () => {
    writePdf("A/a.pdf", pdfA);
    const entry = { favorite: true, pageDividers: { "2": 0.4 }, fingerprint: fingerprintOf(pdfA) };
    writeConfig({ "A/a.pdf": entry });
    movePdf("A/a.pdf", "B/a.pdf");

    expect(await loadSheetSettings({ folder: dir, pdfPath: full("B/a.pdf") })).toEqual({
      kind: "ok",
      dividers: { 2: 0.4 },
      favorite: true,
    });
    expect(readSheets()).toEqual({ "B/a.pdf": entry });
  });

  test("open without an orphan reads no PDF and writes nothing", async () => {
    writePdf("A/a.pdf", pdfA);
    writePdf("B/b.pdf", pdfB);
    writeConfig({
      "A/a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) },
      // Missing, but without a fingerprint: not an orphan.
      "C/c.pdf": { pageDividers: { "1": 0.3 } },
    });
    const mtime = ageConfig();
    const before = fs.readFileSync(configPath(), "utf8");

    expect(await loadSheetSettings({ folder: dir, pdfPath: full("B/b.pdf") })).toEqual({
      kind: "ok",
      dividers: {},
      favorite: false,
    });
    expect(await loadSheetSettings({ folder: dir, pdfPath: full("A/a.pdf") })).toEqual({
      kind: "ok",
      dividers: {},
      favorite: true,
    });
    expect(fingerprintMock).not.toHaveBeenCalled();
    expect(fs.statSync(configPath()).mtimeMs).toBe(mtime);
    expect(fs.readFileSync(configPath(), "utf8")).toBe(before);
  });

  test("a copy gets nothing", async () => {
    writePdf("A/a.pdf", pdfA);
    writePdf("B/a.pdf", pdfA);
    writeConfig({ "A/a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) } });
    const before = fs.readFileSync(configPath(), "utf8");

    expect(await loadSheetSettings({ folder: dir, pdfPath: full("B/a.pdf") })).toEqual({
      kind: "ok",
      dividers: {},
      favorite: false,
    });
    expect(fs.readFileSync(configPath(), "utf8")).toBe(before);
  });

  test("two orphans with the same fingerprint: nothing", async () => {
    writePdf("B/a.pdf", pdfA);
    writeConfig({
      "A/a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) },
      "C/a.pdf": { pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfA) },
    });
    const before = fs.readFileSync(configPath(), "utf8");

    expect(await loadSheetSettings({ folder: dir, pdfPath: full("B/a.pdf") })).toEqual({
      kind: "ok",
      dividers: {},
      favorite: false,
    });
    expect(fs.readFileSync(configPath(), "utf8")).toBe(before);
  });

  test("the target's own entry wins", async () => {
    writePdf("B/a.pdf", pdfA);
    writeConfig({
      "A/a.pdf": { favorite: true, pageDividers: { "2": 0.4 }, fingerprint: fingerprintOf(pdfA) },
      "B/a.pdf": { pageDividers: { "1": 0.3 } },
    });
    const before = fs.readFileSync(configPath(), "utf8");

    expect(await loadSheetSettings({ folder: dir, pdfPath: full("B/a.pdf") })).toEqual({
      kind: "ok",
      dividers: { 1: 0.3 },
      favorite: false,
    });
    expect(fs.readFileSync(configPath(), "utf8")).toBe(before);
  });

  test("stat errors other than ENOENT and an unreachable folder move nothing", async () => {
    writePdf("A/a.pdf", pdfA);
    const sheets = { "A/a.pdf": { favorite: true, fingerprint: { ...fingerprintOf(pdfA) } } };
    writeConfig(sheets);
    movePdf("A/a.pdf", "B/a.pdf");
    const before = fs.readFileSync(configPath(), "utf8");
    failStat(full("A/a.pdf"), "EACCES");

    expect(await loadSheetSettings({ folder: dir, pdfPath: full("B/a.pdf") })).toEqual({
      kind: "ok",
      dividers: {},
      favorite: false,
    });
    expect(fs.readFileSync(configPath(), "utf8")).toBe(before);
    expect(fingerprintMock).not.toHaveBeenCalled();

    // A sheet folder on a drive that is not there: every path is "missing", yet nothing may move.
    const targetFingerprint = vi.fn(async () => fingerprintOf(pdfA));
    expect(await findMoveSource(path.join(dir, "no-drive"), sheets, "B/a.pdf", targetFingerprint)).toBeNull();
    expect(targetFingerprint).not.toHaveBeenCalled();
  });

  test.skipIf(!caseInsensitiveFs)("a case-only rename moves the entry", async () => {
    writePdf("A/abba gold.pdf", pdfA);
    // No fingerprint: a case-only rename moves without comparing.
    writeConfig({ "A/abba gold.pdf": { favorite: true } });
    fs.renameSync(full("A/abba gold.pdf"), full("A/Abba Gold.pdf"));

    expect(await loadSheetSettings({ folder: dir, pdfPath: full("A/Abba Gold.pdf") })).toEqual({
      kind: "ok",
      dividers: {},
      favorite: true,
    });
    expect(readSheets()).toEqual({ "A/Abba Gold.pdf": { favorite: true } });
  });

  test("a case-only rename: the old spelling no longer listed moves the entry (simulated)", async () => {
    // A hard link makes both spellings stat'able as one file, like a case-insensitive file system; the
    // listing is told to show only the new spelling.
    writePdf("A/Abba Gold.pdf", pdfA);
    fs.linkSync(full("A/Abba Gold.pdf"), full("A/abba gold.pdf"));
    writeConfig({ "A/abba gold.pdf": { favorite: true } });
    const readdir = fs.promises.readdir;
    vi.spyOn(fs.promises, "readdir").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      const names = (await (readdir as (...args: unknown[]) => Promise<string[]>)(p, ...rest)) as string[];
      return p === full("A") ? names.filter((n) => n !== "abba gold.pdf") : names;
    }) as typeof fs.promises.readdir);

    expect(await findMoveSource(dir, { "A/abba gold.pdf": { favorite: true } }, "A/Abba Gold.pdf", async () => null)).toBe(
      "A/abba gold.pdf",
    );
  });

  test("a second name of the same file (a link) moves nothing", async () => {
    writePdf("A/abba gold.pdf", pdfA);
    fs.symlinkSync(full("A/abba gold.pdf"), full("A/Abba Gold.pdf"));
    writeConfig({ "A/abba gold.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) } });
    const before = fs.readFileSync(configPath(), "utf8");

    expect(await loadSheetSettings({ folder: dir, pdfPath: full("A/Abba Gold.pdf") })).toEqual({
      kind: "ok",
      dividers: {},
      favorite: false,
    });
    expect(fs.readFileSync(configPath(), "utf8")).toBe(before);
  });

  test("an entry behind a folder link whose drive is offline moves nowhere, not even to an identical copy", async () => {
    const drive = makeOutside();
    linkFolder("Pop/Linked", drive);
    fs.writeFileSync(path.join(drive, "a.pdf"), pdfA);
    const entry = { favorite: true, pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfA) };
    writeConfig({ "Pop/Linked/a.pdf": entry });
    writePdf("Local/a.pdf", pdfA);
    fs.rmSync(drive, { recursive: true, force: true }); // the drive sleeps: the link dangles
    const before = fs.readFileSync(configPath(), "utf8");

    expect(await loadSheetSettings({ folder: dir, pdfPath: full("Local/a.pdf") })).toEqual({
      kind: "ok",
      dividers: {},
      favorite: false,
    });
    expect(fingerprintMock).not.toHaveBeenCalled();
    expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 0 });
    expect(fs.readFileSync(configPath(), "utf8")).toBe(before);
    // Unclear whether it exists: the main page shows the card, never as not found.
    expect(await loadFavorites(dir)).toMatchObject({
      kind: "ok",
      favorites: [{ key: "Pop/Linked/a.pdf" }],
      notFound: [],
    });
  });

  test("a missing file below a reachable linked folder still counts as missing", async () => {
    const drive = makeOutside();
    linkFolder("Linked", drive);
    writePdf("Linked/a.pdf", pdfA);
    const entry = { favorite: true, fingerprint: fingerprintOf(pdfA) };
    writeConfig({ "Linked/a.pdf": entry });
    fs.mkdirSync(full("Local"));
    fs.copyFileSync(full("Linked/a.pdf"), full("Local/a.pdf"));
    fs.rmSync(full("Linked/a.pdf"));

    expect(await loadSheetSettings({ folder: dir, pdfPath: full("Local/a.pdf") })).toEqual({
      kind: "ok",
      dividers: {},
      favorite: true,
    });
    expect(readSheets()).toEqual({ "Local/a.pdf": entry });
  });

  test("a sheet outside the folder and an unreadable config", async () => {
    expect(await loadSheetSettings({ folder: path.join(dir, "Noten"), pdfPath: full("a.pdf") })).toEqual({
      kind: "outside",
    });
    fs.writeFileSync(configPath(), "{ not json");
    expect(await loadSheetSettings({ folder: dir, pdfPath: full("a.pdf") })).toMatchObject({
      kind: "unreadable",
      file: CONFIG_FILE,
    });
  });
});

describe("a path spelled in another case than on disk", () => {
  /** Lets `readdir` of the folder `dirKey` list `edit(names)`; every other folder is listed for real. */
  const listAs = (dirKey: string, edit: (names: string[]) => string[]) => {
    const readdir = fs.promises.readdir;
    vi.spyOn(fs.promises, "readdir").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      const names = (await (readdir as (...args: unknown[]) => Promise<string[]>)(p, ...rest)) as string[];
      return p === full(dirKey) ? edit(names) : names;
    }) as typeof fs.promises.readdir);
  };

  /**
   * Like a case-insensitive file system (simulated): `Pop/Abba Gold.pdf` is on disk, `pop/abba gold.pdf` reaches
   * the same file (a folder link and a hard link) but is not listed.
   */
  const caseInsensitiveSetup = () => {
    writePdf("Pop/Abba Gold.pdf", pdfA);
    fs.linkSync(full("Pop/Abba Gold.pdf"), full("Pop/abba gold.pdf"));
    fs.symlinkSync(full("Pop"), full("pop"), "dir");
    const readdir = fs.promises.readdir;
    vi.spyOn(fs.promises, "readdir").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      const names = (await (readdir as (...args: unknown[]) => Promise<string[]>)(p, ...rest)) as string[];
      if (p === dir) return names.filter((n) => n !== "pop");
      return p === full("Pop") ? names.filter((n) => n !== "abba gold.pdf") : names;
    }) as typeof fs.promises.readdir);
  };

  test("diskSpelling takes the spelling on disk (simulated)", async () => {
    caseInsensitiveSetup();
    expect(await diskSpelling(dir, "pop/abba gold.pdf")).toBe("Pop/Abba Gold.pdf");
    expect(await diskSpelling(dir, "Pop/abba gold.pdf")).toBe("Pop/Abba Gold.pdf");
  });

  test("open and save under another spelling use the entry of the disk spelling (simulated)", async () => {
    caseInsensitiveSetup();
    const entry = { favorite: true, pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfA) };
    writeConfig({ "Pop/Abba Gold.pdf": entry });
    const before = ageConfig();
    const pdfPath = full("pop/abba gold.pdf");

    expect(await loadSheetSettings({ folder: dir, pdfPath })).toEqual({
      kind: "ok",
      dividers: { 1: 0.3 },
      favorite: true,
    });
    expect(fs.statSync(configPath()).mtimeMs).toBe(before);

    expect(await saveSheetSetting({ folder: dir, pdfPath, change: { favorite: false } })).toEqual({ ok: true });
    expect(readSheets()).toEqual({
      "Pop/Abba Gold.pdf": { pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfA) },
    });
    expect(await saveSheetSetting({ folder: dir, pdfPath, change: { favorite: true } })).toEqual({ ok: true });
    expect(readSheets()).toEqual({ "Pop/Abba Gold.pdf": entry });
  });

  test.skipIf(!caseInsensitiveFs)("open and save under another spelling use the disk spelling's entry", async () => {
    writePdf("Pop/Abba Gold.pdf", pdfA);
    const entry = { favorite: true, fingerprint: fingerprintOf(pdfA) };
    writeConfig({ "Pop/Abba Gold.pdf": entry });
    const pdfPath = full("pop/abba gold.pdf");

    expect(await loadSheetSettings({ folder: dir, pdfPath })).toEqual({ kind: "ok", dividers: {}, favorite: true });
    expect(await saveSheetSetting({ folder: dir, pdfPath, change: { favorite: true } })).toEqual({ ok: true });
    expect(readSheets()).toEqual({ "Pop/Abba Gold.pdf": entry });
  });

  test("an exact spelling stays, even when another spelling is listed too", async () => {
    writePdf("A/a.pdf", pdfA);
    listAs("A", (names) => [...names, "A.pdf"]);
    expect(await diskSpelling(dir, "A/a.pdf")).toBe("A/a.pdf");
  });

  test("ambiguous or no match keeps the key as given", async () => {
    writePdf("A/Abc.pdf", pdfA);
    listAs("A", () => ["abc.pdf", "ABC.pdf"]);
    expect(await diskSpelling(dir, "A/Abc.pdf")).toBe("A/Abc.pdf");
    vi.restoreAllMocks();
    listAs("A", () => []);
    expect(await diskSpelling(dir, "A/Abc.pdf")).toBe("A/Abc.pdf");
    vi.restoreAllMocks();
    expect(await diskSpelling(dir, "Missing/x.pdf")).toBe("Missing/x.pdf");
  });

  test.skipIf(caseInsensitiveFs)("another file that differs only in case is never taken", async () => {
    // Case-sensitive: `A/a.pdf` does not exist, `A/A.pdf` is another name, so nothing is renamed.
    writePdf("A/A.pdf", pdfA);
    writeConfig({ "A/A.pdf": { favorite: true } });
    expect(await diskSpelling(dir, "A/a.pdf")).toBe("A/a.pdf");
    expect(await loadSheetSettings({ folder: dir, pdfPath: full("A/a.pdf") })).toMatchObject({ favorite: false });
  });
});

describe("saveSheetSetting", () => {
  test("saving a favorite on a moved PDF moves first and keeps the requested state", async () => {
    writePdf("A/a.pdf", pdfA);
    const entry = { favorite: true, pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfA) };
    writeConfig({ "A/a.pdf": entry });
    movePdf("A/a.pdf", "B/a.pdf");

    expect(await saveSheetSetting({ folder: dir, pdfPath: full("B/a.pdf"), change: { favorite: true } })).toEqual({
      ok: true,
    });
    expect(readSheets()).toEqual({ "B/a.pdf": entry });
  });

  test("a locked PDF: the favorite is saved, an old fingerprint stays", async () => {
    writePdf("B/b.pdf", pdfB);
    const oldFingerprint = { sha256: "0".repeat(64), length: 1 };
    writeConfig({ "B/b.pdf": { pageDividers: { "1": 0.3 }, fingerprint: oldFingerprint } });
    fingerprintMock.mockRejectedValue(errorWithCode("EBUSY"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await saveSheetSetting({ folder: dir, pdfPath: full("B/b.pdf"), change: { favorite: true } })).toEqual({
      ok: true,
    });
    expect(readSheets()).toEqual({
      "B/b.pdf": { pageDividers: { "1": 0.3 }, fingerprint: oldFingerprint, favorite: true },
    });
  });

  test("saving a divider stores the fingerprint", async () => {
    writePdf("B/b.pdf", pdfB);
    const pdfPath = full("B/b.pdf");

    expect(await saveSheetSetting({ folder: dir, pdfPath, change: { page: 2, ratio: 0.4 } })).toEqual({ ok: true });
    expect(readSheets()).toEqual({ "B/b.pdf": { pageDividers: { "2": 0.4 }, fingerprint: fingerprintOf(pdfB) } });

    // Removing the last divider leaves only the fingerprint: the entry goes.
    expect(await saveSheetSetting({ folder: dir, pdfPath, change: { page: 2, ratio: null } })).toEqual({ ok: true });
    expect(readSheets()).toBeUndefined();
  });

  test("errors are reported as the divider save words them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      await saveSheetSetting({ folder: path.join(dir, "Noten"), pdfPath: full("a.pdf"), change: { favorite: true } }),
    ).toEqual({ ok: false, message: "Das Blatt liegt nicht im Notenordner." });
    writePdf("a.pdf", pdfA);
    fs.writeFileSync(configPath(), "{ not json");
    const result = await saveSheetSetting({ folder: dir, pdfPath: full("a.pdf"), change: { favorite: true } });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.message).toMatch(/^„\.config\.json“ kann nicht gelesen werden: /);
  });
});

describe("loadFavorites", () => {
  test("loadFavorites: sorted; a missing one without fingerprint is not found at once, one with fingerprint only after its search", async () => {
    writePdf("Pop/abba.pdf", pdfA);
    writePdf("Amen.pdf", pdfA);
    writePdf("Konzert/Amen.pdf", pdfB);
    writePdf("Pop/Nofav.pdf", pdfB);
    writeConfig({
      "Konzert/Amen.pdf": { favorite: true },
      "Zebra.pdf": { favorite: true, fingerprint: fingerprintOf(pdfB) },
      "Pop/Nofav.pdf": { pageDividers: { "1": 0.3 } },
      "Amen.pdf": { favorite: true },
      "Pop/abba.pdf": { favorite: true },
      "Pop/Old.pdf": { favorite: true },
    });
    const before = fs.readFileSync(configPath(), "utf8");

    expect(await loadFavorites(dir)).toEqual({
      kind: "ok",
      favorites: [
        { key: "Pop/abba.pdf", pdfPath: full("Pop/abba.pdf"), name: "abba", dir: "Pop" },
        { key: "Amen.pdf", pdfPath: full("Amen.pdf"), name: "Amen", dir: "" },
        { key: "Konzert/Amen.pdf", pdfPath: full("Konzert/Amen.pdf"), name: "Amen", dir: "Konzert" },
      ],
      notFound: [{ key: "Pop/Old.pdf", pdfPath: full("Pop/Old.pdf"), name: "Old", dir: "Pop" }],
    });
    expect(fs.readFileSync(configPath(), "utf8")).toBe(before);
    expect(fingerprintMock).not.toHaveBeenCalled();

    expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 1 });
    const after = await loadFavorites(dir);
    expect(after.kind === "ok" && after.notFound).toEqual([
      { key: "Pop/Old.pdf", pdfPath: full("Pop/Old.pdf"), name: "Old", dir: "Pop" },
      { key: "Zebra.pdf", pdfPath: full("Zebra.pdf"), name: "Zebra", dir: "" },
    ]);
    expect(fs.readFileSync(configPath(), "utf8")).toBe(before);

    const keys = await loadFavoriteKeys(dir);
    expect(keys.kind === "ok" && [...keys.keys].sort()).toEqual(
      ["Amen.pdf", "Konzert/Amen.pdf", "Pop/Old.pdf", "Pop/abba.pdf", "Zebra.pdf"].sort(),
    );
  });

  test("unknown stat shows the card", async () => {
    writeConfig({ "A/a.pdf": { favorite: true } });
    failStat(full("A/a.pdf"), "EACCES");

    expect(await loadFavorites(dir)).toEqual({
      kind: "ok",
      favorites: [{ key: "A/a.pdf", pdfPath: full("A/a.pdf"), name: "a", dir: "A" }],
      notFound: [],
    });
  });

  test("an unreadable config is reported", async () => {
    fs.writeFileSync(configPath(), "{ not json");
    expect(await loadFavorites(dir)).toMatchObject({ kind: "unreadable", file: CONFIG_FILE });
    expect(await loadFavoriteKeys(dir)).toMatchObject({ kind: "unreadable", file: CONFIG_FILE });
  });
});

describe("relinkMissingFavorites", () => {
  test("relinkMissingFavorites finds a renamed PDF in the same folder and a moved one elsewhere", async () => {
    const pdfC = await makePdf({ pages: 3, xref: "table" });
    writePdf("Pop/abba.pdf", pdfA);
    writePdf("Pop/amen.pdf", pdfB);
    writePdf("X/x.pdf", pdfC);
    const abba = { favorite: true, fingerprint: fingerprintOf(pdfA) };
    const amen = { favorite: true, pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfB) };
    const dividerOnly = { pageDividers: { "1": 0.6 }, fingerprint: fingerprintOf(pdfC) };
    writeConfig({ "Pop/abba.pdf": abba, "Pop/amen.pdf": amen, "X/x.pdf": dividerOnly });
    movePdf("Pop/abba.pdf", "Pop/Abba Gold.pdf");
    movePdf("Pop/amen.pdf", "Konzert/2026/amen.pdf");
    movePdf("X/x.pdf", "Y/x.pdf");

    expect(await relinkMissingFavorites(dir)).toEqual({ moved: 2, searched: 0 });
    // Divider entries without a favorite move only on open.
    expect(readSheets()).toEqual({ "Pop/Abba Gold.pdf": abba, "Konzert/2026/amen.pdf": amen, "X/x.pdf": dividerOnly });
    const favorites = await loadFavorites(dir);
    expect(favorites.kind === "ok" && favorites.favorites.map((f) => f.key)).toEqual([
      "Pop/Abba Gold.pdf",
      "Konzert/2026/amen.pdf",
    ]);
  });

  test("relinkMissingFavorites searches a deleted favorite once per run", async () => {
    writePdf("B/other.pdf", pdfB);
    writeConfig({ "A/gone.pdf": { favorite: true, fingerprint: { sha256: "0".repeat(64), length: 10 } } });

    expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 1 });
    expect(fingerprintMock).toHaveBeenCalled();
    fingerprintMock.mockClear();

    expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 0 });
    expect(fingerprintMock).not.toHaveBeenCalled();
    expect(readSheets()).toEqual({ "A/gone.pdf": { favorite: true, fingerprint: { sha256: "0".repeat(64), length: 10 } } });
  });

  test("a search cut short by an error runs again", async () => {
    writePdf("B/other.pdf", pdfB);
    writeConfig({ "A/gone.pdf": { favorite: true, fingerprint: { sha256: "0".repeat(64), length: 10 } } });
    fingerprintMock.mockRejectedValueOnce(errorWithCode("EBUSY"));

    expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 0 });
    expect(fingerprintMock).toHaveBeenCalledTimes(1);

    expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 1 });
    expect(fingerprintMock).toHaveBeenCalledTimes(2);
  });

  test("a search cut short is not listed as not found", async () => {
    writePdf("B/other.pdf", pdfB);
    writeConfig({ "A/gone.pdf": { favorite: true, fingerprint: { sha256: "0".repeat(64), length: 10 } } });
    fingerprintMock.mockRejectedValueOnce(errorWithCode("EBUSY"));

    await relinkMissingFavorites(dir);
    expect(await loadFavorites(dir)).toMatchObject({ kind: "ok", favorites: [], notFound: [] });

    await relinkMissingFavorites(dir);
    expect(await loadFavorites(dir)).toMatchObject({
      kind: "ok",
      favorites: [],
      notFound: [{ key: "A/gone.pdf", name: "gone", dir: "A" }],
    });
  });

  test.skipIf(isRoot)("a walk that skipped an unreadable folder counts as no complete search", async () => {
    writePdf("B/other.pdf", pdfB);
    fs.mkdirSync(full("Locked"));
    writeConfig({ "A/gone.pdf": { favorite: true, fingerprint: { sha256: "0".repeat(64), length: 10 } } });
    fs.chmodSync(full("Locked"), 0o000);
    try {
      expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 0 });
      expect(fingerprintMock).toHaveBeenCalledTimes(1);
      expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 0 });
      expect(fingerprintMock).toHaveBeenCalledTimes(2);
    } finally {
      fs.chmodSync(full("Locked"), 0o755);
    }
    // Once the walk sees everything, the search counts and is not repeated.
    expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 1 });
    expect(fingerprintMock).toHaveBeenCalledTimes(3);
    expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 0 });
    expect(fingerprintMock).toHaveBeenCalledTimes(3);
  });

  test("the search checks a PDF with the same name first, then the same folder, then the rest", async () => {
    writePdf("B/aaa.pdf", pdfB); // first in the listing
    writePdf("A/other.pdf", pdfB); // same folder
    writePdf("Z/song.pdf", pdfB); // same name, last in the listing
    writeConfig({ "A/song.pdf": { favorite: true, fingerprint: { sha256: "0".repeat(64), length: 10 } } });

    expect(await relinkMissingFavorites(dir)).toEqual({ moved: 0, searched: 1 });
    expect(fingerprintMock.mock.calls.map(([file]) => file)).toEqual([
      full("Z/song.pdf"),
      full("A/other.pdf"),
      full("B/aaa.pdf"),
    ]);
  });
});
