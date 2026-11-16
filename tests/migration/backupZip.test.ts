import fs from "fs";
import os from "os";
import path from "path";
import { crc32 } from "zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yauzl from "yauzl";
import { createBackupZip, verifyBackupZip } from "../../src/migration/backupZip";
import type { MigrationCandidate } from "../../src/migration/types";

let root: string;
const NOW = new Date(2026, 10, 16, 10, 15, 42);

const put = (rel: string, content: string | Buffer) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const cand = (pdfRel: string, sidecarName: string): MigrationCandidate => ({
  pdfPath: path.join(root, pdfRel),
  sidecarPath: path.join(root, path.dirname(pdfRel), sidecarName),
  relativePath: pdfRel,
});
const leftovers = () => fs.readdirSync(root).filter((f) => f.includes("Markierungen-Backup"));

interface Entry {
  name: string;
  data: Buffer;
  method: number;
  flags: number;
}
const readZip = (zipPath: string) =>
  new Promise<Entry[]>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const out: Entry[] = [];
      zip.on("error", reject);
      zip.on("end", () => resolve(out));
      zip.on("entry", (e: yauzl.Entry) => {
        zip.openReadStream(e, (err2, stream) => {
          if (err2) return reject(err2);
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            out.push({
              name: e.fileName,
              data: Buffer.concat(chunks),
              method: e.compressionMethod,
              flags: e.generalPurposeBitFlag,
            });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "smv-zip-"));
});
afterEach(() => {
  fs.chmodSync(root, 0o755);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("createBackupZip", () => {
  it("zip contains every pdf and sidecar byte-identical under its relative path", async () => {
    const pdf = Buffer.from([0, 1, 2, 255, 254, 37, 80, 68, 70]);
    put("Böhmisch/Böhmischer traum.pdf", pdf);
    put("Böhmisch/.Böhmischer traum.data", "sidecar-é");
    put("a.pdf", "A");
    put(".a.data", "a-data");
    const r = await createBackupZip(
      root,
      [cand("Böhmisch/Böhmischer traum.pdf", ".Böhmischer traum.data"), cand("a.pdf", ".a.data")],
      { now: NOW },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok" || !r.zipPath) throw new Error("no zip");
    expect(r.included).toHaveLength(2);
    expect(r.excluded).toEqual([]);
    const entries = await readZip(r.zipPath);
    const byName = new Map(entries.map((e) => [e.name, e]));
    expect([...byName.keys()].sort()).toEqual(
      [".a.data", "Böhmisch/.Böhmischer traum.data", "Böhmisch/Böhmischer traum.pdf", "a.pdf"].sort(),
    );
    expect(byName.get("Böhmisch/Böhmischer traum.pdf")!.data.equals(pdf)).toBe(true);
    expect(byName.get("Böhmisch/.Böhmischer traum.data")!.data.toString()).toBe("sidecar-é");
    expect(byName.get("Böhmisch/Böhmischer traum.pdf")!.flags & 0x800).toBe(0x800);
    expect(leftovers()).toEqual(["Markierungen-Backup 2026-11-16 10-15.zip"]);
  });

  it("pdf entries are stored, not deflated", async () => {
    put("a.pdf", "A".repeat(5000));
    put(".a.data", "B".repeat(5000));
    const r = await createBackupZip(root, [cand("a.pdf", ".a.data")], { now: NOW });
    if (r.status !== "ok" || !r.zipPath) throw new Error("no zip");
    const e = Object.fromEntries((await readZip(r.zipPath)).map((x) => [x.name, x.method]));
    expect(e["a.pdf"]).toBe(0);
  });

  it("names the zip Markierungen-Backup 2026-11-16 10-15.zip", async () => {
    put("a.pdf", "A");
    put(".a.data", "d");
    const r = await createBackupZip(root, [cand("a.pdf", ".a.data")], { now: NOW });
    expect(r.status === "ok" && r.zipPath).toBe(path.join(root, "Markierungen-Backup 2026-11-16 10-15.zip"));
  });

  it("adds (2) on a name collision", async () => {
    put("a.pdf", "A");
    put(".a.data", "d");
    put("Markierungen-Backup 2026-11-16 10-15.zip", "existing");
    const r = await createBackupZip(root, [cand("a.pdf", ".a.data")], { now: NOW });
    expect(r.status === "ok" && r.zipPath).toBe(path.join(root, "Markierungen-Backup 2026-11-16 10-15 (2).zip"));
    expect(fs.readFileSync(path.join(root, "Markierungen-Backup 2026-11-16 10-15.zip"), "utf8")).toBe("existing");
  });

  it.skipIf(process.getuid?.() === 0)("excludes a file that cannot be read and still zips the rest", async () => {
    put("a.pdf", "A");
    put(".a.data", "d");
    put("b.pdf", "B");
    put(".b.data", "d2");
    fs.chmodSync(path.join(root, ".b.data"), 0o000);
    const a = cand("a.pdf", ".a.data");
    const b = cand("b.pdf", ".b.data");
    const r = await createBackupZip(root, [a, b], { now: NOW });
    if (r.status !== "ok" || !r.zipPath) throw new Error("no zip");
    expect(r.included).toEqual([a]);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0].candidate).toBe(b);
    expect(r.excluded[0].message).toMatch(/EACCES/);
    expect((await readZip(r.zipPath)).map((e) => e.name).sort()).toEqual([".a.data", "a.pdf"]);
  });

  it("excludes a file that vanished", async () => {
    put("a.pdf", "A");
    put(".a.data", "d");
    put(".gone.data", "d");
    const gone = cand("gone.pdf", ".gone.data");
    const a = cand("a.pdf", ".a.data");
    const r = await createBackupZip(root, [gone, a], { now: NOW });
    if (r.status !== "ok") throw new Error("not ok");
    expect(r.included).toEqual([a]);
    expect(r.excluded.map((x) => x.candidate)).toEqual([gone]);
    expect(r.excluded[0].message).toMatch(/ENOENT/);
  });

  it("creates no file when everything is excluded", async () => {
    const r = await createBackupZip(root, [cand("gone.pdf", ".gone.data")], { now: NOW });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.zipPath).toBeNull();
    expect(r.included).toEqual([]);
    expect(leftovers()).toEqual([]);
  });

  it("verification detects a corrupted zip", async () => {
    put("a.pdf", "A".repeat(100));
    put(".a.data", "d".repeat(100));
    const r = await createBackupZip(root, [cand("a.pdf", ".a.data")], { now: NOW });
    if (r.status !== "ok" || !r.zipPath) throw new Error("no zip");
    const expected = [
      { name: "a.pdf", size: 100, crc: crc32(Buffer.from("A".repeat(100))) },
      { name: ".a.data", size: 100, crc: crc32(Buffer.from("d".repeat(100))) },
    ];
    await expect(verifyBackupZip(r.zipPath, expected)).resolves.toBeUndefined();
    const bytes = fs.readFileSync(r.zipPath);
    const at = bytes.indexOf("AAAA");
    bytes[at + 10] = 0x42;
    fs.writeFileSync(r.zipPath, bytes);
    await expect(verifyBackupZip(r.zipPath, expected)).rejects.toThrow();
  });

  it.skipIf(process.getuid?.() === 0)("on a write error no zip and no temp file remain", async () => {
    put("a.pdf", "A");
    put(".a.data", "d");
    fs.chmodSync(root, 0o555);
    const r = await createBackupZip(root, [cand("a.pdf", ".a.data")], { now: NOW });
    expect(r.status).toBe("error");
    expect(leftovers()).toEqual([]);
  });

  it("cancelled via signal leaves no files", async () => {
    put("a.pdf", "A");
    put(".a.data", "d");
    const ac = new AbortController();
    ac.abort();
    const r = await createBackupZip(root, [cand("a.pdf", ".a.data")], { now: NOW, signal: ac.signal });
    expect(r).toEqual({ status: "cancelled" });
    expect(leftovers()).toEqual([]);
  });

  it("cancelled during progress leaves no files", async () => {
    put("a.pdf", "A");
    put(".a.data", "d");
    const ac = new AbortController();
    const r = await createBackupZip(root, [cand("a.pdf", ".a.data")], {
      now: NOW,
      signal: ac.signal,
      onProgress: () => ac.abort(),
    });
    expect(r).toEqual({ status: "cancelled" });
    expect(leftovers()).toEqual([]);
  });

  it("removes stale temp files before writing", async () => {
    put("a.pdf", "A");
    put(".a.data", "d");
    put(".Markierungen-Backup-old1.zip.tmp", "junk");
    put("keep.txt", "k");
    const r = await createBackupZip(root, [cand("a.pdf", ".a.data")], { now: NOW });
    expect(r.status).toBe("ok");
    expect(fs.existsSync(path.join(root, ".Markierungen-Backup-old1.zip.tmp"))).toBe(false);
    expect(fs.existsSync(path.join(root, "keep.txt"))).toBe(true);
  });

  it("never loads a whole source file into memory", async () => {
    put("a.pdf", "A".repeat(1000));
    put(".a.data", "d");
    const readFile = vi.spyOn(fs.promises, "readFile");
    const readFileSync = vi.spyOn(fs, "readFileSync");
    try {
      const r = await createBackupZip(root, [cand("a.pdf", ".a.data")], { now: NOW });
      expect(r.status).toBe("ok");
      expect(readFile).not.toHaveBeenCalled();
      expect(readFileSync).not.toHaveBeenCalled();
    } finally {
      readFile.mockRestore();
      readFileSync.mockRestore();
    }
  });

  it("fails and leaves no files when a source changes after it was checksummed", async () => {
    put("a.pdf", "A".repeat(1000));
    put(".a.data", "d");
    const ac = new AbortController();
    const r = await createBackupZip(root, [cand("a.pdf", ".a.data")], {
      now: NOW,
      signal: ac.signal,
      onProgress: (p) => {
        // first progress call happens while checksumming; change the pdf behind our back
        if (p.doneBytes > 0 && fs.readFileSync(path.join(root, "a.pdf")).length === 1000) {
          fs.writeFileSync(path.join(root, "a.pdf"), "B".repeat(1000));
        }
      },
    });
    expect(r.status).toBe("error");
    expect(leftovers()).toEqual([]);
  });

  it("reports progress up to totalBytes", async () => {
    put("a.pdf", "AAAA");
    put(".a.data", "dd");
    put("b.pdf", "BBB");
    put(".b.data", "e");
    const calls: { doneBytes: number; totalBytes: number }[] = [];
    await createBackupZip(root, [cand("a.pdf", ".a.data"), cand("b.pdf", ".b.data")], {
      now: NOW,
      onProgress: (p) => calls.push(p),
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(new Set(calls.map((c) => c.totalBytes)).size).toBe(1);
    const total = calls[0].totalBytes;
    expect(calls[calls.length - 1].doneBytes).toBe(total);
    // advances during the checksum pass and the write, not only at the end
    expect(calls.filter((c) => c.doneBytes < total).length).toBeGreaterThan(2);
    const done = calls.map((c) => c.doneBytes);
    expect([...done].sort((x, y) => x - y)).toEqual(done);
  });

  describe("stopping mid-run", () => {
    const big = (rel: string, fill: number) => put(rel, Buffer.alloc(300_000, fill));
    const setup = () => {
      const cs: MigrationCandidate[] = [];
      for (let i = 0; i < 4; i++) {
        big(`s${i}.pdf`, 65 + i);
        big(`.s${i}.data`, 97 + i);
        cs.push(cand(`s${i}.pdf`, `.s${i}.data`));
      }
      return cs;
    };
    const settled = async (spy: { mock: { calls: unknown[] } }, progress: { n: number }) => {
      const reads = spy.mock.calls.length;
      const calls = progress.n;
      await new Promise((r) => setTimeout(r, 150));
      expect(spy.mock.calls.length).toBe(reads);
      expect(progress.n).toBe(calls);
      expect(leftovers()).toEqual([]);
    };

    it("cancelling during the write stops reading sources and leaves no files", async () => {
      const cs = setup();
      const ac = new AbortController();
      const progress = { n: 0 };
      const spy = vi.spyOn(fs, "createReadStream");
      try {
        const r = await createBackupZip(root, cs, {
          now: NOW,
          signal: ac.signal,
          onProgress: (p) => {
            progress.n++;
            if (p.doneBytes > p.totalBytes / 3 + 100_000) ac.abort();
          },
        });
        expect(r).toEqual({ status: "cancelled" });
        await settled(spy, progress);
      } finally {
        spy.mockRestore();
      }
    });

    it("a mid-stream write error stops everything and leaves no files", async () => {
      const cs = setup();
      const progress = { n: 0 };
      const readSpy = vi.spyOn(fs, "createReadStream");
      const origWrite = fs.createWriteStream;
      const writeSpy = vi.spyOn(fs, "createWriteStream").mockImplementation(((...args: Parameters<typeof origWrite>) => {
        const stream = origWrite(...args);
        const w = stream.write.bind(stream) as (...a: unknown[]) => boolean;
        let n = 0;
        (stream as unknown as { write: unknown }).write = (...a: unknown[]) => {
          if (++n === 5) {
            stream.destroy(new Error("disk full"));
            return false;
          }
          return w(...a);
        };
        return stream;
      }) as typeof fs.createWriteStream);
      try {
        const r = await createBackupZip(root, cs, {
          now: NOW,
          onProgress: () => progress.n++,
        });
        expect(r).toEqual({ status: "error", message: "disk full" });
        await settled(readSpy, progress);
      } finally {
        writeSpy.mockRestore();
        readSpy.mockRestore();
      }
    });

    it("cancelling during verification leaves no files", async () => {
      const cs = setup();
      const ac = new AbortController();
      const progress = { n: 0 };
      const spy = vi.spyOn(fs, "createReadStream");
      try {
        const r = await createBackupZip(root, cs, {
          now: NOW,
          signal: ac.signal,
          onProgress: (p) => {
            progress.n++;
            if (p.doneBytes > (p.totalBytes * 2) / 3 + 100_000) ac.abort();
          },
        });
        expect(r).toEqual({ status: "cancelled" });
        await settled(spy, progress);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
