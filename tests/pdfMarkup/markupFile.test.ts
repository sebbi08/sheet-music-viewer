import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SMV_CATALOG_KEY } from "../../src/models/markupConstants";
import { reserveObjectNumbers, writeIncrementalUpdate } from "../../src/pdfMarkup/incrementalWriter";
import { buildMarkedPdf } from "../../src/pdfMarkup/buildMarkedPdf";
import {
  discardEmptyLegacySidecar,
  getSidecarPath,
  legacySidecarHasMarkup,
  loadMarkupFromFile,
  saveMarkupToFile,
  setLockRetryDelays,
} from "../../src/pdfMarkup/markupFile";
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
const pngOf = (change: { pngBase64: string }) => new Uint8Array(Buffer.from(change.pngBase64, "base64"));
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
    expect(await loadMarkupFromFile(pdf)).toEqual({ source: "none", pages: [], legacyOverlayData: null, pdfIssue: null });
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
    expect(await loadMarkupFromFile(pdf)).toEqual({ source: "none", pages: [], legacyOverlayData: legacy, pdfIssue: null });

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

  test("a corrupt legacy sidecar does not block saving into a writable PDF and stays untouched", async () => {
    const pdf = await writeFixture(dir, "c.pdf", await makePdf({ xref: "table", pages: 2 }));
    const corrupt = '[{"page": 1, "data": {"objects": [ broken';
    fs.writeFileSync(getSidecarPath(pdf), corrupt);
    expect(await loadMarkupFromFile(pdf)).toEqual({ source: "none", pages: [], legacyOverlayData: corrupt, pdfIssue: null });

    // The renderer keeps deleteLegacySidecar false for a file it could not read.
    expect(await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false })).toEqual({
      status: "pdf",
    });
    expect(fs.readFileSync(getSidecarPath(pdf), "utf8")).toBe(corrupt);

    // Embedded data wins from now on; the corrupt file is no longer reported.
    expect(await loadMarkupFromFile(pdf)).toMatchObject({ source: "pdf", legacyOverlayData: null, pages: [{ page: 2 }] });
    // Removing all markup restores the original PDF, so the untouched corrupt file is reported again.
    expect(
      (await saveMarkupToFile({ path: pdf, pages: [{ page: 2, payload: null, pngBase64: null }], deleteLegacySidecar: false }))
        .status,
    ).toBe("pdf");
    expect(await loadMarkupFromFile(pdf)).toEqual({ source: "none", pages: [], legacyOverlayData: corrupt, pdfIssue: null });
    expect(fs.readFileSync(getSidecarPath(pdf), "utf8")).toBe(corrupt);
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
    expect(await loadMarkupFromFile(pdf)).toEqual({ source: "none", pages: [], legacyOverlayData: "[]", pdfIssue: "encrypted" });
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

  describe("locked files (Windows: another program has the PDF open)", () => {
    const locked = (code = "EBUSY") => Object.assign(new Error(`${code}: resource busy or locked`), { code });
    let previousDelays: readonly number[];
    beforeEach(() => {
      previousDelays = setLockRetryDelays([1, 1, 1, 1, 1]);
    });
    afterEach(() => {
      setLockRetryDelays(previousDelays);
    });

    test("the default retries take about 3 s in total", () => {
      const sum = previousDelays.reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThanOrEqual(2500);
      expect(sum).toBeLessThanOrEqual(3500);
    });

    test("a rename that fails twice (EBUSY, EPERM) is retried and the save succeeds", async () => {
      const pdf = await writeFixture(dir, "b.pdf", await makePdf({ xref: "stream", pages: 2 }));
      await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
      const rename = vi
        .spyOn(fs.promises, "rename")
        .mockRejectedValueOnce(locked("EBUSY"))
        .mockRejectedValueOnce(locked("EPERM"));

      expect(await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false })).toEqual({
        status: "pdf",
      });
      expect(rename).toHaveBeenCalledTimes(3);
      expect((await loadMarkupFromFile(pdf)).pages.map((p) => p.page)).toEqual([1, 2]);
      expect(tempFiles(dir)).toEqual([]);
    });

    test("opening the temp file is retried while it is locked (EACCES)", async () => {
      const pdf = await writeFixture(dir, "t.pdf", await makePdf({ xref: "table" }));
      const open = vi.spyOn(fs.promises, "open").mockRejectedValueOnce(locked("EACCES"));
      expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).status).toBe("pdf");
      expect(open).toHaveBeenCalledTimes(2);
    });

    test("a PDF with embedded data that stays locked: error, PDF unchanged, no temp, no sidecar", async () => {
      const pdf = await writeFixture(dir, "e.pdf", await makePdf({ xref: "stream", pages: 2 }));
      await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
      const before = fs.readFileSync(pdf);
      const rename = vi.spyOn(fs.promises, "rename").mockRejectedValue(locked());

      const result = await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false });
      expect(result.status).toBe("error");
      expect(result.message).toContain("EBUSY");
      expect(rename).toHaveBeenCalledTimes(6); // first attempt + 5 retries
      expect(fs.readFileSync(pdf).equals(before)).toBe(true);
      expect(tempFiles(dir)).toEqual([]);
      expect(fs.existsSync(getSidecarPath(pdf))).toBe(false);

      // Unlocked again: the next save works.
      rename.mockRestore();
      expect((await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false })).status).toBe("pdf");
      expect((await loadMarkupFromFile(pdf)).pages.map((p) => p.page)).toEqual([1, 2]);
    });

    test("a PDF without embedded data that stays locked falls back to the sidecar, PDF unchanged", async () => {
      const pdf = await writeFixture(dir, "n.pdf", await makePdf({ xref: "table" }));
      const before = fs.readFileSync(pdf);
      const realRename = fs.promises.rename.bind(fs.promises);
      // Only the PDF is locked; the sidecar can be written.
      vi.spyOn(fs.promises, "rename").mockImplementation((from, to) =>
        String(to) === pdf ? Promise.reject(locked("EPERM")) : realRename(from, to),
      );

      expect(await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).toEqual({
        status: "sidecar",
        reason: "locked",
      });
      expect(fs.readFileSync(pdf).equals(before)).toBe(true);
      expect(tempFiles(dir)).toEqual([]);
      expect(await loadMarkupFromFile(pdf)).toMatchObject({ source: "sidecar", pages: [{ page: 1, payload: payload(1) }] });
    });

    test("other errors are not retried", async () => {
      const pdf = await writeFixture(dir, "x.pdf", await makePdf({ xref: "table", pages: 2 }));
      await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
      const rename = vi.spyOn(fs.promises, "rename").mockRejectedValue(locked("EIO"));
      expect((await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false })).status).toBe("error");
      expect(rename).toHaveBeenCalledTimes(1);
    });
  });

  test("the read-back verification compares the data of every page, not only the page set", async () => {
    const pdf = await writeFixture(dir, "h.pdf", await makePdf({ xref: "table", pages: 2 }));
    await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
    const before = fs.readFileSync(pdf);
    // The temp file reads back with the right pages, but page 2 has other data than the one saved.
    const wrong = await buildMarkedPdf(new Uint8Array(before), [{ page: 2, payload: payload(7), png: pngOf(page2()) }]);
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    vi.spyOn(fs.promises, "readFile").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) =>
      String(file).endsWith(".smv-tmp")
        ? Promise.resolve(Buffer.from(wrong))
        : (realReadFile as (...args: unknown[]) => Promise<Buffer>)(file, ...rest)) as typeof fs.promises.readFile);

    const result = await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false });
    expect(result.status).toBe("error");
    expect(result.message).toContain("pages [2]");
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    expect(tempFiles(dir)).toEqual([]);
  });

  test("the read-back verification ignores key order and unknown keys of the saved payload", async () => {
    const pdf = await writeFixture(dir, "k.pdf", await makePdf({ xref: "table" }));
    const { version, width, height, fabric } = payload(3);
    const reordered = { fabric, height, width, version, unknownKey: true } as unknown as ReturnType<typeof payload>;
    expect(
      (await saveMarkupToFile({ path: pdf, pages: [{ ...page1(), payload: reordered }], deleteLegacySidecar: false })).status,
    ).toBe("pdf");
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

  test("orphan repair does not hide a v1 sidecar of a PDF without data", async () => {
    const pdf = await writeFixture(dir, "s.pdf", await makePdf({ xref: "table", pages: 2 }));
    await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
    // Another program dropped our data and our catalog metadata: only an orphan is left.
    const stripped = await stripSmvData(fs.readFileSync(pdf));
    const doc = await PDFDocument.load(stripped, { updateMetadata: false });
    reserveObjectNumbers(stripped, doc.context);
    doc.catalog.delete(PDFName.of(SMV_CATALOG_KEY));
    fs.writeFileSync(pdf, writeIncrementalUpdate(stripped, doc.context, [doc.context.trailerInfo.Root as PDFRef]).bytes);
    expect(await readMarkupOf(pdf)).toMatchObject({ pages: [], meta: null, orphans: [{ page: 1 }] });
    fs.writeFileSync(getSidecarPath(pdf), JSON.stringify({ version: 1, pages: [{ page: 2, payload: payload(2) }] }));

    expect(await loadMarkupFromFile(pdf)).toEqual({
      source: "sidecar",
      pages: [{ page: 2, rect: null, payload: payload(2) }],
      legacyOverlayData: null,
      pdfIssue: null,
    });
    expect((await readMarkupOf(pdf)).orphans).toEqual([]); // repaired nevertheless
  });

  test("a PDF pdf-lib cannot parse falls back to the sidecar and stays unchanged", async () => {
    const pdf = await writeFixture(dir, "g.pdf", new Uint8Array(Buffer.from("%PDF-1.4\n%garbage, no objects\n")));
    const before = fs.readFileSync(pdf);
    expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).status).toBe(
      "sidecar",
    );
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    expect(await loadMarkupFromFile(pdf)).toMatchObject({ source: "sidecar", pages: [{ page: 1, rect: null }] });
    expect(tempFiles(dir)).toEqual([]);
  });

  describe("legacy sidecar in the sidecar fallback", () => {
    const legacy = JSON.stringify([{ page: 1, data: { objects: [] }, drawWidth: 100, drawHeight: 140 }]);

    test("encrypted PDF: an unmigrated legacy sidecar is left untouched and the save fails", async () => {
      const pdf = await writeFixture(dir, "le.pdf", markEncrypted(await makePdf({ xref: "table" })));
      fs.writeFileSync(getSidecarPath(pdf), legacy);
      for (const pages of [[page1()], [{ page: 1, payload: null, pngBase64: null }]]) {
        const result = await saveMarkupToFile({ path: pdf, pages, deleteLegacySidecar: false });
        expect(result.status).toBe("error");
        expect(result.message).toBeTruthy();
        expect(fs.readFileSync(getSidecarPath(pdf), "utf8")).toBe(legacy);
      }
      expect(tempFiles(dir)).toEqual([]);
    });

    test.skipIf(isRoot)("read-only PDF: an unmigrated legacy sidecar is left untouched (skipped as root)", async () => {
      const pdf = await writeFixture(dir, "lr.pdf", await makePdf({ xref: "table" }));
      fs.writeFileSync(getSidecarPath(pdf), legacy);
      fs.chmodSync(pdf, 0o444);
      const before = fs.readFileSync(pdf);
      expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).status).toBe(
        "error",
      );
      expect(fs.readFileSync(getSidecarPath(pdf), "utf8")).toBe(legacy);
      expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    });

    test("with deleteLegacySidecar the legacy sidecar is replaced by a v1 sidecar", async () => {
      const pdf = await writeFixture(dir, "lm.pdf", markEncrypted(await makePdf({ xref: "table" })));
      fs.writeFileSync(getSidecarPath(pdf), legacy);
      expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: true })).status).toBe(
        "sidecar",
      );
      expect(JSON.parse(fs.readFileSync(getSidecarPath(pdf), "utf8"))).toEqual({
        version: 1,
        pages: [{ page: 1, payload: payload(1) }],
      });
      expect(await loadMarkupFromFile(pdf)).toMatchObject({ source: "sidecar", legacyOverlayData: null });
    });
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

