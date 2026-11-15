import fs from "node:fs";
import path from "node:path";
import {
  decodePDFRawStream,
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
} from "pdf-lib";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import { ANNOT_NM, OCG_NAME } from "../../src/models/markupConstants";
import type { MarkupPayload } from "../../src/models/markup";
import { buildMarkedPdf, rotationMatrix } from "../../src/pdfMarkup/buildMarkedPdf";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { reserveObjectNumbers, writeIncrementalUpdate } from "../../src/pdfMarkup/incrementalWriter";
import { corpusDir } from "../visual/corpus";
import { renderPdfPage } from "../visual/pdfRender";
import { makePdf, makePng, markEncrypted, payload } from "./fixtures";
import { inspectWithPdfjs } from "./pdfjs";

const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false });
const hasPrefix = (bytes: Uint8Array, prefix: Uint8Array) =>
  Buffer.from(bytes.subarray(0, prefix.length)).equals(Buffer.from(prefix));
const mark = (page: number, p: MarkupPayload | null = payload()) => ({ page, payload: p, png: p ? makePng(4, 4) : null });

/** Subtype and rect of every annotation pdf.js sees on `page`. */
async function pdfjsAnnots(bytes: Uint8Array, page = 1) {
  return inspectWithPdfjs(bytes, async (doc) => {
    const p = await doc.getPage(page);
    const annots = (await p.getAnnotations()) as { subtype: string; rect: number[]; annotationFlags: number }[];
    return { annots, view: p.view };
  });
}

