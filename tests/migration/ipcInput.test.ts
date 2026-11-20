import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  absoluteFolderSchema,
  isInsideFolder,
  migrateMarkupSidecarInputSchema,
  migrationBackupInputSchema,
  readMigrationSourceInputSchema,
} from "../../src/migration/ipcInput";
import type { MigrationCandidate } from "../../src/migration/types";

const root = "/noten";
const candidate = (relativePath: string): MigrationCandidate => {
  const pdfPath = path.join(root, ...relativePath.split("/"));
  return {
    pdfPath,
    sidecarPath: path.join(path.dirname(pdfPath), "." + path.basename(pdfPath, ".pdf") + ".data"),
    relativePath,
  };
};
const backupInput = (...candidates: MigrationCandidate[]) => ({ root, candidates });

describe("isInsideFolder", () => {
  test("posix: below the folder, not the folder itself, no traversal, no name prefix, case-sensitive", () => {
    expect(isInsideFolder("/noten", "/noten/a.pdf", path.posix)).toBe(true);
    expect(isInsideFolder("/noten/", "/noten/Sub/a.pdf", path.posix)).toBe(true);
    expect(isInsideFolder("/noten", "/noten", path.posix)).toBe(false);
    expect(isInsideFolder("/noten", "/noten/../etc/a.pdf", path.posix)).toBe(false);
    expect(isInsideFolder("/noten", "/noten2/a.pdf", path.posix)).toBe(false);
    expect(isInsideFolder("/noten", "/Noten/a.pdf", path.posix)).toBe(false);
    expect(isInsideFolder("/noten", "/noten/..a.pdf", path.posix)).toBe(true);
  });

  test("win32: case-insensitive, other drives and traversal are outside", () => {
    expect(isInsideFolder("C:\\Noten", "c:\\noten\\Sub\\A.pdf", path.win32)).toBe(true);
    expect(isInsideFolder("C:\\Noten", "C:/Noten/A.pdf", path.win32)).toBe(true);
    expect(isInsideFolder("C:\\Noten", "D:\\Noten\\A.pdf", path.win32)).toBe(false);
    expect(isInsideFolder("C:\\Noten", "C:\\Noten\\..\\A.pdf", path.win32)).toBe(false);
    expect(isInsideFolder("C:\\Noten", "C:\\Noten2\\A.pdf", path.win32)).toBe(false);
  });
});

describe("absoluteFolderSchema", () => {
  test("accepts an absolute path, rejects relative, empty and NUL", () => {
    expect(absoluteFolderSchema.safeParse("/noten").success).toBe(true);
    expect(absoluteFolderSchema.safeParse("noten").success).toBe(false);
    expect(absoluteFolderSchema.safeParse("").success).toBe(false);
    expect(absoluteFolderSchema.safeParse("/no\0ten").success).toBe(false);
  });
});

describe("migrationBackupInputSchema", () => {
  test("accepts candidates found below the root", () => {
    const input = backupInput(candidate("a.pdf"), candidate("Weihnachten/Amen.pdf"));
    expect(migrationBackupInputSchema.parse(input)).toEqual(input);
  });

  test("rejects a relative root", () => {
    expect(migrationBackupInputSchema.safeParse({ root: "noten", candidates: [] }).success).toBe(false);
  });

  test("rejects a pdf outside the root (other folder, traversal, name prefix)", () => {
    for (const pdfPath of ["/other/a.pdf", "/noten/../etc/a.pdf", "/noten2/a.pdf"]) {
      const c = { ...candidate("a.pdf"), pdfPath };
      expect(migrationBackupInputSchema.safeParse(backupInput(c)).success, pdfPath).toBe(false);
    }
  });

  test("rejects a sidecar outside the root or that is not the pdf's own sidecar", () => {
    const outside = { ...candidate("a.pdf"), sidecarPath: "/other/.a.data" };
    const foreign = { ...candidate("a.pdf"), sidecarPath: "/noten/.b.data" };
    expect(migrationBackupInputSchema.safeParse(backupInput(outside)).success).toBe(false);
    expect(migrationBackupInputSchema.safeParse(backupInput(foreign)).success).toBe(false);
  });

  test("rejects a relative path that does not match the pdf (it names the zip entry)", () => {
    const c = { ...candidate("a.pdf"), relativePath: "../../a.pdf" };
    expect(migrationBackupInputSchema.safeParse(backupInput(c)).success).toBe(false);
  });

  test("rejects a non-pdf path", () => {
    const c = { ...candidate("a.pdf"), pdfPath: "/noten/a.txt" };
    expect(migrationBackupInputSchema.safeParse(backupInput(c)).success).toBe(false);
  });
});

/** Both inputs carry one candidate; it must lie lexically in the folder and own its sidecar. */
describe.each([
  ["readMigrationSourceInputSchema", (c: MigrationCandidate) => readMigrationSourceInputSchema.safeParse({ root, candidate: c })],
  [
    "migrateMarkupSidecarInputSchema",
    (c: MigrationCandidate) =>
      migrateMarkupSidecarInputSchema.safeParse({ root, candidate: c, pages: [{ page: 1, payload: null, pngBase64: null }], dryRun: true }),
  ],
])("%s", (_name, parse) => {
  test("accepts a candidate below the root", () => {
    expect(parse(candidate("Weihnachten/Amen.pdf")).success).toBe(true);
  });

  test("rejects a candidate outside the root (other folder, traversal, name prefix)", () => {
    for (const pdfPath of ["/other/a.pdf", "/noten/../etc/a.pdf", "/noten2/a.pdf"]) {
      const c = { pdfPath, sidecarPath: path.join(path.dirname(pdfPath), ".a.data"), relativePath: "a.pdf" };
      expect(parse(c).success, pdfPath).toBe(false);
    }
  });

  test("rejects a sidecar that is not the pdf's own", () => {
    expect(parse({ ...candidate("a.pdf"), sidecarPath: "/noten/.b.data" }).success).toBe(false);
    expect(parse({ ...candidate("a.pdf"), sidecarPath: "/other/.a.data" }).success).toBe(false);
  });

  test("rejects a relative pdf path", () => {
    expect(parse({ ...candidate("a.pdf"), pdfPath: "a.pdf", sidecarPath: ".a.data" }).success).toBe(false);
  });
});

describe("candidate through a link", () => {
  let base: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "smv-ipc-"));
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  test("a pdf behind a linked folder lies lexically in the root and is accepted", () => {
    const linkRoot = path.join(base, "Noten");
    const outside = path.join(base, "outside");
    fs.mkdirSync(linkRoot);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(linkRoot, "Linked"), "dir");
    const pdfPath = path.join(linkRoot, "Linked", "a.pdf");
    const c = { pdfPath, sidecarPath: path.join(linkRoot, "Linked", ".a.data"), relativePath: "Linked/a.pdf" };
    expect(readMigrationSourceInputSchema.safeParse({ root: linkRoot, candidate: c }).success).toBe(true);
    expect(
      migrateMarkupSidecarInputSchema.safeParse({ root: linkRoot, candidate: c, pages: [], dryRun: false }).success,
    ).toBe(true);
  });
});

describe("migrateMarkupSidecarInputSchema", () => {
  test("needs dryRun and valid pages", () => {
    const c = candidate("a.pdf");
    expect(migrateMarkupSidecarInputSchema.safeParse({ root, candidate: c, pages: [] }).success).toBe(false);
    expect(
      migrateMarkupSidecarInputSchema.safeParse({ root, candidate: c, pages: [{ page: 0, payload: null, pngBase64: null }], dryRun: true })
        .success,
    ).toBe(false);
  });
});
