import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanMigrationCandidates } from "../../src/migration/candidates";

let base: string;
let root: string;
const put = (rel: string, content = "x") => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "smv-cand-"));
  root = path.join(base, "Noten");
  fs.mkdirSync(root);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

/** How libuv reports any reparse point on Windows (also Nextcloud/OneDrive placeholders): a link, nothing else. */
const reparseDirent = (name: string) => ({
  name,
  isSymbolicLink: () => true,
  isDirectory: () => false,
  isFile: () => false,
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

  it("scans placeholders that readdir reports as links (resolved with stat)", async () => {
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
      const result = await scan();
      expect(result.candidates.map((c) => c.relativePath)).toEqual(["b.pdf", "cloud/a.pdf"]);
      expect(result.errors).toEqual([]);
    } finally {
      readdir.mockRestore();
    }
  });

  it("a sidecar path that is a directory is no sidecar", async () => {
    put("a.pdf");
    fs.mkdirSync(path.join(root, ".a.data"));
    expect(await rels()).toEqual([]);
  });

  it("a failing realpath alone is no error: the candidates are still found by their resolved path", async () => {
    put("a.pdf");
    put(".a.data");
    put("sub/b.pdf");
    put("sub/.b.data");
    const realpath = vi
      .spyOn(fs.promises, "realpath")
      .mockRejectedValue(Object.assign(new Error("EISDIR: illegal operation on a directory, realpath"), { code: "EISDIR" }));
    try {
      const result = await scan();
      expect(result.candidates.map((c) => c.relativePath)).toEqual(["a.pdf", "sub/b.pdf"]);
      expect(result.errors).toEqual([]);
      expect(realpath).toHaveBeenCalled();
    } finally {
      realpath.mockRestore();
    }
  });

  it("a pdf reached directly and through a link, each with its own sidecar, is a candidate on both ways", async () => {
    put("a.pdf");
    put(".a.data");
    fs.mkdirSync(path.join(root, "sub"));
    fs.symlinkSync(path.join("..", "a.pdf"), path.join(root, "sub", "link.pdf"));
    put("sub/.link.data");
    const result = await scan();
    expect(result.candidates.map((c) => c.relativePath)).toEqual(["a.pdf", "sub/link.pdf"]);
    expect(result.candidates[1].sidecarPath).toBe(path.join(root, "sub", ".link.data"));
    expect(result.errors).toEqual([]);
  });

  it("a pdf reached twice whose sidecars are the same real file is a candidate once", async () => {
    put("a.pdf");
    put(".a.data");
    fs.symlinkSync("a.pdf", path.join(root, "b.pdf"));
    fs.symlinkSync(".a.data", path.join(root, ".b.data"));
    const result = await scan();
    expect(result.candidates.map((c) => c.relativePath)).toEqual(["a.pdf"]);
    expect(result.errors).toEqual([]);
  });

  it("a root that cannot be listed is an error with relativePath '.'", async () => {
    const result = await scanMigrationCandidates(path.join(base, "missing"));
    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([{ relativePath: ".", kind: "folder", message: expect.any(String) }]);
  });
});
