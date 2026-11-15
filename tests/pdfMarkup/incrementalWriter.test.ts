import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDict, PDFDocument, PDFName, PDFRef, PDFString } from "pdf-lib";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, test, vi } from "vitest";
import { findLastStartXref, getSectionTrailer, getXrefKind } from "../../src/pdfMarkup/fileStructure";
import { reserveObjectNumbers, writeIncrementalUpdate } from "../../src/pdfMarkup/incrementalWriter";
import { corpusDir } from "../visual/corpus";
import { makePdf, markEncrypted, readXrefEntries } from "./fixtures";

// pdf.js in Node reads these with fs, so plain directory paths keep it offline (see tests/visual/pdfRender.ts).
const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const assetDir = (name: string) => path.join(pdfjsRoot, name) + path.sep;

/**
 * Opens `bytes` with pdf.js (like another viewer would) and loads every page. `recovered` is true if
 * pdf.js had to fall back to indexing all objects because the xref chain was unusable.
 */
async function openWithPdfjs(
  bytes: Uint8Array,
): Promise<{ numPages: number; title: string | undefined; recovered: boolean }> {
  const warnings: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((msg: unknown) => void warnings.push(String(msg)));
  const task = getDocument({
    data: bytes.slice(), // pdf.js detaches the buffer
    wasmUrl: assetDir("wasm"),
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetDir("standard_fonts"),
    verbosity: VerbosityLevel.WARNINGS,
  });
  try {
    const doc = await task.promise;
    for (let p = 1; p <= doc.numPages; p++) await doc.getPage(p);
    const { info } = await doc.getMetadata();
    return {
      numPages: doc.numPages,
      title: (info as { Title?: string }).Title,
      recovered: warnings.some((w) => /Indexing all PDF objects|xref/i.test(w)),
    };
  } finally {
    await task.destroy();
    spy.mockRestore();
  }
}

const text = (bytes: Uint8Array, start: number, end: number) =>
  Buffer.from(bytes.subarray(start, end)).toString("latin1");

/** Object number -> offset as a reader sees it: newest section wins, following /Prev (in-use entries only). */
function resolveXrefChain(bytes: Uint8Array): Map<number, number> {
  const result = new Map<number, number>();
  const seen = new Set<number>();
  let offset: number | null = findLastStartXref(bytes);
  while (offset !== null && !seen.has(offset)) {
    seen.add(offset);
    for (const [num, off] of readXrefEntries(bytes, offset)) if (!result.has(num)) result.set(num, off);
    offset = getSectionTrailer(bytes, offset).prev;
  }
  return result;
}

/** Every in-use entry of the newest section points at `N G obj` for its own number. */
function expectEntriesPointAtObjects(bytes: Uint8Array) {
  const entries = readXrefEntries(bytes, findLastStartXref(bytes));
  expect(entries.size).toBeGreaterThan(0);
  for (const [num, off] of entries) expect(text(bytes, off, off + 20)).toMatch(new RegExp(`^${num} \\d+ obj`));
}

const hasPrefix = (bytes: Uint8Array, prefix: Uint8Array) =>
  Buffer.from(bytes.subarray(0, prefix.length)).equals(Buffer.from(prefix));

/**
 * Appends an update the way another program would (hand-written, independent of the writer):
 * a new object, the catalog pointing to it under /Foreign_Test and an Info dict with a new /Title.
 * The update ends with `%%EOF` and no line break, like macOS Quartz output.
 */
