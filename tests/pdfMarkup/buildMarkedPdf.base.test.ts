import fs from "node:fs";
import path from "node:path";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFString } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { ANNOT_NM, ORPHAN_NM } from "../../src/models/markupConstants";
import type { MarkupPayload } from "../../src/models/markup";
import { buildMarkedPdf, chooseBase, isOurUpdateLast } from "../../src/pdfMarkup/buildMarkedPdf";
import { findLastStartXref } from "../../src/pdfMarkup/fileStructure";
import { reserveObjectNumbers, writeIncrementalUpdate } from "../../src/pdfMarkup/incrementalWriter";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { corpusDir } from "../visual/corpus";
import {
  annotationsPerPage,
  appendForeignUpdate,
  countStartXref,
  makePdf,
  makePng,
  payload,
  stripSmvData,
} from "./fixtures";
import { inspectWithPdfjs, openWithPdfjs } from "./pdfjs";

const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false });
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const hasPrefix = (bytes: Uint8Array, prefix: Uint8Array) => same(bytes.subarray(0, prefix.length), prefix);
const mark = (page: number, p: MarkupPayload | null = payload()) => ({ page, payload: p, png: p ? makePng(8, 8) : null });

/** Subtypes of the annotations pdf.js sees on page 1. */
async function subtypes(bytes: Uint8Array): Promise<string[]> {
  const { value, recovered } = await inspectWithPdfjs(bytes, async (doc) =>
    ((await (await doc.getPage(1)).getAnnotations()) as { subtype: string }[]).map((a) => a.subtype),
  );
  expect(recovered).toBe(false);
  return value;
}

/** Changes objects of an existing PDF via an incremental update (like another program would). */
async function patch(base: Uint8Array, edit: (doc: PDFDocument) => PDFRef[]): Promise<Uint8Array> {
  const doc = await load(base);
  reserveObjectNumbers(base, doc.context);
  const before = doc.context.largestObjectNumber;
  const changed = edit(doc);
  const created = doc.context
    .enumerateIndirectObjects()
    .map(([ref]) => ref)
    .filter((ref) => ref.objectNumber > before);
  return writeIncrementalUpdate(base, doc.context, [...changed, ...created]).bytes;
}

test("repeated saves do not grow the file", async () => {
  const orig = await makePdf({ xref: "stream", pages: 2 });
  const a = await buildMarkedPdf(orig, [{ page: 1, payload: payload(1), png: makePng(8, 8) }]);
  const b = await buildMarkedPdf(a, [{ page: 1, payload: payload(1), png: makePng(8, 8) }]);
  expect(b.length).toBe(a.length);
  expect(countStartXref(b)).toBe(countStartXref(orig) + 1);
});

test("unchanged pages survive a replace", async () => {
  const a = await buildMarkedPdf(await makePdf({ xref: "table", pages: 2 }), [
    { page: 1, payload: payload(1), png: makePng(8, 8) },
  ]);
  const b = await buildMarkedPdf(a, [{ page: 2, payload: payload(2), png: makePng(8, 8) }]);
  const r = readMarkup(await PDFDocument.load(b, { updateMetadata: false }));
  expect(r.pages.map((p) => [p.page, p.payload.fabric.objects])).toEqual([
    [1, payload(1).fabric.objects],
    [2, payload(2).fabric.objects],
  ]);
});

test("removing everything restores the original bytes", async () => {
  const orig = await makePdf({ xref: "stream" });
  const a = await buildMarkedPdf(orig, [{ page: 1, payload: payload(), png: makePng(8, 8) }]);
  expect(Buffer.from(await buildMarkedPdf(a, [{ page: 1, payload: null, png: null }])).equals(Buffer.from(orig))).toBe(
    true,
  );
});

test("foreign update after ours is kept", async () => {
  const a = await buildMarkedPdf(await makePdf({ xref: "table" }), [
    { page: 1, payload: payload(1), png: makePng(8, 8) },
  ]);
  const foreign = await appendForeignUpdate(a);
  const b = await buildMarkedPdf(foreign, [{ page: 1, payload: payload(2), png: makePng(8, 8) }]);
  expect(Buffer.from(b.subarray(0, foreign.length)).equals(Buffer.from(foreign))).toBe(true);
  const c = await buildMarkedPdf(b, [{ page: 1, payload: payload(2), png: makePng(8, 8) }]);
  expect(c.length).toBe(b.length);
});

