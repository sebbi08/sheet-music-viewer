import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMigrationCandidates } from "../../src/migration/candidates";
import { SkipList } from "../../src/migration/skipList";

let base: string;
let root: string;
let skips: SkipList;
const put = (rel: string, content = "x") => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const find = async () => (await findMigrationCandidates(root, skips)).map((c) => c.relativePath);

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "smv-cand-"));
  root = path.join(base, "Noten");
  fs.mkdirSync(root);
  skips = await SkipList.load(path.join(base, "skips.json"));
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("findMigrationCandidates", () => {
  it("finds pdfs with legacy and v1 sidecars in subfolders", async () => {
    put("a.pdf");
    put(".a.data");
    put("sub/deep/b.pdf");
    put("sub/deep/.b.data", JSON.stringify({ version: 1 }));
    expect(await find()).toEqual(["a.pdf", "sub/deep/b.pdf"]);
    const c = (await findMigrationCandidates(root, skips))[0];
    expect(c.pdfPath).toBe(path.join(root, "a.pdf"));
    expect(c.sidecarPath).toBe(path.join(root, ".a.data"));
  });

  it("matches .PDF case-insensitively", async () => {
    put("A.PDF");
    put(".A.data");
    expect(await find()).toEqual(["A.PDF"]);
  });

  it("skips folders starting with a dot", async () => {
    put(".hidden/a.pdf");
    put(".hidden/.a.data");
    expect(await find()).toEqual([]);
  });

  it("does not follow symlinks", async () => {
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "o.pdf"), "x");
    fs.writeFileSync(path.join(outside, ".o.data"), "x");
    fs.symlinkSync(outside, path.join(root, "link"), "dir");
    expect(await find()).toEqual([]);
  });

  it("ignores pdfs without sidecar", async () => {
    put("a.pdf");
    expect(await find()).toEqual([]);
  });

  it("ignores a sidecar without a pdf", async () => {
    put(".a.data");
    expect(await find()).toEqual([]);
  });

  it("sorts by relative path with forward slashes", async () => {
    put("z.pdf");
    put(".z.data");
    put("b/y.pdf");
    put("b/.y.data");
    put("a/x.pdf");
    put("a/.x.data");
    expect(await find()).toEqual(["a/x.pdf", "b/y.pdf", "z.pdf"]);
  });

  it("excludes skipped candidates with an unchanged fingerprint", async () => {
    put("a.pdf");
    put(".a.data");
    const [c] = await findMigrationCandidates(root, skips);
    await skips.record(c, "corruptData");
    expect(await find()).toEqual([]);
  });

  it("includes them again after the sidecar or the pdf changed", async () => {
    put("a.pdf");
    put(".a.data");
    const [c] = await findMigrationCandidates(root, skips);
    await skips.record(c, "corruptData");
    put(".a.data", "changed!");
    expect(await find()).toEqual(["a.pdf"]);
    await skips.record(c, "corruptData");
    expect(await find()).toEqual([]);
    put("a.pdf", "changed pdf");
    expect(await find()).toEqual(["a.pdf"]);
  });
});