async function appendForeignUpdate(base: Uint8Array, kind: "table" | "stream", title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  const prev = findLastStartXref(base);
  const { size } = getSectionTrailer(base, prev);
  const catalogRef = doc.context.trailerInfo.Root as PDFRef;
  const infoRef = doc.context.trailerInfo.Info as PDFRef;
  const newNum = size;
  doc.catalog.set(PDFName.of("Foreign_Test"), PDFRef.of(newNum));
  const info = doc.context.lookup(infoRef, PDFDict);
  info.set(PDFName.of("Title"), PDFString.of(title));

  let out = Buffer.from(base).toString("latin1");
  if (!/[\r\n]$/.test(out)) out += "\n";
  const offsets = new Map<number, number>();
  const add = (num: number, body: string) => {
    offsets.set(num, out.length);
    out += `${num} 0 obj\n${body}\nendobj\n`;
  };
  add(catalogRef.objectNumber, doc.catalog.toString());
  add(infoRef.objectNumber, info.toString());
  add(newNum, "<< /Foreign true >>");
  const xrefOffset = out.length;
  const trailerKeys = `/Root ${catalogRef} /Info ${infoRef} /Prev ${prev}`;

  if (kind === "table") {
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    out += "xref\n";
    for (const num of nums) out += `${num} 1\n${String(offsets.get(num)).padStart(10, "0")} 00000 n\r\n`;
    out += `trailer\n<< /Size ${newNum + 1} ${trailerKeys} >>\nstartxref\n${xrefOffset}\n%%EOF`;
  } else {
    const xrefNum = newNum + 1;
    offsets.set(xrefNum, xrefOffset);
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    const rows = Buffer.alloc(nums.length * 7);
    nums.forEach((num, i) => {
      rows[i * 7] = 1;
      rows.writeUInt32BE(offsets.get(num)!, i * 7 + 1);
    });
    const data = deflateSync(rows);
    const index = nums.map((n) => `${n} 1`).join(" ");
    out +=
      `${xrefNum} 0 obj\n<< /Type /XRef /Size ${xrefNum + 1} /W [1 4 2] /Index [${index}] ${trailerKeys}` +
      ` /Filter /FlateDecode /Length ${data.length} >>\nstream\n` +
      data.toString("latin1") +
      `\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF`;
  }
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** Loads `base`, adds a new object under catalog key `key` (and optionally a new Info title), writes an update. */
async function addCatalogEntry(base: Uint8Array, key: string, title?: string) {
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  reserveObjectNumbers(base, doc.context);
  const newRef = doc.context.register(doc.context.obj({ Foo: "Bar" }));
  const catalogRef = doc.context.trailerInfo.Root as PDFRef;
  doc.catalog.set(PDFName.of(key), newRef);
  const refs = [catalogRef, newRef];
  if (title !== undefined) {
    const infoRef = doc.context.trailerInfo.Info as PDFRef;
    doc.context.lookup(infoRef, PDFDict).set(PDFName.of("Title"), PDFString.of(title));
    refs.push(infoRef);
  }
  const result = writeIncrementalUpdate(base, doc.context, refs);
  return { ...result, newRef, catalogRef };
}

test.each(["table", "stream"] as const)("appends a valid update (%s)", async (kind) => {
  const base = await makePdf({ xref: kind });
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  reserveObjectNumbers(base, doc.context);
  const newRef = doc.context.register(doc.context.obj({ Foo: "Bar" }));
  const catalogRef = doc.context.trailerInfo.Root as PDFRef;
  doc.catalog.set(PDFName.of("SMV_Test"), newRef);
  const { bytes, offsets } = writeIncrementalUpdate(base, doc.context, [catalogRef, newRef]);

  expect(Buffer.from(bytes.subarray(0, base.length)).equals(Buffer.from(base))).toBe(true);
  const last = findLastStartXref(bytes);
  expect(getXrefKind(bytes, last)).toBe(kind);
  expect(getSectionTrailer(bytes, last).prev).toBe(findLastStartXref(base));
  const entries = readXrefEntries(bytes, last);
  expect(entries.get(newRef.objectNumber)).toBe(offsets.get(newRef.objectNumber));
  for (const [num, off] of entries)
    expect(Buffer.from(bytes.subarray(off, off + 20)).toString("latin1")).toMatch(new RegExp(`^${num} \\d+ obj`));

  const reloaded = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(reloaded.catalog.get(PDFName.of("SMV_Test"))).toBeInstanceOf(PDFRef);
  const task = getDocument({ data: bytes.slice() }); // pdfjs-dist/legacy/build/pdf.mjs
  const pdfjsDoc = await task.promise;
  expect(pdfjsDoc.numPages).toBe(1);
  await task.destroy();
});

describe.each(["table", "stream"] as const)("writeIncrementalUpdate (%s)", (kind) => {
  test("writes objects in ascending order with exact offsets, Size and trailer keys", async () => {
    const base = await makePdf({ xref: kind });
    const { bytes, offsets, newRef, catalogRef } = await addCatalogEntry(base, "SMV_Test");
    const last = findLastStartXref(bytes);
    const entries = readXrefEntries(bytes, last);

    // Objects follow each other in ascending number order, each at its recorded offset.
    const written = [...offsets.entries()];
    expect(written.map(([n]) => n)).toEqual([catalogRef.objectNumber, newRef.objectNumber].sort((a, b) => a - b));
    for (let i = 1; i < written.length; i++) expect(written[i][1]).toBeGreaterThan(written[i - 1][1]);
    for (const [num, off] of offsets) {
      expect(text(bytes, off, off + 20)).toMatch(new RegExp(`^${num} 0 obj\n`));
      expect(entries.get(num)).toBe(off);
    }

    // Exactly the written objects (plus the xref stream itself) are in the new section.
    const expected = new Set(offsets.keys());
    if (kind === "stream") {
      const xrefNum = Number(/^(\d+) 0 obj/.exec(text(bytes, last, last + 20))![1]);
      expect(entries.get(xrefNum)).toBe(last);
      expected.add(xrefNum);
      expect(xrefNum).toBeGreaterThan(newRef.objectNumber);
    }
    expect(new Set(entries.keys())).toEqual(expected);

    const trailer = getSectionTrailer(bytes, last);
    expect(trailer.size).toBe(Math.max(...entries.keys()) + 1);
    expect(trailer.size).toBeGreaterThanOrEqual(getSectionTrailer(base, findLastStartXref(base)).size);
    const dict = text(bytes, last, bytes.length);
    expect(dict).toMatch(new RegExp(`/Root ${catalogRef.objectNumber} 0 R`));
    expect(dict).toMatch(/\/Info \d+ 0 R/);
    expect(dict).not.toMatch(/\/Encrypt/);
    expect(text(bytes, bytes.length - 30, bytes.length)).toMatch(new RegExp(`startxref\n${last}\n%%EOF\n$`));
  });

  test("inserts a line break only if the base does not end with one", async () => {
    const raw = await makePdf({ xref: kind });
    expect(raw[raw.length - 1]).not.toBe(0x0a);
    const withEol = new Uint8Array([...raw, 0x0a]);
    for (const base of [raw, withEol]) {
      const { bytes, offsets } = await addCatalogEntry(base, "SMV_Test");
      const first = Math.min(...offsets.values());
      expect(first).toBe(base === raw ? base.length + 1 : base.length);
      expect(bytes[first - 1]).toBe(0x0a);
      expect(hasPrefix(bytes, base)).toBe(true);
    }
  });

  test("chains /Prev to the last section of a base that already has an update", async () => {
    const original = await makePdf({ xref: kind });
    const base = await appendForeignUpdate(original, kind, "Foreign Title");
    expect(findLastStartXref(base)).not.toBe(findLastStartXref(original));
    expect(await openWithPdfjs(base)).toEqual({ numPages: 1, title: "Foreign Title", recovered: false }); // valid fixture

    const { bytes, newRef, catalogRef, offsets } = await addCatalogEntry(base, "SMV_Test");
    expect(hasPrefix(bytes, base)).toBe(true);
    const last = findLastStartXref(bytes);
    expect(getXrefKind(bytes, last)).toBe(kind);
    expect(getSectionTrailer(bytes, last).prev).toBe(findLastStartXref(base));
    expect(newRef.objectNumber).toBeGreaterThanOrEqual(getSectionTrailer(base, findLastStartXref(base)).size);
    expectEntriesPointAtObjects(bytes);

    // A reader following the chain sees our catalog and still reaches the foreign object.
    const chain = resolveXrefChain(bytes);
    expect(chain.get(catalogRef.objectNumber)).toBe(offsets.get(catalogRef.objectNumber));
    const catalogText = text(bytes, offsets.get(catalogRef.objectNumber)!, last);
    const foreignNum = Number(/\/Foreign_Test (\d+) 0 R/.exec(catalogText)![1]);
    expect(text(bytes, chain.get(foreignNum)!, bytes.length)).toMatch(/^\d+ 0 obj\n<< \/Foreign true >>/);

    const reloaded = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(reloaded.catalog.get(PDFName.of("SMV_Test"))).toBeInstanceOf(PDFRef);
    expect(reloaded.catalog.get(PDFName.of("Foreign_Test"))).toBeInstanceOf(PDFRef);
    expect(await openWithPdfjs(bytes)).toEqual({ numPages: 1, title: "Foreign Title", recovered: false });
  });

  test("a second update on top of our own output is valid", async () => {
    const base = await makePdf({ xref: kind, pages: 2 });
    const first = await addCatalogEntry(base, "SMV_First", "First");
    const second = await addCatalogEntry(first.bytes, "SMV_Second", "Second");
    const bytes = second.bytes;

    expect(hasPrefix(bytes, first.bytes)).toBe(true);
    const last = findLastStartXref(bytes);
    expect(getXrefKind(bytes, last)).toBe(kind);
    expect(getSectionTrailer(bytes, last).prev).toBe(findLastStartXref(first.bytes));
    expect(getSectionTrailer(first.bytes, findLastStartXref(first.bytes)).prev).toBe(findLastStartXref(base));
    expect(second.newRef.objectNumber).not.toBe(first.newRef.objectNumber);
    expectEntriesPointAtObjects(bytes);

    const chain = resolveXrefChain(bytes);
    expect(chain.get(second.catalogRef.objectNumber)).toBe(second.offsets.get(second.catalogRef.objectNumber));
    expect(chain.get(first.newRef.objectNumber)).toBe(first.offsets.get(first.newRef.objectNumber));
    expect(chain.get(second.newRef.objectNumber)).toBe(second.offsets.get(second.newRef.objectNumber));

    const reloaded = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(reloaded.catalog.get(PDFName.of("SMV_First"))).toBeInstanceOf(PDFRef);
    expect(reloaded.catalog.get(PDFName.of("SMV_Second"))).toBeInstanceOf(PDFRef);
    expect(await openWithPdfjs(bytes)).toEqual({ numPages: 2, title: "Second", recovered: false });
  });
});

test("reserveObjectNumbers keeps new numbers clear of the previous /Size", async () => {
  // pdf-lib does not register xref streams, so its largest number lies below /Size - 1 here.
  const base = await makePdf({ xref: "stream" });
  const { size } = getSectionTrailer(base, findLastStartXref(base));
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  expect(doc.context.largestObjectNumber).toBeLessThan(size - 1);
  reserveObjectNumbers(base, doc.context);
  expect(doc.context.largestObjectNumber).toBe(size - 1);
  expect(doc.context.nextRef().objectNumber).toBe(size);

  // Never lowers the counter.
  doc.context.largestObjectNumber = size + 10;
  reserveObjectNumbers(base, doc.context);
  expect(doc.context.largestObjectNumber).toBe(size + 10);
});

test("openWithPdfjs notices when pdf.js has to rebuild a broken xref", async () => {
  const good = await makePdf({ xref: "table" });
  expect((await openWithPdfjs(good)).recovered).toBe(false);
  const textBytes = Buffer.from(good).toString("latin1");
  const broken = textBytes.replace(/startxref\s+\d+/, (m) => m.replace(/\d+$/, "9"));
  expect((await openWithPdfjs(new Uint8Array(Buffer.from(broken, "latin1")))).recovered).toBe(true);
});

test("the xref stream never reuses a number of the base, even without reserveObjectNumbers", async () => {
  const base = await makePdf({ xref: "stream" });
  const { size } = getSectionTrailer(base, findLastStartXref(base));
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  const { bytes } = writeIncrementalUpdate(base, doc.context, [doc.context.trailerInfo.Root as PDFRef]);
  const last = findLastStartXref(bytes);
  expect(text(bytes, last, last + 20)).toMatch(new RegExp(`^${size} 0 obj`));
  expect(getSectionTrailer(bytes, last).size).toBe(size + 1);
  expect((await openWithPdfjs(bytes)).recovered).toBe(false);
});

test("writes each object once even if a ref is passed twice", async () => {
  const base = await makePdf({ xref: "table" });
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  reserveObjectNumbers(base, doc.context);
  const catalogRef = doc.context.trailerInfo.Root as PDFRef;
  const { bytes, offsets } = writeIncrementalUpdate(base, doc.context, [catalogRef, catalogRef]);
  expect([...offsets.keys()]).toEqual([catalogRef.objectNumber]);
  expect(readXrefEntries(bytes, findLastStartXref(bytes)).size).toBe(1);
});

test("refuses unknown refs, empty updates and encrypted documents", async () => {
  const base = await makePdf({ xref: "table" });
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  expect(() => writeIncrementalUpdate(base, doc.context, [PDFRef.of(9999)])).toThrow(/9999 0 R/);
  expect(() => writeIncrementalUpdate(base, doc.context, [])).toThrow();

  const encrypted = markEncrypted(base);
  const encDoc = await PDFDocument.load(encrypted, { updateMetadata: false, ignoreEncryption: true });
  expect(() =>
    writeIncrementalUpdate(encrypted, encDoc.context, [encDoc.context.trailerInfo.Root as PDFRef]),
  ).toThrow(/encrypt/i);
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
    const base = new Uint8Array(fs.readFileSync(path.join(corpusDir, name)));
    const kind = getXrefKind(base, findLastStartXref(base));
    const before = await openWithPdfjs(base);

    const { bytes, offsets, newRef, catalogRef } = await addCatalogEntry(base, "SMV_Test");

    expect(hasPrefix(bytes, base)).toBe(true);
    const last = findLastStartXref(bytes);
    expect(getXrefKind(bytes, last)).toBe(kind);
    expect(getSectionTrailer(bytes, last).prev).toBe(findLastStartXref(base));
    expect(newRef.objectNumber).toBeGreaterThanOrEqual(getSectionTrailer(base, findLastStartXref(base)).size);
    expectEntriesPointAtObjects(bytes);
    const entries = readXrefEntries(bytes, last);
    expect(entries.get(catalogRef.objectNumber)).toBe(offsets.get(catalogRef.objectNumber));
    expect(entries.get(newRef.objectNumber)).toBe(offsets.get(newRef.objectNumber));

    const reloaded = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(reloaded.catalog.get(PDFName.of("SMV_Test"))).toEqual(newRef);
    const after = await openWithPdfjs(bytes);
    expect(after.numPages).toBe(before.numPages);
    expect(after.recovered).toBe(before.recovered);
  });
});