/** The OCGs listed in /OCProperties /OCGs, as [ref, decoded name]. */
function ocgs(doc: PDFDocument): [PDFRef, string][] {
  const props = doc.catalog.lookup(PDFName.of("OCProperties"), PDFDict);
  const list = props.lookup(PDFName.of("OCGs"), PDFArray);
  return list.asArray().map((ref) => {
    const name = doc.context.lookup(ref, PDFDict).lookup(PDFName.of("Name")) as PDFString | PDFHexString;
    return [ref as PDFRef, name.decodeText()];
  });
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

test.each(["table", "stream"] as const)("round trip (%s)", async (kind) => {
  const orig = await makePdf({ xref: kind, pages: 2, foreignAnnot: true });
  const out = await buildMarkedPdf(orig, [{ page: 1, payload: payload(), png: makePng(10, 10) }]);
  expect(Buffer.from(out.subarray(0, orig.length)).equals(Buffer.from(orig))).toBe(true);
  const r = readMarkup(await PDFDocument.load(out, { updateMetadata: false }));
  expect(r.pages).toHaveLength(1);
  expect(r.pages[0]).toMatchObject({ page: 1, rect: [0, 0, 595, 842], payload: payload() });
  expect(r.meta).toEqual({ originalLength: orig.length, updateStart: orig.length });
});

test("other viewers see a printable stamp in our OCG, foreign annots kept", async () => {
  const out = await buildMarkedPdf(await makePdf({ xref: "stream", foreignAnnot: true }), [
    { page: 1, payload: payload(), png: makePng(10, 10) },
  ]);
  const { value, recovered } = await inspectWithPdfjs(out, async (doc) => {
    const annots = (await (await doc.getPage(1)).getAnnotations()) as { subtype: string; annotationFlags: number }[];
    const groups = [...(await doc.getOptionalContentConfig())].map(([, g]) => (g as { name: string }).name);
    return { annots, groups };
  });
  expect(recovered).toBe(false);
  expect(value.annots.map((a) => a.subtype).sort()).toEqual(["Square", "Stamp", "Text"]);
  expect(value.annots.find((a) => a.subtype === "Stamp")!.annotationFlags).toBe(4);
  expect(value.groups).toContain(OCG_NAME);
});

test("rotationMatrix", () => {
  expect(rotationMatrix(0, 2, 3)).toEqual([2, 0, 0, 3, 0, 0]);
  expect(rotationMatrix(90, 2, 3)).toEqual([0, 3, -2, 0, 2, 0]);
  expect(rotationMatrix(180, 2, 3)).toEqual([-2, 0, 0, -3, 2, 3]);
  expect(rotationMatrix(270, 2, 3)).toEqual([0, -3, 2, 0, 0, 3]);
  expect(rotationMatrix(-90, 2, 3)).toEqual(rotationMatrix(270, 2, 3));
  expect(rotationMatrix(450, 2, 3)).toEqual(rotationMatrix(90, 2, 3));
});

test("rect follows crop box", async () => {
  const out = await buildMarkedPdf(await makePdf({ xref: "table", cropBox: [50, 60, 400, 700] }), [
    { page: 1, payload: payload(), png: makePng(4, 4) },
  ]);
  expect(readMarkup(await PDFDocument.load(out, { updateMetadata: false })).pages[0].rect).toEqual([50, 60, 400, 700]);
});

test("negative MediaBox origin and mixed page sizes", async () => {
  const boxes: [number, number, number, number][] = [
    [-22.5, -56.8, 572.7, 785.0],
    [0, 0, 1728, 2340],
  ];
  const out = await buildMarkedPdf(await makePdf({ xref: "stream", pages: 2, mediaBoxes: boxes }), [
    { page: 1, payload: payload(), png: makePng(4, 4) },
    { page: 2, payload: { ...payload(), width: 1728, height: 2340 }, png: makePng(4, 4) },
  ]);
  const r = readMarkup(await PDFDocument.load(out, { updateMetadata: false }));
  expect(r.pages.map((p) => p.rect)).toEqual(boxes);
});

test("encrypted PDFs are rejected", async () => {
  await expect(buildMarkedPdf(markEncrypted(await makePdf({ xref: "table" })), [])).rejects.toThrow(EncryptedPDFError);
});

describe("structure of the update", () => {
  test("stamp, appearance, image with soft mask, data stream and catalog entries", async () => {
    const out = await buildMarkedPdf(await makePdf({ xref: "table", rotate: 90 }), [
      { page: 1, payload: payload(), png: makePng(4, 4, 128) },
    ]);
    const doc = await load(out);
    const r = readMarkup(doc);
    const [page] = r.pages;
    const annot = doc.context.lookup(page.annotRef, PDFDict);
    expect(annot.get(PDFName.of("Subtype"))).toEqual(PDFName.of("Stamp"));
    expect(annot.lookup(PDFName.of("NM"), PDFString).decodeText()).toBe(ANNOT_NM);
    expect(annot.get(PDFName.of("F"))?.toString()).toBe("4");
    expect(annot.get(PDFName.of("P"))).toBe(page.pageRef);
    expect(annot.get(PDFName.of("OC"))).toBe(r.ocgRef);
    expect(page.pageRef).toBe(doc.getPage(0).ref);

    // Appearance: unrotated BBox, image counter-rotated for /Rotate 90 (w = 595, h = 842).
    const form = doc.context.lookup(page.appearanceRef) as PDFRawStream;
    expect(form).toBeInstanceOf(PDFRawStream);
    expect(form.dict.lookup(PDFName.of("BBox"), PDFArray).toString()).toBe("[ 0 0 595 842 ]");
    expect(Buffer.from(decodePDFRawStream(form).decode()).toString("latin1")).toBe("q 0 842 -595 0 595 0 cm /Im0 Do Q");
    const image = form.dict
      .lookup(PDFName.of("Resources"), PDFDict)
      .lookup(PDFName.of("XObject"), PDFDict)
      .lookup(PDFName.of("Im0")) as PDFRawStream;
    expect(image).toBeInstanceOf(PDFRawStream);
    expect(image.dict.get(PDFName.of("Subtype"))).toEqual(PDFName.of("Image"));
    expect(image.dict.get(PDFName.of("SMask"))).toBeInstanceOf(PDFRef);

    // OCG created with a UTF-16BE name, listed in /OCGs and /D /Order.
    const ocg = doc.context.lookup(r.ocgRef!, PDFDict);
    expect(ocg.get(PDFName.of("Type"))).toEqual(PDFName.of("OCG"));
    expect(ocg.get(PDFName.of("Name"))).toBeInstanceOf(PDFHexString);
    expect(ocgs(doc)).toEqual([[r.ocgRef, OCG_NAME]]);
    const order = doc.catalog
      .lookup(PDFName.of("OCProperties"), PDFDict)
      .lookup(PDFName.of("D"), PDFDict)
      .lookup(PDFName.of("Order"), PDFArray);
    expect(order.asArray()).toEqual([r.ocgRef]);

    const meta = doc.catalog.lookup(PDFName.of("SMV_Markup"), PDFDict);
    expect(meta.get(PDFName.of("Version"))?.toString()).toBe("1");
  });

  test("non-ASCII text in the fabric data survives (UTF-8)", async () => {
    const p: MarkupPayload = { ...payload(), fabric: { objects: [{ type: "Textbox", text: "Fermate – ppp 🎵 Ä" }] } };
    const out = await buildMarkedPdf(await makePdf({ xref: "stream" }), [mark(1, p)]);
    expect(readMarkup(await load(out)).pages[0].payload).toEqual(p);
  });

  test("boxes inherited from the page tree are respected", async () => {
    const orig = await makePdf({ xref: "table" });
    const inherited = await patch(orig, (doc) => {
      const page = doc.getPage(0);
      const pages = page.node.lookup(PDFName.of("Parent"), PDFDict);
      page.node.delete(PDFName.of("MediaBox"));
      pages.set(PDFName.of("MediaBox"), doc.context.obj([0, 0, 600, 800]));
      pages.set(PDFName.of("CropBox"), doc.context.obj([10, 20, 590, 900])); // clipped by the MediaBox
      return [page.ref, doc.context.getObjectRef(pages)!];
    });
    const out = await buildMarkedPdf(inherited, [mark(1)]);
    expect(readMarkup(await load(out)).pages[0].rect).toEqual([10, 20, 590, 800]);
    const { value } = await pdfjsAnnots(out);
    expect(value.view).toEqual([10, 20, 590, 800]);
  });

  test("bad page numbers and missing PNGs are rejected", async () => {
    const orig = await makePdf({ xref: "table", pages: 2 });
    await expect(buildMarkedPdf(orig, [mark(3)])).rejects.toThrow(/page/i);
    await expect(buildMarkedPdf(orig, [mark(0)])).rejects.toThrow(/page/i);
    await expect(buildMarkedPdf(orig, [{ page: 1, payload: payload(), png: null }])).rejects.toThrow(/png/i);
  });
});

describe("rendering in other viewers (pdf.js)", () => {
  /** 20×20 PNG (display orientation): opaque red top-left quadrant, everything else transparent. */
  function cornerPng(): Uint8Array {
    const png = new PNG({ width: 20, height: 20 });
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) png.data.set(x < 10 && y < 10 ? [255, 0, 0, 255] : [0, 0, 0, 0], (y * 20 + x) * 4);
    return new Uint8Array(PNG.sync.write(png));
  }
  const isRed = (img: { width: number; data: Uint8Array }, fx: number, fy: number) => {
    const i = (Math.floor(fy * (img.data.length / 4 / img.width)) * img.width + Math.floor(fx * img.width)) * 4;
    return img.data[i] > 200 && img.data[i + 1] < 60 && img.data[i + 2] < 60;
  };

  test.each([0, 90, 180, 270] as const)("the stamp lies upright over the displayed page (/Rotate %i)", async (rotate) => {
    const out = await buildMarkedPdf(await makePdf({ xref: "table", rotate, cropBox: [20, 30, 500, 800] }), [
      { page: 1, payload: payload(), png: cornerPng() },
    ]);
    const shown = await renderPdfPage(out, 1, 200, { annotations: true });
    expect(isRed(shown, 0.1, 0.1)).toBe(true);
    expect([isRed(shown, 0.9, 0.1), isRed(shown, 0.1, 0.9), isRed(shown, 0.9, 0.9)]).toEqual([false, false, false]);
    // The app hides our OCG and draws the fabric data itself.
    const hidden = await renderPdfPage(out, 1, 200, { annotations: true, hideOcgNamed: OCG_NAME });
    expect(isRed(hidden, 0.1, 0.1)).toBe(false);
  });
});

