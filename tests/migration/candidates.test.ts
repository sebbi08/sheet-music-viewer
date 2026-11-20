import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entryKind, findMigrationCandidates, scanMigrationCandidates } from "../../src/migration/candidates";
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

describe("scanMigrationCandidates", () => {
  const isRoot = process.getuid?.() === 0;
  const scan = () => scanMigrationCandidates(root);
  const rels = async () => (await scan()).candidates.map((c) => c.relativePath);

  it("finds pdfs with a sidecar in subfolders, .PDF in any case, sorted by relative path", async () => {
    put("z.pdf");
    put(".z.data");
    put("b/Y.PDF");
    put("b/.Y.data");
    put("a/deep/x.pdf");
    put("a/deep/.x.data");
    const result = await scan();
    expect(result.candidates.map((c) => c.relativePath)).toEqual(["a/deep/x.pdf", "b/Y.PDF", "z.pdf"]);
    expect(result.candidates[2].pdfPath).toBe(path.join(root, "z.pdf"));
    expect(result.candidates[2].sidecarPath).toBe(path.join(root, ".z.data"));
    expect(result.errors).toEqual([]);
  });

  it("skips entries starting with a dot and sidecars without a pdf", async () => {
    put(".hidden/a.pdf");
    put(".hidden/.a.data");
    put(".h.pdf");
    put("..h.data");
    put(".orphan.data");
    put("plain.pdf");
    expect(await rels()).toEqual([]);
  });

  it("finds a pdf named with $$ by the old app's rule", async () => {
    put("Mo Money$$.pdf");
    put(".Mo Money$.data");
    expect(await rels()).toEqual(["Mo Money$$.pdf"]);
  });

  it("follows a linked folder and a linked pdf", async () => {
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "a.pdf"), "x");
    fs.writeFileSync(path.join(outside, ".a.data"), "x");
    fs.symlinkSync(outside, path.join(root, "link"), "dir");
    fs.writeFileSync(path.join(base, "c.pdf"), "x");
    fs.writeFileSync(path.join(root, ".c.data"), "x"); // the sidecar sits next to the link, not the target
    fs.symlinkSync(path.join(base, "c.pdf"), path.join(root, "c.pdf"));
    const result = await scan();
    expect(result.candidates.map((c) => c.relativePath)).toEqual(["c.pdf", "link/a.pdf"]);
    expect(result.candidates[1].pdfPath).toBe(path.join(root, "link", "a.pdf"));
    expect(result.candidates[1].sidecarPath).toBe(path.join(root, "link", ".a.data"));
    expect(result.errors).toEqual([]);
  });

  it("a link back to a parent folder ends: every pdf once", async () => {
    put("sub/a.pdf");
    put("sub/.a.data");
    fs.symlinkSync(root, path.join(root, "sub", "up"), "dir");
    const result = await scan();
    expect(result.candidates.map((c) => c.relativePath)).toEqual(["sub/a.pdf"]);
    expect(result.errors).toEqual([]);
  });

  it("the same folder reached on two ways is visited once", async () => {
    put("real/a.pdf");
    put("real/.a.data");
    fs.symlinkSync(path.join(root, "real"), path.join(root, "alias"), "dir");
    const result = await scan();
    expect(result.candidates.map((c) => c.relativePath)).toEqual(["alias/a.pdf"]);
    expect(result.errors).toEqual([]);
  });

  it("a link whose target cannot be read is an error", async () => {
    fs.symlinkSync(path.join(base, "missing"), path.join(root, "dead"));
    put("a.pdf");
    put(".a.data");
    const result = await scan();
    expect(result.candidates.map((c) => c.relativePath)).toEqual(["a.pdf"]);
    expect(result.errors).toEqual([{ relativePath: "dead", kind: "link", message: expect.any(String) }]);
  });

  it.skipIf(isRoot)("a subfolder that cannot be listed is an error; the rest is still scanned", async () => {
    put("a.pdf");
    put(".a.data");
    put("locked/b.pdf");
    put("locked/.b.data");
    fs.chmodSync(path.join(root, "locked"), 0o000);
    try {
      const result = await scan();
      expect(result.candidates.map((c) => c.relativePath)).toEqual(["a.pdf"]);
      expect(result.errors).toEqual([{ relativePath: "locked", kind: "folder", message: expect.any(String) }]);
    } finally {
      fs.chmodSync(path.join(root, "locked"), 0o755);
    }
  });

  it("a sidecar that cannot be stat'ed (not ENOENT) still makes the pdf a candidate; a missing one does not", async () => {
    put("a.pdf");
    put(".a.data");
    put("b.pdf");
    const sidecar = path.join(root, ".a.data");
    const realStat = fs.promises.stat.bind(fs.promises);
    const stat = vi.spyOn(fs.promises, "stat").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      if (p === sidecar) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      return (realStat as (...a: unknown[]) => Promise<fs.Stats>)(p, ...rest);
    }) as never);
    try {
      const result = await scan();
      expect(result.candidates.map((c) => c.relativePath)).toEqual(["a.pdf"]);
      expect(result.candidates[0].sidecarPath).toBe(sidecar);
      expect(result.errors).toEqual([]);
    } finally {
      stat.mockRestore();
    }
  });

  it("a sidecar path that is a directory is no sidecar", async () => {
    put("a.pdf");
    fs.mkdirSync(path.join(root, ".a.data"));
    expect(await rels()).toEqual([]);
  });

  it("a root that cannot be listed is an error with relativePath '.'", async () => {
    const result = await scanMigrationCandidates(path.join(base, "missing"));
    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([{ relativePath: ".", kind: "folder", message: expect.any(String) }]);
  });
});
