import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CONFIG_FILE } from "../src/folderConfig";
import { setLockRetryDelays } from "../src/pdfMarkup/lockRetry";
import {
  loadFavorites,
  loadSheetSettings,
  setFavorite,
  setFavoriteInputSchema,
} from "../src/trcpLib";

vi.mock("electron", () => ({ app: { isPackaged: false }, autoUpdater: {}, dialog: {} }));

let dir: string;
let previousDelays: readonly number[];
const configPath = () => path.join(dir, CONFIG_FILE);
const pdfPath = () => path.join(dir, "A", "a.pdf");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-favorites-"));
  fs.mkdirSync(path.join(dir, "A"));
  fs.writeFileSync(pdfPath(), "%PDF-1.4\nnot a real pdf\n");
  previousDelays = setLockRetryDelays([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  setLockRetryDelays(previousDelays);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("favorites over tRPC", () => {
  test("setFavorite then loadFavorites and loadSheetSettings show it", async () => {
    expect(await setFavorite({ folder: dir, pdfPath: pdfPath(), favorite: true })).toEqual({ ok: true });
    expect(await loadSheetSettings({ folder: dir, pdfPath: pdfPath() })).toEqual({
      kind: "ok",
      dividers: {},
      favorite: true,
    });
    const favorites = await loadFavorites(dir);
    expect(favorites.kind).toBe("ok");
    if (favorites.kind === "ok") expect(favorites.favorites.map((f) => f.key)).toEqual(["A/a.pdf"]);
  });

  test("setFavorite rejects a PDF outside the folder", () => {
    const input = { folder: dir, pdfPath: path.join(os.tmpdir(), "x.pdf"), favorite: true };
    expect(setFavoriteInputSchema.safeParse(input).success).toBe(false);
    expect(setFavoriteInputSchema.safeParse({ ...input, pdfPath: pdfPath() }).success).toBe(true);
  });

  test("an unreadable file: setFavorite fails with the reason and writes nothing", async () => {
    fs.writeFileSync(configPath(), "{ not json");
    const result = await setFavorite({ folder: dir, pdfPath: pdfPath(), favorite: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.startsWith("„.config.json“ kann nicht gelesen werden: ")).toBe(true);
    expect(fs.readFileSync(configPath(), "utf8")).toBe("{ not json");
  });
});