test("fully rewritten file becomes the new original", async () => {
  const a = await buildMarkedPdf(await makePdf({ xref: "table" }), [
    { page: 1, payload: payload(1), png: makePng(8, 8) },
  ]);
  const rewritten = await (await PDFDocument.load(a, { updateMetadata: false })).save();
  const b = await buildMarkedPdf(rewritten, [{ page: 1, payload: payload(2), png: makePng(8, 8) }]);
  expect(Buffer.from(b.subarray(0, rewritten.length)).equals(Buffer.from(rewritten))).toBe(true);
  expect(readMarkup(await PDFDocument.load(b, { updateMetadata: false })).meta?.originalLength).toBe(rewritten.length);
});

test("orphaned stamps are never deleted and leave our OCG", async () => {
  const a = await buildMarkedPdf(await makePdf({ xref: "table" }), [{ page: 1, payload: payload(), png: makePng(8, 8) }]);
  const stripped = await stripSmvData(a);
  expect(readMarkup(await PDFDocument.load(stripped, { updateMetadata: false })).orphans).toHaveLength(1);
  const b = await buildMarkedPdf(stripped, []);
  expect(await subtypes(b)).toEqual(["Stamp"]);
  const r = readMarkup(await PDFDocument.load(b, { updateMetadata: false }));
  expect(r.orphans).toHaveLength(0); // NM ist jetzt smv-markup-orphan, /OC fehlt
});

describe("isOurUpdateLast and chooseBase", () => {
  test("our update is last only while nothing was appended after it", async () => {
    const orig = await makePdf({ xref: "stream" });
    const a = await buildMarkedPdf(orig, [mark(1)]);
    expect(isOurUpdateLast(a, orig.length)).toBe(true);
    expect(isOurUpdateLast(a, orig.length - 1)).toBe(false); // no section ends there
    expect(isOurUpdateLast(a, a.length)).toBe(false); // no update starts at the end
    const foreign = await appendForeignUpdate(a);
    expect(isOurUpdateLast(foreign, orig.length)).toBe(false);
    expect(isOurUpdateLast(orig, orig.length)).toBe(false);
  });

  test("chooseBase", async () => {
    const orig = await makePdf({ xref: "table" });
    const a = await buildMarkedPdf(orig, [mark(1)]);
    const foreign = await appendForeignUpdate(a);
    const meta = { originalLength: orig.length, updateStart: orig.length };
    expect(chooseBase(orig, null)).toEqual({ baseLength: orig.length, originalLength: orig.length });
    expect(chooseBase(a, meta)).toEqual({ baseLength: orig.length, originalLength: orig.length });
    expect(chooseBase(foreign, meta)).toEqual({ baseLength: foreign.length, originalLength: orig.length });
    // /OriginalLength no longer ends a section: the file was rewritten, it is the new original.
    expect(chooseBase(a, { originalLength: orig.length - 3, updateStart: orig.length })).toEqual({
      baseLength: a.length,
      originalLength: a.length,
    });
  });

  test("never truncates into the original, even with inconsistent metadata", async () => {
    const orig = await makePdf({ xref: "table" });
    const once = await appendForeignUpdate(orig);
    const a = await buildMarkedPdf(once, [mark(1)]);
    // /UpdateStart before /OriginalLength makes no sense: do not cut.
    expect(chooseBase(a, { originalLength: once.length, updateStart: orig.length }).baseLength).toBe(a.length);
  });
});

describe("trailing bytes after the original's %%EOF", () => {
  test.each([
    ["line breaks", "\n\n"],
    ["NUL bytes", "\0\0\0"],
  ])("%s: repeated saves do not grow, clearing restores the exact original", async (_name, junk) => {
    const orig = new Uint8Array(Buffer.concat([Buffer.from(await makePdf({ xref: "table" })), Buffer.from(junk, "latin1")]));
    const a = await buildMarkedPdf(orig, [mark(1, payload(1))]);
    const b = await buildMarkedPdf(a, [mark(1, payload(2))]);
    const c = await buildMarkedPdf(b, [mark(1, payload(2))]); // same content as b: same size
    for (const out of [a, b, c]) expect(hasPrefix(out, orig)).toBe(true);
    expect(c.length).toBe(b.length);
    expect(countStartXref(c)).toBe(countStartXref(orig) + 1);
    expect(readMarkup(await load(c)).meta).toEqual({ originalLength: orig.length, updateStart: orig.length });
    expect(same(await buildMarkedPdf(c, [mark(1, null)]), orig)).toBe(true);
  });
});

