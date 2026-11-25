import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isListedSheetEntry, listSheetPdfs, resolveListedEntry } from "../src/sheetFiles";

describe("isListedSheetEntry", () => {
  it("lists pdfs in any spelling", () => {
    expect(isListedSheetEntry("a.pdf", false)).toBe(true);
    expect(isListedSheetEntry("A.PDF", false)).toBe(true);
  });
  it("hides other files and hidden files", () => {
    for (const n of ["Backup.zip", "x.png", ".a.pdf", ".data"]) {
      expect(isListedSheetEntry(n, false)).toBe(false);
    }
  });
  it("lists folders without a leading dot", () => {
    expect(isListedSheetEntry("Weihnachten", true)).toBe(true);
    expect(isListedSheetEntry(".git", true)).toBe(false);
  });
});

describe("resolveListedEntry", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-sheet-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const resolve = async (name: string) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return resolveListedEntry(dir, entries.find((e) => e.name === name)!);
  };

  it("lists a symlink to a directory as a folder", async () => {
    fs.mkdirSync(path.join(dir, "real"));
    fs.symlinkSync(path.join(dir, "real"), path.join(dir, "link"), "dir");
    expect(await resolve("link")).toEqual({ isDirectory: true });
  });
  it("lists a symlink to a pdf as a file", async () => {
    fs.writeFileSync(path.join(dir, "real.pdf"), "x");
    fs.symlinkSync(path.join(dir, "real.pdf"), path.join(dir, "link.pdf"));
    expect(await resolve("link.pdf")).toEqual({ isDirectory: false });
  });
  it("hides a broken symlink and a symlink to another file", async () => {
    fs.symlinkSync(path.join(dir, "missing"), path.join(dir, "broken.pdf"));
    fs.writeFileSync(path.join(dir, "real.txt"), "x");
    fs.symlinkSync(path.join(dir, "real.txt"), path.join(dir, "link.txt"));
    expect(await resolve("broken.pdf")).toBeUndefined();
    expect(await resolve("link.txt")).toBeUndefined();
  });
  it("lists plain pdfs and folders, hides other files", async () => {
    fs.writeFileSync(path.join(dir, "a.pdf"), "x");
    fs.writeFileSync(path.join(dir, "b.zip"), "x");
    fs.mkdirSync(path.join(dir, "Folder"));
    expect(await resolve("a.pdf")).toEqual({ isDirectory: false });
    expect(await resolve("b.zip")).toBeUndefined();
    expect(await resolve("Folder")).toEqual({ isDirectory: true });
  });
});

describe("listSheetPdfs", () => {
  let dir: string;
  let outside: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-sheet-pdfs-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "smv-sheet-outside-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const touch = (...parts: string[]) => {
    fs.mkdirSync(path.join(dir, ...parts.slice(0, -1)), { recursive: true });
    fs.writeFileSync(path.join(dir, ...parts), "x");
  };

  it("lists like the sheet list: hidden skipped, a link to a folder followed once, keys with /", async () => {
    touch("a.pdf");
    touch(".hidden.pdf");
    touch(".git", "x.pdf");
    touch("B", "b.pdf");
    touch("B", "notes.txt");
    touch("C", "D", "c.PDF");
    fs.symlinkSync(path.join(dir, "B"), path.join(dir, "link"), "dir");
    fs.writeFileSync(path.join(outside, "e.pdf"), "x");
    fs.symlinkSync(outside, path.join(dir, "ext"), "dir");
    fs.symlinkSync(path.join(dir, "missing"), path.join(dir, "broken.pdf"));

    expect(await listSheetPdfs(dir)).toEqual([
      { key: "a.pdf", file: path.join(dir, "a.pdf") },
      { key: "B/b.pdf", file: path.join(dir, "B", "b.pdf") },
      { key: "C/D/c.PDF", file: path.join(dir, "C", "D", "c.PDF") },
      { key: "ext/e.pdf", file: path.join(dir, "ext", "e.pdf") },
    ]);
  });
});
