import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";
import { findLastStartXref, getSectionTrailer, getXrefKind } from "../../src/pdfMarkup/fileStructure";
import {
  dropStartXref,
  makeEncryptedPdf,
  makePdf,
  makePng,
  markEncrypted,
  padAfterEof,
  readXrefEntries,
  wrongStartXref,
} from "./fixtures";
import { inspectWithPdfjs, openWithPdfjs } from "./pdfjs";

test("makePdf honours pages, rotation, crop box, media boxes and annotations", async () => {
  const pdf = await makePdf({
    pages: 2,
    xref: "stream",
    rotate: 90,
    cropBox: [10, 10, 500, 700],
    mediaBoxes: [[-22.5, -56.8, 572.7, 785.0]],
    foreignAnnot: true,
  });
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  expect(doc.getPageCount()).toBe(2);
  const [p1, p2] = doc.getPages();
  expect(p1.getRotation().angle).toBe(90);
  expect(p1.getMediaBox()).toEqual({ x: -22.5, y: -56.8, width: 595.2, height: 841.8 });
  expect(p2.getMediaBox()).toEqual({ x: 0, y: 0, width: 595, height: 842 });
  expect(p1.getCropBox()).toEqual({ x: 10, y: 10, width: 490, height: 690 });
  expect(p1.node.Annots()?.size()).toBe(2);
  expect(p2.node.Annots()?.size() ?? 0).toBe(0);
});

test("makePng produces a decodable RGBA PNG", () => {
  const png = Buffer.from(makePng(3, 2));
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(3);
  expect(png.readUInt32BE(20)).toBe(2);
  const idatLen = png.readUInt32BE(33);
  expect(png.subarray(37, 41).toString("latin1")).toBe("IDAT");
  expect(inflateSync(png.subarray(41, 41 + idatLen)).length).toBe(2 * (1 + 3 * 4));
});

test("markEncrypted adds /Encrypt to the trailer and keeps the xref intact", async () => {
  const pdf = await makePdf({ xref: "table" });
  const enc = markEncrypted(pdf);
  const start = findLastStartXref(enc);
  expect(start).toBe(findLastStartXref(pdf));
  expect(getXrefKind(enc, start)).toBe("table");
  expect(getSectionTrailer(enc, start).size).toBe(getSectionTrailer(pdf, start).size);
  expect(Buffer.from(enc).toString("latin1")).toContain("/Encrypt << /Filter /Standard >>");
  expect(readXrefEntries(enc, start)).toEqual(readXrefEntries(pdf, start));
});

test("makeEncryptedPdf is really encrypted and opens with the empty user password", async () => {
  const pdf = makeEncryptedPdf();
  expect((await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false })).isEncrypted).toBe(true);
  expect(await openWithPdfjs(pdf)).toMatchObject({ numPages: 1 });
  // The content stream decrypts to the blue square (a wrong object key would give garbage).
  const { value: ops } = await inspectWithPdfjs(
    pdf,
    async (doc) => (await (await doc.getPage(1)).getOperatorList()).fnArray,
  );
  expect(ops).toEqual([OPS.setFillRGBColor, OPS.constructPath]);
});

test.each([
  ["dropStartXref", dropStartXref],
  ["wrongStartXref", wrongStartXref],
  ["padAfterEof", padAfterEof],
])("%s keeps a PDF that pdf-lib and pdf.js open", async (_name, breakIt) => {
  const original = await makePdf({ xref: "table" });
  const broken = breakIt(original);
  expect(Buffer.from(broken).equals(Buffer.from(original))).toBe(false);
  expect((await PDFDocument.load(broken, { updateMetadata: false })).getPageCount()).toBe(1);
  expect(await openWithPdfjs(broken)).toMatchObject({ numPages: 1 });
});

test("the structure breakers change exactly what they promise", async () => {
  const pdf = await makePdf({ xref: "table" });
  const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
  expect(text(dropStartXref(pdf))).not.toContain("startxref");
  expect(text(dropStartXref(pdf))).toMatch(/%%EOF\s*$/);
  expect(findLastStartXref(wrongStartXref(pdf))).toBe(9);
  expect(text(padAfterEof(pdf))).toBe(text(pdf) + "\n".repeat(5000));
  expect(padAfterEof(pdf, 3).length).toBe(pdf.length + 3);
});