describe("base selection in buildMarkedPdf", () => {
  test("a foreign update whose /Prev wrongly skips ours is kept, never truncated", async () => {
    const orig = await makePdf({ xref: "table" });
    const a = await buildMarkedPdf(orig, [mark(1)]);
    const foreign = Buffer.from(await appendForeignUpdate(a)).toString("latin1");
    // Point the foreign trailer's /Prev at the original's section (same width, leading zeros).
    const ourXref = String(findLastStartXref(a));
    const skipping = String(findLastStartXref(orig)).padStart(ourXref.length, "0");
    const at = foreign.lastIndexOf(`/Prev ${ourXref}`);
    expect(at).toBeGreaterThan(a.length);
    const nonConforming = new Uint8Array(
      Buffer.from(foreign.slice(0, at) + `/Prev ${skipping}` + foreign.slice(at + 6 + ourXref.length), "latin1"),
    );
    expect(nonConforming.length).toBe(foreign.length);
    expect(isOurUpdateLast(nonConforming, orig.length)).toBe(false);
    const b = await buildMarkedPdf(nonConforming, [mark(1, payload(2))]);
    expect(hasPrefix(b, nonConforming)).toBe(true);
  });

  test("/UpdateStart is the base length; truncation keeps exactly one update of ours", async () => {
    const orig = await makePdf({ xref: "table", pages: 2 });
    const a = await buildMarkedPdf(orig, [mark(1, payload(1))]);
    const b = await buildMarkedPdf(a, [mark(1, payload(3))]);
    expect(hasPrefix(b, orig)).toBe(true);
    expect(countStartXref(b)).toBe(2);
    expect(readMarkup(await load(b)).meta).toEqual({ originalLength: orig.length, updateStart: orig.length });

    const foreign = await appendForeignUpdate(b);
    const c = await buildMarkedPdf(foreign, [mark(2, payload(4))]);
    const r = readMarkup(await load(c));
    expect(r.meta).toEqual({ originalLength: orig.length, updateStart: foreign.length });
    expect(r.pages.map((p) => [p.page, p.payload])).toEqual([
      [1, payload(3)],
      [2, payload(4)],
    ]);
  });

  test("a copied page keeps its previous rect, appearance and data", async () => {
    const orig = await makePdf({ xref: "stream", pages: 2, cropBox: [20, 30, 500, 800] });
    const a = await buildMarkedPdf(orig, [mark(1, payload(1))]);
    // The page box changes later; the copied stamp still covers the area it was drawn for.
    const resized = await patch(a, (doc) => {
      doc.getPage(0).node.set(PDFName.of("CropBox"), doc.context.obj([0, 0, 595, 842]));
      return [doc.getPage(0).ref];
    });
    const b = await buildMarkedPdf(resized, [mark(2, payload(2))]); // foreign last: appends
    const c = await buildMarkedPdf(b, [mark(2, payload(5))]); // ours last: truncates, copies page 1
    expect(c.length).toBe(b.length);
    const before = readMarkup(await load(a)).pages[0];
    const docC = await load(c);
    const after = readMarkup(docC).pages[0];
    expect(after.rect).toEqual([20, 30, 500, 800]);
    expect(after.payload).toEqual(payload(1));
    const docA = await load(a);
    const content = (doc: PDFDocument, ref: PDFRef) => decodePDFRawStream(doc.context.lookup(ref) as PDFRawStream).decode();
    expect(Buffer.from(content(docC, after.appearanceRef))).toEqual(Buffer.from(content(docA, before.appearanceRef)));
  });

  test("a stamp removed by our last update stays removed after truncation", async () => {
    const a = await buildMarkedPdf(await makePdf({ xref: "table", foreignAnnot: true }), [mark(1)]);
    const foreign = await appendForeignUpdate(a);
    const b = await buildMarkedPdf(foreign, [mark(1, null)]); // appends: removes the stamp from a
    expect(readMarkup(await load(b)).pages).toEqual([]);
    const c = await buildMarkedPdf(b, []); // truncates to `foreign`, whose page 1 still has the stamp
    expect(c.length).toBe(b.length);
    expect(readMarkup(await load(c)).pages).toEqual([]);
    expect(await subtypes(c)).toEqual(["Text", "Square"]);
  });

  test("clearing after a foreign update writes an update instead of dropping it", async () => {
    const orig = await makePdf({ xref: "stream" });
    const a = await buildMarkedPdf(orig, [mark(1)]);
    const foreign = await appendForeignUpdate(a, "Kept title");
    const b = await buildMarkedPdf(foreign, [mark(1, null)]);
    expect(hasPrefix(b, foreign)).toBe(true);
    expect(readMarkup(await load(b)).pages).toEqual([]);
    const { value } = await inspectWithPdfjs(b, async (doc) => (await doc.getMetadata()).info as { Title?: string });
    expect(value.Title).toBe("Kept title");
  });

  test("an orphan repair is redone after truncation and never grows the file", async () => {
    const a = await buildMarkedPdf(await makePdf({ xref: "stream", pages: 2 }), [mark(1)]);
    const stripped = await stripSmvData(a);
    const b = await buildMarkedPdf(stripped, []);
    const c = await buildMarkedPdf(b, [mark(2)]);
    const d = await buildMarkedPdf(c, []);
    for (const out of [b, c, d]) {
      expect(hasPrefix(out, stripped)).toBe(true);
      const r = readMarkup(await load(out));
      expect(r.orphans).toEqual([]);
      expect(await subtypes(out)).toEqual(["Stamp"]);
    }
    expect(d.length).toBe(c.length);
    expect(readMarkup(await load(d)).pages.map((p) => p.page)).toEqual([2]);
  });

  test("the repaired orphan has /NM (smv-markup-orphan) and no /OC, and keeps its appearance", async () => {
    const a = await buildMarkedPdf(await makePdf({ xref: "table" }), [mark(1)]);
    const stripped = await stripSmvData(a);
    const orphan = readMarkup(await load(stripped)).orphans[0].annotRef;
    const doc = await load(await buildMarkedPdf(stripped, [mark(1, payload(2))]));
    const annot = doc.context.lookup(orphan, PDFDict);
    expect(annot.lookup(PDFName.of("NM"), PDFString).decodeText()).toBe(ORPHAN_NM);
    expect(annot.has(PDFName.of("OC"))).toBe(false);
    expect(annot.lookup(PDFName.of("AP"), PDFDict).get(PDFName.of("N"))).toBeInstanceOf(PDFRef);
    expect(readMarkup(doc).pages.map((p) => p.payload)).toEqual([payload(2)]);
  });

  test("an original that already contains our stamps is not returned when clearing", async () => {
    const a = await buildMarkedPdf(await makePdf({ xref: "table" }), [mark(1)]);
    const rewritten = await (await load(a)).save(); // the new original contains a stamp of ours
    const cleared = await buildMarkedPdf(rewritten, [mark(1, null)]);
    expect(hasPrefix(cleared, rewritten)).toBe(true);
    expect(cleared.length).toBeGreaterThan(rewritten.length);
    expect(readMarkup(await load(cleared)).pages).toEqual([]);
  });
});