describe("a v1 sidecar written earlier in the same visit (B1)", () => {
  const lockedError = () => Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
  let previousDelays: readonly number[];
  beforeEach(() => {
    previousDelays = setLockRetryDelays([]);
  });
  afterEach(() => {
    setLockRetryDelays(previousDelays);
  });

  /** Like Acrobat holding the PDF open: renaming onto the PDF fails, everything else works. */
  function lockPdf(pdf: string) {
    const realRename = fs.promises.rename.bind(fs.promises);
    return vi
      .spyOn(fs.promises, "rename")
      .mockImplementation((from, to) => (String(to) === pdf ? Promise.reject(lockedError()) : realRename(from, to)));
  }

  /** Unlocked again: a later save without the migration flag keeps writing the sidecar; the migration moves all. */
  async function expectSidecarKeptThenMigrated(pdf: string, before: Buffer) {
    expect(await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false })).toEqual({
      status: "sidecar",
      reason: "other",
    });
    expect(fs.readFileSync(pdf).equals(before), "no partial PDF next to the sidecar").toBe(true);
    expect(await loadMarkupFromFile(pdf)).toEqual({
      source: "sidecar",
      pages: [
        { page: 1, rect: null, payload: payload(1) },
        { page: 2, rect: null, payload: payload(2) },
      ],
      legacyOverlayData: null,
      pdfIssue: null,
    });

    // The renderer's migrating write: every page of the sidecar, with deleteLegacySidecar.
    expect(await saveMarkupToFile({ path: pdf, pages: [page1(), page2()], deleteLegacySidecar: true })).toEqual({
      status: "pdf",
    });
    const loaded = await loadMarkupFromFile(pdf);
    expect({ source: loaded.source, pages: loaded.pages.map((p) => [p.page, p.payload]) }).toEqual({
      source: "pdf",
      pages: [
        [1, payload(1)],
        [2, payload(2)],
      ],
    });
    expect(fs.existsSync(getSidecarPath(pdf)), "sidecar removed after the migration").toBe(false);
    expect(fs.readFileSync(pdf).subarray(0, before.length).equals(before), "original bytes kept as prefix").toBe(true);
    expect(tempFiles(dir)).toEqual([]);
  }

  test("locked PDF -> sidecar for page 1; unlocked, page 2 saved: nothing becomes invisible", async () => {
    const pdf = await writeFixture(dir, "n.pdf", await makePdf({ xref: "table", pages: 2 }));
    const before = fs.readFileSync(pdf);
    const lock = lockPdf(pdf);
    expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).status).toBe(
      "sidecar",
    );
    lock.mockRestore();
    await expectSidecarKeptThenMigrated(pdf, before);
  });

  test.skipIf(isRoot)("read-only PDF -> sidecar; writable again later in the visit (skipped as root)", async () => {
    const pdf = await writeFixture(dir, "ro.pdf", await makePdf({ xref: "table", pages: 2 }));
    const before = fs.readFileSync(pdf);
    fs.chmodSync(pdf, 0o444);
    expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).status).toBe(
      "sidecar",
    );
    fs.chmodSync(pdf, 0o644);
    await expectSidecarKeptThenMigrated(pdf, before);
  });

  test("a migrating write that misses a sidecar page keeps writing the sidecar (nothing deleted)", async () => {
    const pdf = await writeFixture(dir, "p.pdf", await makePdf({ xref: "table", pages: 2 }));
    const before = fs.readFileSync(pdf);
    fs.writeFileSync(getSidecarPath(pdf), JSON.stringify({ version: 1, pages: [{ page: 1, payload: payload(1) }] }));
    expect(await saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: true })).toEqual({
      status: "sidecar",
      reason: "other",
    });
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    expect((await loadMarkupFromFile(pdf)).pages.map((p) => p.page)).toEqual([1, 2]);
  });

  test("a migrating write may remove a sidecar page with payload null", async () => {
    const pdf = await writeFixture(dir, "q.pdf", await makePdf({ xref: "table", pages: 2 }));
    fs.writeFileSync(
      getSidecarPath(pdf),
      JSON.stringify({ version: 1, pages: [1, 2].map((page) => ({ page, payload: payload(page) })) }),
    );
    const result = await saveMarkupToFile({
      path: pdf,
      pages: [{ page: 1, payload: null, pngBase64: null }, page2()],
      deleteLegacySidecar: true,
    });
    expect(result).toEqual({ status: "pdf" });
    expect(fs.existsSync(getSidecarPath(pdf))).toBe(false);
    expect((await loadMarkupFromFile(pdf)).pages.map((p) => p.page)).toEqual([2]);
  });

  test("still locked during the migrating write: everything stays in the sidecar", async () => {
    const pdf = await writeFixture(dir, "l.pdf", await makePdf({ xref: "table", pages: 2 }));
    const before = fs.readFileSync(pdf);
    fs.writeFileSync(getSidecarPath(pdf), JSON.stringify({ version: 1, pages: [{ page: 1, payload: payload(1) }] }));
    lockPdf(pdf);
    expect(await saveMarkupToFile({ path: pdf, pages: [page1(), page2()], deleteLegacySidecar: true })).toEqual({
      status: "sidecar",
      reason: "locked",
    });
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    expect((await loadMarkupFromFile(pdf)).pages.map((p) => p.page)).toEqual([1, 2]);
  });
});

