import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getSidecarPath, loadMarkupFromFile, saveMarkupToFile } from "../../src/pdfMarkup/markupFile";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import {
  annotationsPerPage,
  makePdf,
  markEncrypted,
  page1,
  page2,
  payload,
  stripSmvData,
  writeFixture,
} from "./fixtures";

const readMarkupOf = async (file: string) =>
  readMarkup(await PDFDocument.load(fs.readFileSync(file), { updateMetadata: false }));
const tempFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.includes("smv-tmp"));
/** chmod-based read-only tests do not work as root (root ignores permission bits). */
const isRoot = process.getuid?.() === 0;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-markup-file-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o644);
  fs.chmodSync(dir, 0o755);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("getSidecarPath", () => {
  test("uses the legacy .<name>.data naming", () => {
    expect(getSidecarPath(path.join("/x", "Song.pdf"))).toBe(path.join("/x", ".Song.data"));
  });
});

describe("saveMarkupToFile / loadMarkupFromFile", () => {
  test("saves into the PDF atomically", async () => {
    const pdf = await writeFixture(dir, "a.pdf", await makePdf({ xref: "stream" }));
    expect(await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).toEqual({
      status: "pdf",
    });
    const loaded = await loadMarkupFromFile(pdf);
    expect(loaded.pages).toHaveLength(1);
    expect(loaded).toMatchObject({ source: "pdf", legacyOverlayData: null, pages: [{ page: 1, payload: payload(1) }] });
    expect(loaded.pages[0].rect).toHaveLength(4);
    expect(tempFiles(dir)).toEqual([]);
  });

  test("a PDF without markup or sidecar loads as source none", async () => {
    const pdf = await writeFixture(dir, "n.pdf", await makePdf({ xref: "table" }));
    expect(await loadMarkupFromFile(pdf)).toEqual({ source: "none", pages: [], legacyOverlayData: null });
  });

  test("accepts a data-URL PNG", async () => {
    const pdf = await writeFixture(dir, "u.pdf", await makePdf({ xref: "table" }));
    const p = { ...page1(), pngBase64: `data:image/png;base64,${page1().pngBase64}` };
    expect(await saveMarkupToFile({ path: pdf, pages: [p], deleteLegacySidecar: false })).toEqual({ status: "pdf" });
  });

  test("legacy sidecar is reported and deleted only after a successful PDF save", async () => {
    const pdf = await writeFixture(dir, "a.pdf", await makePdf({ xref: "table" }));
    const legacy = JSON.stringify([{ page: 1, data: { objects: [] }, drawWidth: 100, drawHeight: 140 }]);
    fs.writeFileSync(getSidecarPath(pdf), legacy);
    expect(await loadMarkupFromFile(pdf)).toEqual({ source: "none", pages: [], legacyOverlayData: legacy });

    // A failed save (page does not exist) keeps the legacy file.
    const failed = await saveMarkupToFile({
      path: pdf,
      pages: [{ ...page1(), page: 5 }],
      deleteLegacySidecar: true,
    });
    expect(failed.status).toBe("error");
    expect(fs.existsSync(getSidecarPath(pdf))).toBe(true);

    await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: true });
    expect(fs.existsSync(getSidecarPath(pdf))).toBe(false);
  });

  test("embedded data wins over a sidecar", async () => {
    const pdf = await writeFixture(dir, "w.pdf", await makePdf({ xref: "table", pages: 2 }));
    expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).status).toBe("pdf");
    const sidecar = JSON.stringify({ version: 1, pages: [{ page: 2, payload: payload(9) }] });
    fs.writeFileSync(getSidecarPath(pdf), sidecar);

    const loaded = await loadMarkupFromFile(pdf);
    expect(loaded.source).toBe("pdf");
    expect(loaded.pages.map((p) => p.page)).toEqual([1]);
    expect(loaded.legacyOverlayData).toBeNull();
    expect(fs.readFileSync(getSidecarPath(pdf), "utf8")).toBe(sidecar); // left in place
  });

  test("encrypted PDF falls back to a v1 sidecar", async () => {
    const pdf = await writeFixture(dir, "e.pdf", markEncrypted(await makePdf({ xref: "table" })));
    const before = fs.readFileSync(pdf);
    expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).status).toBe(
      "sidecar",
    );
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    expect(await loadMarkupFromFile(pdf)).toMatchObject({ source: "sidecar", pages: [{ page: 1, rect: null }] });
    expect(tempFiles(dir)).toEqual([]);
  });

  test("the sidecar fallback merges pages and removes pages saved with payload null", async () => {
    const pdf = await writeFixture(dir, "m.pdf", markEncrypted(await makePdf({ xref: "table", pages: 2 })));
    await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
    await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false });
    expect((await loadMarkupFromFile(pdf)).pages).toEqual([
      { page: 1, rect: null, payload: payload(1) },
      { page: 2, rect: null, payload: payload(2) },
    ]);

    const removed = await saveMarkupToFile({
      path: pdf,
      pages: [{ page: 1, payload: null, pngBase64: null }],
      deleteLegacySidecar: false,
    });
    expect(removed.status).toBe("sidecar");
    expect(JSON.parse(fs.readFileSync(getSidecarPath(pdf), "utf8"))).toEqual({
      version: 1,
      pages: [{ page: 2, payload: payload(2) }],
    });
  });

  test("an encrypted PDF with a legacy sidecar reports the legacy data", async () => {
    const pdf = await writeFixture(dir, "l.pdf", markEncrypted(await makePdf({ xref: "table" })));
    fs.writeFileSync(getSidecarPath(pdf), "[]");
    expect(await loadMarkupFromFile(pdf)).toEqual({ source: "none", pages: [], legacyOverlayData: "[]" });
  });

  test.skipIf(isRoot)("read-only PDF without embedded data falls back to a v1 sidecar (skipped as root)", async () => {
    const pdf = await writeFixture(dir, "ro.pdf", await makePdf({ xref: "table" }));
    fs.chmodSync(pdf, 0o444);
    const before = fs.readFileSync(pdf);
    expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).status).toBe(
      "sidecar",
    );
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    expect((await loadMarkupFromFile(pdf)).source).toBe("sidecar");
  });

  test.skipIf(isRoot)("read-only PDF with embedded data reports an error and stays unchanged (skipped as root)", async () => {
    const pdf = await writeFixture(dir, "r.pdf", await makePdf({ xref: "table" }));
    await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
    fs.chmodSync(pdf, 0o444);
    const before = fs.readFileSync(pdf);
    const result = await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
    expect(result.status).toBe("error");
    expect(result.message).toBeTruthy();
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    expect(fs.existsSync(getSidecarPath(pdf))).toBe(false);
  });

  test.skipIf(isRoot)("read-only folder with embedded data reports an error (skipped as root)", async () => {
    const pdf = await writeFixture(dir, "d.pdf", await makePdf({ xref: "table" }));
    await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
    fs.chmodSync(dir, 0o555);
    const before = fs.readFileSync(pdf);
    expect((await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false })).status).toBe("error");
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
  });

  test("rename failure (EBUSY) reports an error, PDF unchanged, no temp left", async () => {
    const pdf = await writeFixture(dir, "b.pdf", await makePdf({ xref: "stream", pages: 2 }));
    await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
    const before = fs.readFileSync(pdf);
    vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }));

    const result = await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false });
    expect(result.status).toBe("error");
    expect(result.message).toContain("busy");
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    expect(tempFiles(dir)).toEqual([]);
    expect(fs.existsSync(getSidecarPath(pdf))).toBe(false);

    // The next save works again.
    expect((await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false })).status).toBe("pdf");
    expect((await loadMarkupFromFile(pdf)).pages.map((p) => p.page)).toEqual([1, 2]);
  });

  test("a failed read-back verification reports an error, PDF unchanged, no temp left", async () => {
    const pdf = await writeFixture(dir, "v.pdf", await makePdf({ xref: "table" }));
    const before = fs.readFileSync(pdf);
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    // The temp file reads back as the unmarked original: the expected page 1 is missing.
    vi.spyOn(fs.promises, "readFile").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) =>
      String(file).endsWith(".smv-tmp")
        ? Promise.resolve(before)
        : (realReadFile as (...args: unknown[]) => Promise<Buffer>)(file, ...rest)) as typeof fs.promises.readFile);

    const result = await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
    expect(result.status).toBe("error");
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    expect(tempFiles(dir)).toEqual([]);
  });

  test("concurrent saves are serialized", async () => {
    const pdf = await writeFixture(dir, "c.pdf", await makePdf({ xref: "stream", pages: 2 }));
    await Promise.all([
      saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false }),
      saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false }),
    ]);
    expect((await loadMarkupFromFile(pdf)).pages.map((p) => p.page)).toEqual([1, 2]);
  });

  test("orphans are repaired on load", async () => {
    const pdf = await writeFixture(dir, "o.pdf", await makePdf({ xref: "table", pages: 2 }));
    await saveMarkupToFile({ path: pdf, pages: [page1(), page2()], deleteLegacySidecar: false });
    fs.writeFileSync(pdf, await stripSmvData(fs.readFileSync(pdf)));
    expect((await readMarkupOf(pdf)).orphans).toHaveLength(1);

    const loaded = await loadMarkupFromFile(pdf);
    expect(loaded.source).toBe("pdf");
    expect(loaded.pages.map((p) => p.page)).toEqual([2]);
    expect((await readMarkupOf(pdf)).orphans).toEqual([]);
    // The orphaned stamp is still in the file, as a foreign image.
    const annots = await annotationsPerPage(new Uint8Array(fs.readFileSync(pdf)));
    expect(annots[0]).toEqual([expect.objectContaining({ subtype: "Stamp", isOurs: false })]);
    expect(tempFiles(dir)).toEqual([]);
  });

  test("saves through a symlink keep the link", async () => {
    const real = await writeFixture(dir, "real.pdf", await makePdf({ xref: "table" }));
    const link = path.join(dir, "link.pdf");
    fs.symlinkSync(real, link);
    expect((await saveMarkupToFile({ path: link, pages: [page1()], deleteLegacySidecar: false })).status).toBe("pdf");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect((await readMarkupOf(real)).pages).toHaveLength(1);
  });
});