describe("robustness (ruling R6)", () => {
  test("duplicate valid stamps on one page: one stays ours, the others are repaired, all stay visible", async () => {
    const a = await buildMarkedPdf(await makePdf({ xref: "table" }), [mark(1, payload(1))]);
    const dup = await patch(a, (doc) => {
      const page = doc.getPage(0);
      const { annotRef } = readMarkup(doc).pages[0];
      const copy = doc.context.register(doc.context.lookup(annotRef, PDFDict).clone());
      page.node.set(PDFName.of("Annots"), doc.context.obj([annotRef, copy]));
      return [page.ref];
    });
    const before = readMarkup(await load(dup));
    expect(before.pages).toHaveLength(1);
    expect(before.orphans).toHaveLength(1);
    expect(before.orphans[0].annotRef).not.toEqual(before.pages[0].annotRef);

    const out = await buildMarkedPdf(dup, []);
    const doc = await load(out);
    const after = readMarkup(doc);
    expect(after.orphans).toEqual([]);
    expect(after.pages.map((p) => p.payload)).toEqual([payload(1)]);
    const repaired = doc.context.lookup(before.orphans[0].annotRef, PDFDict);
    expect(repaired.lookup(PDFName.of("NM"), PDFString).decodeText()).toBe(ORPHAN_NM);
    expect(repaired.has(PDFName.of("OC"))).toBe(false);
    expect(await subtypes(out)).toEqual(["Stamp", "Stamp"]);
  });

  test("direct annotation dictionaries in /Annots are left untouched", async () => {
    const orig = await makePdf({ xref: "table" });
    const direct = await patch(orig, (doc) => {
      const page = doc.getPage(0);
      // A direct Square and a direct dict that even looks like ours: both are not ours to touch.
      page.node.set(
        PDFName.of("Annots"),
        doc.context.obj([
          { Type: "Annot", Subtype: "Square", Rect: [10, 10, 50, 50] },
          { Type: "Annot", Subtype: "Stamp", Rect: [0, 0, 595, 842], NM: PDFString.of(ANNOT_NM) },
        ]),
      );
      return [page.ref];
    });
    const a = await buildMarkedPdf(direct, [mark(1)]);
    const b = await buildMarkedPdf(a, [mark(1, payload(2))]);
    for (const out of [a, b]) {
      const doc = await load(out);
      const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).asArray();
      expect(annots).toHaveLength(3);
      expect(annots[0]).toBeInstanceOf(PDFDict);
      expect(annots[1]).toBeInstanceOf(PDFDict);
      expect((annots[1] as PDFDict).lookup(PDFName.of("NM"), PDFString).decodeText()).toBe(ANNOT_NM);
      expect(annots[2]).toBeInstanceOf(PDFRef);
    }
    expect(readMarkup(await load(b)).pages.map((p) => p.payload)).toEqual([payload(2)]);
  });

  test("a non-numeric /Rotate counts as 0 (like pdf.js)", async () => {
    const garbage = await patch(await makePdf({ xref: "stream" }), (doc) => {
      doc.getPage(0).node.set(PDFName.of("Rotate"), PDFName.of("Ninety"));
      return [doc.getPage(0).ref];
    });
    const out = await buildMarkedPdf(garbage, [mark(1)]);
    const doc = await load(out);
    const form = doc.context.lookup(readMarkup(doc).pages[0].appearanceRef) as PDFRawStream;
    expect(Buffer.from(decodePDFRawStream(form).decode()).toString("latin1")).toBe("q 595 0 0 842 0 0 cm /Im0 Do Q");
  });
});

