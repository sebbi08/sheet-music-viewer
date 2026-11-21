import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MigratedFolders } from "../../src/migration/migratedFolders";

let base: string;
let stateFile: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "smv-migrated-"));
  stateFile = path.join(base, "userData", "markup-migrated-folders.json");
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("MigratedFolders", () => {
  it("a missing file means nothing is migrated", async () => {
    expect((await MigratedFolders.load(stateFile)).has("/s/noten")).toBe(false);
  });

  it("remembers an added folder, also after a reload", async () => {
    const folders = await MigratedFolders.load(stateFile);
    await folders.add("/s/noten");
    expect(folders.has("/s/noten")).toBe(true);
    expect((await MigratedFolders.load(stateFile)).has("/s/noten")).toBe(true);
    expect(JSON.parse(fs.readFileSync(stateFile, "utf8"))).toEqual({ version: 1, folders: [path.resolve("/s/noten")] });
  });

  it("a broken file is empty", async () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, "{not json");
    expect((await MigratedFolders.load(stateFile)).has("/s/noten")).toBe(false);
    fs.writeFileSync(stateFile, JSON.stringify({ version: 1, folders: [7, null] }));
    expect((await MigratedFolders.load(stateFile)).has("/s/noten")).toBe(false);
  });

  it("ignores a trailing separator", async () => {
    const folders = await MigratedFolders.load(stateFile);
    await folders.add("/s/noten/");
    expect(folders.has("/s/noten")).toBe(true);
  });

  it("does not store a folder twice", async () => {
    const folders = await MigratedFolders.load(stateFile);
    await folders.add("/s/noten");
    await folders.add("/s/noten/");
    expect(JSON.parse(fs.readFileSync(stateFile, "utf8")).folders).toHaveLength(1);
  });

  it("is case-insensitive on Windows", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const folders = await MigratedFolders.load(stateFile);
      await folders.add("C:\\Noten");
      expect(folders.has("c:\\noten\\")).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("a profile folder that cannot be written: add resolves and logs", async () => {
    const mkdir = vi.spyOn(fs.promises, "mkdir").mockRejectedValue(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const folders = await MigratedFolders.load(stateFile);
      await expect(folders.add("/s/noten")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      mkdir.mockRestore();
      warn.mockRestore();
    }
  });
});