describe("appending on top of an earlier save", () => {
  test("replaces our stamp, reuses the OCG and keeps /OriginalLength", async () => {
    const orig = await makePdf({ xref: "stream", pages: 2, foreignAnnot: true });
    const first = await buildMarkedPdf(orig, [mark(1, payload(1)), mark(2, payload(2))]);
    const firstOcg = readMarkup(await load(first)).ocgRef;
    const second = await buildMarkedPdf(first, [mark(1, payload(3))]);

    expect(hasPrefix(second, first)).toBe(true);
    const doc = await load(second);
    const r = readMarkup(doc);
    expect(r.ocgRef).toEqual(firstOcg);
    expect(ocgs(doc)).toHaveLength(1);
    expect(r.pages.map((p) => [p.page, p.payload])).toEqual([
      [1, payload(3)],
      [2, payload(2)],
    ]);
    expect(r.meta).toEqual({ originalLength: orig.length, updateStart: first.length });

    const { value, recovered } = await pdfjsAnnots(second);
    expect(recovered).toBe(false);
    expect(value.annots.map((a) => a.subtype)).toEqual(["Text", "Square", "Stamp"]);
  });

  test("a null payload removes our stamp and keeps foreign annotations", async () => {
    const orig = await makePdf({ xref: "table", foreignAnnot: true });
    const first = await buildMarkedPdf(orig, [mark(1)]);
    const second = await buildMarkedPdf(first, [mark(1, null)]);
    const r = readMarkup(await load(second));
    expect(r.pages).toEqual([]);
    expect(r.orphans).toEqual([]);
    expect((await pdfjsAnnots(second)).value.annots.map((a) => a.subtype)).toEqual(["Text", "Square"]);
  });
});

