import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CONFIG_FILE } from "../src/folderConfig";
import { setLockRetryDelays } from "../src/pdfMarkup/lockRetry";
import {
  loadSheetSettings,
  sheetInputSchema,
  savePageDivider,
  savePageDividerInputSchema,
} from "../src/trcpLib";

// trcpLib.ts imports Electron at the top; the divider functions do not use it.
vi.mock("electron", () => ({ app: { isPackaged: false }, autoUpdater: {}, dialog: {} }));

let dir: string;
let previousDelays: readonly number[];
const configPath = () => path.join(dir, CONFIG_FILE);
const pdfPath = () => path.join(dir, "A", "a.pdf");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-dividers-"));
  previousDelays = setLockRetryDelays([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  setLockRetryDelays(previousDelays);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("page dividers over tRPC", () => {
  test("no file -> ok with no dividers", async () => {
    expect(await loadSheetSettings({ folder: dir, pdfPath: pdfPath() })).toEqual({ kind: "ok", dividers: {}, favorite: false });
  });

  test("a saved divider is loaded again and stored under the sheet key", async () => {
    expect(await savePageDivider({ folder: dir, pdfPath: pdfPath(), page: 2, ratio: 0.62 })).toEqual({ ok: true });
    expect(await loadSheetSettings({ folder: dir, pdfPath: pdfPath() })).toEqual({ kind: "ok", dividers: { 2: 0.62 }, favorite: false });
    const config = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    expect(config.sheets["A/a.pdf"]).toBeDefined();
  });

  test("keys that are not whole pages are left out", async () => {
    fs.writeFileSync(
      configPath(),
      JSON.stringify({ version: 1, sheets: { "A/a.pdf": { pageDividers: { "2.5": 0.4, "0": 0.4, x: 0.4, "3": 0.7 } } } }),
    );
    expect(await loadSheetSettings({ folder: dir, pdfPath: pdfPath() })).toEqual({ kind: "ok", dividers: { 3: 0.7 }, favorite: false });
  });

  test("ratio null removes a divider", async () => {
    await savePageDivider({ folder: dir, pdfPath: pdfPath(), page: 2, ratio: 0.62 });
    expect(await savePageDivider({ folder: dir, pdfPath: pdfPath(), page: 2, ratio: null })).toEqual({ ok: true });
    expect(await loadSheetSettings({ folder: dir, pdfPath: pdfPath() })).toEqual({ kind: "ok", dividers: {}, favorite: false });
  });

  test("an unreadable file is reported, saving does not overwrite it", async () => {
    fs.writeFileSync(configPath(), "{ not json");
    const loaded = await loadSheetSettings({ folder: dir, pdfPath: pdfPath() });
    expect(loaded).toMatchObject({ kind: "unreadable", file: ".config.json" });
    const saved = await savePageDivider({ folder: dir, pdfPath: pdfPath(), page: 1, ratio: 0.4 });
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.message.startsWith("„.config.json“ kann nicht gelesen werden: ")).toBe(true);
    expect(fs.readFileSync(configPath(), "utf8")).toBe("{ not json");
  });

  test("a sheet outside the folder has no dividers and its load reads no file", async () => {
    fs.writeFileSync(configPath(), "{ not json");
    const outside = path.join(os.tmpdir(), "x.pdf");
    expect(sheetInputSchema.safeParse({ folder: dir, pdfPath: outside }).success).toBe(true);
    expect(await loadSheetSettings({ folder: dir, pdfPath: outside })).toEqual({ kind: "outside" });
    expect(await loadSheetSettings({ folder: dir, pdfPath: path.join(dir, "..", "x.pdf") })).toEqual({
      kind: "outside",
    });
    expect(fs.readFileSync(configPath(), "utf8")).toBe("{ not json");
  });

  test("the save input schema rejects bad ratios, pages and a PDF outside the folder", () => {
    const ok = { folder: dir, pdfPath: pdfPath(), page: 1, ratio: 0.5 };
    expect(savePageDividerInputSchema.safeParse(ok).success).toBe(true);
    expect(savePageDividerInputSchema.safeParse({ ...ok, ratio: null }).success).toBe(true);
    expect(savePageDividerInputSchema.safeParse({ ...ok, ratio: 0.99 }).success).toBe(false);
    expect(savePageDividerInputSchema.safeParse({ ...ok, page: 0 }).success).toBe(false);
    expect(savePageDividerInputSchema.safeParse({ ...ok, pdfPath: path.join(os.tmpdir(), "x.pdf") }).success).toBe(
      false,
    );
  });
});