const corpusPdfs = fs.existsSync(corpusDir)
  ? fs
      .readdirSync(corpusDir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .sort()
  : [];

describe.skipIf(corpusPdfs.length === 0)("real sheets in Noten/ (read-only, in memory)", () => {
  test.each(corpusPdfs)(
    "%s",
    async (f) => {
      const orig = new Uint8Array(fs.readFileSync(path.join(corpusDir, f)));
      const before = await annotationsPerPage(orig);
      const changes = before.map((_, i) => ({ page: i + 1, payload: payload(i), png: makePng(8, 8) }));
      const a = await buildMarkedPdf(orig, changes);

      expect(Buffer.from(a.subarray(0, orig.length)).equals(Buffer.from(orig))).toBe(true);
      const after = await annotationsPerPage(a);
      expect(after).toHaveLength(before.length);
      after.forEach((annots, i) => {
        expect(annots.filter((x) => !x.isOurs)).toEqual(before[i]); // fremde unverändert
        expect(annots.filter((x) => x.isOurs)).toHaveLength(1);
      });
      const again = await buildMarkedPdf(a, changes);
      expect(again.length).toBe(a.length);
      const cleared = await buildMarkedPdf(a, changes.map((c) => ({ ...c, payload: null, png: null })));
      expect(Buffer.from(cleared).equals(Buffer.from(orig))).toBe(true);

      // Replacing with only page 1 changed: the other pages' stamps are taken over from the replaced update.
      const partial = await buildMarkedPdf(a, [{ page: 1, payload: payload(99), png: makePng(8, 8) }]);
      expect(hasPrefix(partial, orig)).toBe(true);
      expect(countStartXref(partial)).toBe(countStartXref(a));
      const r = readMarkup(await load(partial));
      expect(r.pages.map((p) => p.payload)).toEqual(changes.map((c, i) => (i === 0 ? payload(99) : c.payload)));
      expect(r.orphans).toEqual([]);
      const partialAnnots = await annotationsPerPage(partial);
      partialAnnots.forEach((annots, i) => expect(annots.filter((x) => !x.isOurs)).toEqual(before[i]));
      expect((await openWithPdfjs(partial)).recovered).toBe(false);

      const sizes = `orig=${orig.length} marked=${a.length} resaved=${again.length} partial=${partial.length}`;
      console.log(`[corpus] ${f}: pages=${before.length} ${sizes} cleared=${cleared.length}`);
    },
    300_000,
  );
});