describe("orphaned stamps", () => {
  /** Replaces the /SMV_Data of our stamp on page 1 with `data` (or removes it). */
  async function corrupt(bytes: Uint8Array, data: string | null) {
    return patch(bytes, (doc) => {
      const { annotRef } = readMarkup(doc).pages[0];
      const annot = doc.context.lookup(annotRef, PDFDict);
      if (data === null) annot.delete(PDFName.of("SMV_Data"));
      else annot.set(PDFName.of("SMV_Data"), doc.context.register(doc.context.flateStream(data)));
      return [annotRef];
    });
  }

  test.each([
    ["invalid JSON", "{not json"],
    ["schema mismatch", JSON.stringify({ version: 2, width: 1, height: 1, fabric: { objects: [] } })],
    ["missing data", null],
  ])("%s is reported as orphan, never thrown, and never removed", async (_name, data) => {
    const first = await buildMarkedPdf(await makePdf({ xref: "table", pages: 2 }), [mark(1)]);
    const broken = await corrupt(first, data);
    const before = readMarkup(await load(broken));
    expect(before.pages).toEqual([]);
    expect(before.orphans).toEqual([{ page: 1, annotRef: expect.any(PDFRef) }]);

    const out = await buildMarkedPdf(broken, [mark(1, payload(2)), mark(2, null)]);
    const after = readMarkup(await load(out));
    expect(after.orphans).toEqual(before.orphans);
    expect(after.pages.map((p) => [p.page, p.payload])).toEqual([[1, payload(2)]]);
  });

  test("a stamp in our OCG without our /NM is an orphan", async () => {
    const first = await buildMarkedPdf(await makePdf({ xref: "stream" }), [mark(1)]);
    const renamed = await patch(first, (doc) => {
      const { annotRef } = readMarkup(doc).pages[0];
      doc.context.lookup(annotRef, PDFDict).set(PDFName.of("NM"), PDFString.of("something-else"));
      return [annotRef];
    });
    const r = readMarkup(await load(renamed));
    expect(r.pages).toEqual([]);
    expect(r.orphans).toHaveLength(1);
  });
});

