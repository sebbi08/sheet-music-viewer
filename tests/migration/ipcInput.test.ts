import path from "path";
import { describe, expect, test } from "vitest";
import {
  absoluteFolderSchema,
  isInsideFolder,
  migrationBackupInputSchema,
  recordMigrationSkipInputSchema,
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

describe("recordMigrationSkipInputSchema", () => {
  test("accepts a permanent reason", () => {
    for (const reason of ["corruptData", "alreadyEmbedded", "notWritable"]) {
      expect(recordMigrationSkipInputSchema.safeParse({ candidate: candidate("a.pdf"), reason }).success, reason).toBe(true);
    }
  });

  test("rejects transient and unknown reasons: they must never skip a file", () => {
    for (const reason of ["locked", "notBackedUp", "pendingChanges", "other", "nonsense", 1]) {
      expect(recordMigrationSkipInputSchema.safeParse({ candidate: candidate("a.pdf"), reason }).success).toBe(false);
    }
  });

  test("rejects a malformed candidate", () => {
    const relative = { ...candidate("a.pdf"), pdfPath: "a.pdf" };
    const foreign = { ...candidate("a.pdf"), sidecarPath: "/elsewhere/.a.data" };
    expect(recordMigrationSkipInputSchema.safeParse({ candidate: relative, reason: "corruptData" }).success).toBe(false);
    expect(recordMigrationSkipInputSchema.safeParse({ candidate: foreign, reason: "corruptData" }).success).toBe(false);
  });
});
