import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { contentKey, createFileWriteCheckCache } from "../../src/pdfMarkup/writeCheckCache";

const isRoot = process.getuid?.() === 0;
let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-wcc-"));
  file = path.join(dir, "sub", "cache.json");
});
afterEach(() => {
  fs.chmodSync(dir, 0o755);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("contentKey", () => {
  test("is sha256 hex and length", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(contentKey(bytes)).toBe(`${createHash("sha256").update(bytes).digest("hex")}:4`);
  });
  test("differs for different bytes", () => {
    expect(contentKey(new Uint8Array([1]))).not.toBe(contentKey(new Uint8Array([2])));
  });
});

describe("createFileWriteCheckCache", () => {
  test("round trip", async () => {
    const k1 = contentKey(new Uint8Array([1]));
    const k2 = contentKey(new Uint8Array([2]));
    await createFileWriteCheckCache(file).set(k1, { ok: true });
    await createFileWriteCheckCache(file).set(k2, { ok: false, message: "x" });
    const again = createFileWriteCheckCache(file);
    expect(await again.get(k1)).toEqual({ ok: true });
    expect(await again.get(k2)).toEqual({ ok: false, message: "x" });
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(json).toEqual({ version: 1, entries: { [k1]: { ok: true }, [k2]: { ok: false, message: "x" } } });
    expect(fs.readdirSync(path.dirname(file))).toEqual(["cache.json"]);
  });

  test("a changed file misses the cache", async () => {
    const cache = createFileWriteCheckCache(file);
    await cache.set(contentKey(new Uint8Array([1])), { ok: true });
    expect(await cache.get(contentKey(new Uint8Array([9])))).toBeUndefined();
  });

  test.each([["{ not json"], [JSON.stringify({ version: 2, entries: { a: { ok: true } } })]])(
    "unusable file %s counts as empty and is replaced",
    async (content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      const cache = createFileWriteCheckCache(file);
      expect(await cache.get("a")).toBeUndefined();
      await cache.set("b", { ok: true });
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 1, entries: { b: { ok: true } } });
    },
  );

  test("oldest dropped beyond maxEntries, set moves a key to the end", async () => {
    const cache = createFileWriteCheckCache(file, 3);
    for (const k of ["k1", "k2", "k3", "k4"]) await cache.set(k, { ok: true });
    expect(await cache.get("k1")).toBeUndefined();
    for (const k of ["k2", "k3", "k4"]) expect(await cache.get(k)).toEqual({ ok: true });
    await cache.set("k2", { ok: true });
    await cache.set("k5", { ok: true });
    expect(await cache.get("k3")).toBeUndefined();
    expect(await cache.get("k2")).toEqual({ ok: true });
  });

  test.skipIf(isRoot)("write failure is swallowed (skipped as root)", async () => {
    fs.chmodSync(dir, 0o555);
    const cache = createFileWriteCheckCache(path.join(dir, "sub", "cache.json"));
    await expect(cache.set("k", { ok: true })).resolves.toBeUndefined();
    expect(await cache.get("k")).toBeUndefined();
  });
});