describe("failure reasons and pdfIssue", () => {
  const save = (pdf: string) => saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
  const locked = () => Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
  let previousDelays: readonly number[];
  beforeEach(() => {
    previousDelays = setLockRetryDelays([]);
  });
  afterEach(() => {
    setLockRetryDelays(previousDelays);
  });

  test.skipIf(isRoot)("reports readOnly when a pdf without data is not writable (skipped as root)", async () => {
    const pdf = await writeFixture(dir, "ro.pdf", await makePdf({ xref: "table" }));
    fs.chmodSync(pdf, 0o444);
    expect(await save(pdf)).toEqual({ status: "sidecar", reason: "readOnly" });
  });

  test("reports encrypted", async () => {
    const pdf = await writeFixture(dir, "e.pdf", markEncrypted(await makePdf({ xref: "table" })));
    expect(await save(pdf)).toEqual({ status: "sidecar", reason: "encrypted" });
  });

  test("reports unparseable", async () => {
    const pdf = await writeFixture(dir, "g.pdf", new Uint8Array(Buffer.from("this is not a pdf at all")));
    expect(await save(pdf)).toEqual({ status: "sidecar", reason: "unparseable" });
  });

  test("reports locked when the pdf stays locked", async () => {
    const realRename = fs.promises.rename.bind(fs.promises);
    const lockPdf = (pdf: string) =>
      vi
        .spyOn(fs.promises, "rename")
        .mockImplementation((from, to) => (String(to) === pdf ? Promise.reject(locked()) : realRename(from, to)));

    const plain = await writeFixture(dir, "n.pdf", await makePdf({ xref: "table" }));
    lockPdf(plain);
    expect(await save(plain)).toEqual({ status: "sidecar", reason: "locked" });
    vi.restoreAllMocks();

    const embedded = await writeFixture(dir, "m.pdf", await makePdf({ xref: "table", pages: 2 }));
    await save(embedded);
    lockPdf(embedded);
    const result = await saveMarkupToFile({ path: embedded, pages: [page2()], deleteLegacySidecar: false });
    expect(result).toMatchObject({ status: "error", reason: "locked" });
  });

  test("reports other for unexpected errors", async () => {
    const pdf = await writeFixture(dir, "x.pdf", await makePdf({ xref: "table" }));
    vi.spyOn(fs.promises, "rename").mockRejectedValue(Object.assign(new Error("EIO"), { code: "EIO" }));
    expect(await save(pdf)).toMatchObject({ status: "error", reason: "other" });
  });

  test("load reports pdfIssue", async () => {
    const enc = await writeFixture(dir, "e.pdf", markEncrypted(await makePdf({ xref: "table" })));
    const bad = await writeFixture(dir, "g.pdf", new Uint8Array(Buffer.from("this is not a pdf at all")));
    const ok = await writeFixture(dir, "o.pdf", await makePdf({ xref: "table" }));
    expect((await loadMarkupFromFile(enc)).pdfIssue).toBe("encrypted");
    expect((await loadMarkupFromFile(bad)).pdfIssue).toBe("unparseable");
    expect((await loadMarkupFromFile(ok)).pdfIssue).toBeNull();
  });
});

