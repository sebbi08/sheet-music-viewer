import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entryKind, findMigrationCandidates } from "../../src/migration/candidates";
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

/** How libuv reports any reparse point on Windows (also Nextcloud/OneDrive placeholders): a link, nothing else. */
const reparseDirent = (name: string) => ({
  name,
  isSymbolicLink: () => true,
  isDirectory: () => false,
  isFile: () => false,
});
const fakeStat = (kind: "file" | "directory" | "symlink") =>
  ({
    isSymbolicLink: () => kind === "symlink",
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
  }) as fs.Stats;

describe("entryKind (Windows reparse points)", () => {
  it("a reparse point that lstat reports as a folder or file is scanned", async () => {
    expect(await entryKind(reparseDirent("x"), "/x", async () => fakeStat("directory"))).toBe("directory");
    expect(await entryKind(reparseDirent("x.pdf"), "/x.pdf", async () => fakeStat("file"))).toBe("file");
  });

  it("a real link (symlink, junction) is skipped", async () => {
    expect(await entryKind(reparseDirent("x"), "/x", async () => fakeStat("symlink"))).toBeNull();
  });

  it("a reparse point lstat cannot read is skipped", async () => {
    expect(
      await entryKind(reparseDirent("x"), "/x", async () => {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }),
    ).toBeNull();
  });

  it("plain entries need no lstat", async () => {
    const lstat = vi.fn(async () => fakeStat("symlink"));
    const dirent = (dir: boolean) => ({ isSymbolicLink: () => false, isDirectory: () => dir, isFile: () => !dir });
    expect(await entryKind(dirent(true), "/d", lstat)).toBe("directory");
    expect(await entryKind(dirent(false), "/f", lstat)).toBe("file");
    expect(lstat).not.toHaveBeenCalled();
  });

  it("findMigrationCandidates scans placeholders that readdir reports as links", async () => {
    put("cloud/a.pdf");
    put("cloud/.a.data");
    put("b.pdf");
    put(".b.data");
    const realReaddir = fs.promises.readdir.bind(fs.promises);
    const readdir = vi.spyOn(fs.promises, "readdir").mockImplementation((async (dir: string, options: unknown) => {
      const entries = (await realReaddir(dir, options as { withFileTypes: true })) as fs.Dirent[];
      return entries.map((e) => (e.name === "cloud" || e.name === "b.pdf" ? reparseDirent(e.name) : e));
    }) as never);
    try {
      expect(await find()).toEqual(["b.pdf", "cloud/a.pdf"]);
    } finally {
      readdir.mockRestore();
    }
  });
});