describe("existing optional content", () => {
  test("our OCG is added next to foreign ones (/OCGs and /D /Order)", async () => {
    const withOc = await patch(await makePdf({ xref: "table" }), (doc) => {
      const other = doc.context.register(doc.context.obj({ Type: "OCG", Name: PDFString.of("Foreign layer") }));
      const props = doc.context.register(doc.context.obj({ OCGs: [other], D: { Order: [other] } }));
      doc.catalog.set(PDFName.of("OCProperties"), props); // indirect, must be rewritten in place
      return [doc.context.trailerInfo.Root as PDFRef];
    });
    const out = await buildMarkedPdf(withOc, [mark(1)]);
    const doc = await load(out);
    const r = readMarkup(doc);
    expect(ocgs(doc).map(([, name]) => name)).toEqual(["Foreign layer", OCG_NAME]);
    const order = doc.catalog
      .lookup(PDFName.of("OCProperties"), PDFDict)
      .lookup(PDFName.of("D"), PDFDict)
      .lookup(PDFName.of("Order"), PDFArray);
    expect(order.size()).toBe(2);
    expect(order.get(1)).toEqual(r.ocgRef);
    const { value } = await inspectWithPdfjs(out, async (d) =>
      [...(await d.getOptionalContentConfig())].map(([, g]) => (g as { name: string }).name),
    );
    expect(value).toEqual(["Foreign layer", OCG_NAME]);
  });

  test("an existing OCG with a literal (PDFDocEncoding) name is found, not duplicated", async () => {
    const withOc = await patch(await makePdf({ xref: "table" }), (doc) => {
      // U+2013 (en dash) is 0x85 in PDFDocEncoding.
      const name = PDFString.of(OCG_NAME.replace("–", "\x85"));
      const ours = doc.context.register(doc.context.obj({ Type: "OCG", Name: name }));
      doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({ OCGs: [ours], D: {} }));
      return [doc.context.trailerInfo.Root as PDFRef];
    });
    const existing = readMarkup(await load(withOc)).ocgRef;
    expect(existing).toBeInstanceOf(PDFRef);
    const out = await buildMarkedPdf(withOc, [mark(1)]);
    const doc = await load(out);
    expect(ocgs(doc)).toEqual([[existing, OCG_NAME]]);
    expect(readMarkup(doc).ocgRef).toEqual(existing);
  });

  test("with /BaseState /OFF our new OCG is switched on explicitly", async () => {
    const withOc = await patch(await makePdf({ xref: "stream" }), (doc) => {
      const other = doc.context.register(doc.context.obj({ Type: "OCG", Name: PDFString.of("Hidden layer") }));
      doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({ OCGs: [other], D: { BaseState: "OFF" } }));
      return [doc.context.trailerInfo.Root as PDFRef];
    });
    const out = await buildMarkedPdf(withOc, [mark(1)]);
    const { value } = await inspectWithPdfjs(out, async (d) => {
      const config = await d.getOptionalContentConfig();
      return [...config].map(([, g]) => [(g as { name: string }).name, (g as { visible: boolean }).visible]);
    });
    expect(value).toEqual([
      ["Hidden layer", false],
      [OCG_NAME, true],
    ]);
  });
});

const corpusPdfs = fs.existsSync(corpusDir)
  ? fs
      .readdirSync(corpusDir)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .sort()
  : [];

describe("Noten/ corpus (read-only, in memory)", () => {
  if (corpusPdfs.length === 0) test.skip("Noten/ corpus is missing");
  test.each(corpusPdfs)("%s", { timeout: 120_000 }, async (name) => {
    const orig = new Uint8Array(fs.readFileSync(path.join(corpusDir, name)));
    const before = await pdfjsAnnots(orig);
    const out = await buildMarkedPdf(orig, [{ page: 1, payload: payload(), png: makePng(16, 16) }]);
    expect(hasPrefix(out, orig)).toBe(true);

    const r = readMarkup(await load(out));
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]).toMatchObject({ page: 1, payload: payload() });
    expect(r.pages[0].rect).toEqual(before.value.view); // pdf.js: CropBox ∩ MediaBox

    const after = await pdfjsAnnots(out);
    expect(after.recovered).toBe(false);
    const strip = (a: { subtype: string; rect: number[] }) => ({ subtype: a.subtype, rect: a.rect });
    expect(after.value.annots.slice(0, -1).map(strip)).toEqual(before.value.annots.map(strip));
    expect(after.value.annots.at(-1)).toMatchObject({ subtype: "Stamp", rect: before.value.view });
    expect(after.value.view).toEqual(before.value.view);
  });
});