describe("legacySidecarHasMarkup", () => {
  test.each(["", "  ", "[]", '[{"page":1,"data":{"objects":[]}}]'])("%j has no markup", (text) => {
    expect(legacySidecarHasMarkup(text)).toBe(false);
  });

  test("an entry with an object has markup", () => {
    expect(legacySidecarHasMarkup('[{"page":1,"data":{"objects":[{"type":"path"}]}}]')).toBe(true);
  });

  test("unreadable text counts as markup", () => {
    expect(legacySidecarHasMarkup("{not json")).toBe(true);
    expect(legacySidecarHasMarkup('{"a":1}')).toBe(true);
  });

  test("a v1 sidecar with pages has markup", () => {
    const v1 = JSON.stringify({ version: 1, pages: [{ page: 1, payload: payload(1) }] });
    expect(legacySidecarHasMarkup(v1)).toBe(true);
  });
});

describe("discardEmptyLegacySidecar", () => {
  test("deletes an empty sidecar and leaves the pdf byte-identical", async () => {
    const pdf = await writeFixture(dir, "a.pdf", await makePdf({ xref: "table" }));
    const before = fs.readFileSync(pdf);
    fs.writeFileSync(getSidecarPath(pdf), '[{"page":1,"data":{"objects":[]}}]');
    expect(await discardEmptyLegacySidecar(pdf)).toEqual({ deleted: true });
    expect(fs.existsSync(getSidecarPath(pdf))).toBe(false);
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
  });

  test("keeps a sidecar with markup", async () => {
    const pdf = await writeFixture(dir, "b.pdf", await makePdf({ xref: "table" }));
    const text = '[{"page":1,"data":{"objects":[{"type":"path"}]}}]';
    fs.writeFileSync(getSidecarPath(pdf), text);
    expect(await discardEmptyLegacySidecar(pdf)).toEqual({ deleted: false });
    expect(fs.readFileSync(getSidecarPath(pdf), "utf8")).toBe(text);
  });

  test("missing sidecar", async () => {
    const pdf = await writeFixture(dir, "c.pdf", await makePdf({ xref: "table" }));
    expect(await discardEmptyLegacySidecar(pdf)).toEqual({ deleted: false });
  });
});
