import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFolderWritable } from "../../src/pdfMarkup/folderProbe";

/** chmod-based read-only tests do not work as root (root ignores permission bits). */
const isRoot = process.getuid?.() === 0;

let root: string;
const denied = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "smv-folder-probe-"));
});
afterEach(() => {
  fs.chmodSync(root, 0o755);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("isFolderWritable", () => {
  it("a writable folder: true, and the probe leaves no file", async () => {
    expect(await isFolderWritable(root)).toBe(true);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.skipIf(isRoot)("a folder without write permission: false", async () => {
    fs.chmodSync(root, 0o555);
    expect(await isFolderWritable(root)).toBe(false);
  });

  it("creating the probe fails with EPERM/EACCES/EROFS (Windows ACL: access() passes): false", async () => {
    for (const code of ["EPERM", "EACCES", "EROFS"]) {
      const open = vi.spyOn(fs.promises, "open").mockRejectedValueOnce(denied(code));
      try {
        expect(await isFolderWritable(root)).toBe(false);
      } finally {
        open.mockRestore();
      }
    }
  });

  it("other errors are not a read-only folder (the backup reports them)", async () => {
    const open = vi.spyOn(fs.promises, "open").mockRejectedValueOnce(denied("ENOSPC"));
    try {
      expect(await isFolderWritable(root)).toBe(true);
    } finally {
      open.mockRestore();
    }
  });

  it("a probe that is locked for a moment is removed on a later attempt: writable, no file left", async () => {
    const rm = vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(denied("EBUSY"));
    try {
      expect(await isFolderWritable(root)).toBe(true);
      expect(rm).toHaveBeenCalledTimes(2);
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      rm.mockRestore();
    }
  });
});
