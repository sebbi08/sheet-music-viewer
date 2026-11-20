import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inflateSync, deflateSync, crc32 } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, StandardFonts, degrees } from "pdf-lib";
import { SMV_DATA_KEY } from "../../src/models/markupConstants";
import type { MarkupPayload } from "../../src/models/markup";
import { reserveObjectNumbers, writeIncrementalUpdate } from "../../src/pdfMarkup/incrementalWriter";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { inspectWithPdfjs } from "./pdfjs";

export type Box = [number, number, number, number];

export interface MakePdfOptions {
  pages?: number;
  xref: "table" | "stream";
  rotate?: 0 | 90 | 180 | 270;
  cropBox?: Box;
  /** mediaBoxes[i] is the MediaBox ([x0, y0, x1, y1]) of page i+1; origin may be negative. */
  mediaBoxes?: Box[];
  /** Attach a Text and a Square annotation to page 1. */
  foreignAnnot?: boolean;
}

const A4: Box = [0, 0, 595, 842];

/** A small valid markup payload; `n` makes payloads distinguishable. */
export const payload = (n = 1): MarkupPayload => ({
  version: 1,
  width: 595,
  height: 842,
  fabric: { version: "7.4.0", objects: [{ type: "Rect", left: n }] },
});

/** Builds a small PDF with pdf-lib. `xref` selects classic table vs. xref stream. */
export async function makePdf(opts: MakePdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const count = opts.pages ?? 1;
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([A4[2], A4[3]]);
    const box = opts.mediaBoxes?.[i];
    if (box) page.setMediaBox(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    if (opts.cropBox) {
      const c = opts.cropBox;
      page.setCropBox(c[0], c[1], c[2] - c[0], c[3] - c[1]);
    }
    if (opts.rotate) page.setRotation(degrees(opts.rotate));
    page.drawText(`Page ${i + 1}`, { x: (box?.[0] ?? 0) + 72, y: (box?.[1] ?? 0) + 700, size: 24, font });
    if (opts.foreignAnnot && i === 0) {
      const ctx = doc.context;
      const text = ctx.register(
        ctx.obj({
          Type: "Annot",
          Subtype: "Text",
          Rect: [100, 100, 120, 120],
          Contents: "foreign note",
        }),
      );
      const square = ctx.register(
        ctx.obj({
          Type: "Annot",
          Subtype: "Square",
          Rect: [200, 200, 300, 300],
          C: [1, 0, 0],
        }),
      );
      page.node.set(PDFName.of("Annots"), ctx.obj([text, square]) as PDFArray);
    }
  }
  return doc.save({ useObjectStreams: opts.xref === "stream" });
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Gradient RGBA PNG of the given size (opaque unless `alpha` < 255), built without extra dependencies. */
export function makePng(w: number, h: number, alpha = 255): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 4;
      raw[p] = x % 256;
      raw[p + 1] = y % 256;
      raw[p + 2] = 128;
      raw[p + 3] = alpha;
    }
  }
  return new Uint8Array(
    Buffer.concat([
      PNG_SIGNATURE,
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/**
 * Marks a classic-xref-table PDF as encrypted by adding `/Encrypt << /Filter /Standard >>`
 * to the trailer. The xref offsets stay valid because only bytes after the table change.
 */
export function markEncrypted(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes).toString("latin1");
  const idx = text.lastIndexOf("trailer");
  if (idx < 0) throw new Error("markEncrypted needs an xref-table PDF");
  const open = text.indexOf("<<", idx);
  const patched =
    text.slice(0, open + 2) + " /Encrypt << /Filter /Standard >>" + text.slice(open + 2);
  return new Uint8Array(Buffer.from(patched, "latin1"));
}

/** RC4 (OpenSSL 3 no longer offers it). */
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const md5 = (...parts: Uint8Array[]) => new Uint8Array(createHash("md5").update(Buffer.concat(parts)).digest());

/** Password padding string of the standard security handler (PDF 32000-1, 7.6.3.3, Algorithm 2 step a). */
const PASSWORD_PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
const padPassword = (password: string) =>
  new Uint8Array(Buffer.concat([Buffer.from(password, "latin1"), PASSWORD_PAD]).subarray(0, 32));

/**
 * A really encrypted one-page PDF, written by hand: standard security handler `/V 1 /R 2` (RC4, 40-bit
 * key), empty user password (every viewer opens it), owner password "owner", `/P -4`. `/O`, `/U` and the
 * file key follow PDF 32000-1 section 7.6.3 (Algorithms 3, 2 and 4); the page's content stream (a blue
 * square) is encrypted with its object key (Algorithm 1). The file has no strings that need encrypting.
 */
export function makeEncryptedPdf(): Uint8Array {
  const id = md5(Buffer.from("smv encrypted fixture", "latin1"));
  const permissions = -4;
  const keyLength = 5; // R2: 40 bit
  const user = padPassword("");
  // Algorithm 3: /O = RC4 of the padded user password, keyed with the MD5 of the padded owner password.
  const owner = rc4(md5(padPassword("owner")).subarray(0, keyLength), user);
  // Algorithm 2: the file key.
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);
  const fileKey = md5(user, owner, p, id).subarray(0, keyLength);
  // Algorithm 4 (R2): /U = RC4 of the padding string with the file key.
  const userEntry = rc4(fileKey, PASSWORD_PAD);
  // Algorithm 1: the key of object 4, generation 0 (3 bytes object number, 2 bytes generation, low byte first).
  const objectKey = md5(fileKey, Uint8Array.of(4, 0, 0, 0, 0)).subarray(0, Math.min(keyLength + 5, 16));
  const content = rc4(objectKey, Buffer.from("0 0 1 rg 72 600 144 144 re f\n", "latin1"));

  const hex = (b: Uint8Array) => `<${Buffer.from(b).toString("hex")}>`;
  const chunks: Buffer[] = [];
  let length = 0;
  const add = (...parts: (string | Uint8Array)[]) => {
    for (const part of parts) {
      const buf = typeof part === "string" ? Buffer.from(part, "latin1") : Buffer.from(part);
      chunks.push(buf);
      length += buf.length;
    }
  };
  const offsets: number[] = [];
  const object = (num: number, ...body: (string | Uint8Array)[]) => {
    offsets.push(length);
    add(`${num} 0 obj\n`, ...body, "\nendobj\n");
  };
  add("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>");
  object(4, `<< /Length ${content.length} >>\nstream\n`, content, "\nendstream");
  object(5, `<< /Filter /Standard /V 1 /R 2 /O ${hex(owner)} /U ${hex(userEntry)} /P ${permissions} >>`);
  const xref = length;
  add(
    `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Encrypt 5 0 R /ID [${hex(id)} ${hex(id)}] >>\n`,
    `startxref\n${xref}\n%%EOF\n`,
  );
  return new Uint8Array(Buffer.concat(chunks));
}

/** Replaces the last `startxref <n>` of the file with `replacement`. */
function replaceLastStartXref(bytes: Uint8Array, replacement: string): Uint8Array {
  const text = Buffer.from(bytes).toString("latin1");
  const last = [...text.matchAll(/startxref\s+\d+/g)].at(-1);
  if (!last || last.index === undefined) throw new Error("the PDF has no startxref");
  const patched = text.slice(0, last.index) + replacement + text.slice(last.index + last[0].length);
  return new Uint8Array(Buffer.from(patched, "latin1"));
}

/** Removes the last `startxref <n>`; `%%EOF` stays. */
export const dropStartXref = (bytes: Uint8Array): Uint8Array => replaceLastStartXref(bytes, "");

/** Points the last `startxref` at offset 9, where no cross-reference section starts. */
export const wrongStartXref = (bytes: Uint8Array): Uint8Array => replaceLastStartXref(bytes, "startxref\n9");

/** Appends `n` line feeds after `%%EOF`, which moves `startxref` out of the 4096-byte tail window. */
export const padAfterEof = (bytes: Uint8Array, n = 5000): Uint8Array =>
  new Uint8Array(Buffer.concat([bytes, Buffer.alloc(n, 0x0a)]));

/**
 * Object number -> byte offset of the in-use (type 1) entries of the single xref section at
 * `offset`. Decodes a classic table or an xref stream (`/W`, `/Index`, Flate). Does not follow /Prev.
 */
export function readXrefEntries(bytes: Uint8Array, offset: number): Map<number, number> {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset);
  const entries = new Map<number, number>();
  const head = text.toString("latin1", 0, Math.min(text.length, 64));
  if (/^\s*xref/.test(head)) {
    const lines = text.toString("latin1", 0, text.indexOf("trailer", 0, "latin1")).split(/\r\n|\r|\n/);
    let num = 0;
    for (const line of lines) {
      const sub = /^(\d+) (\d+)\s*$/.exec(line);
      if (sub) {
        num = Number(sub[1]);
        continue;
      }
      const entry = /^(\d{10}) (\d{5}) ([nf])\s*$/.exec(line);
      if (entry) {
        if (entry[3] === "n") entries.set(num, Number(entry[1]));
        num++;
      }
    }
    return entries;
  }

  const streamKw = text.indexOf("stream", 0, "latin1");
  const dict = text.toString("latin1", 0, streamKw);
  const w = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(dict);
  if (!w) throw new Error("xref stream without /W");
  const widths = [Number(w[1]), Number(w[2]), Number(w[3])];
  const size = Number(/\/Size\s+(\d+)/.exec(dict)![1]);
  const idx = /\/Index\s*\[([\d\s]+)\]/.exec(dict);
  const index = idx ? idx[1].trim().split(/\s+/).map(Number) : [0, size];
  const length = Number(/\/Length\s+(\d+)/.exec(dict)![1]);
  let dataStart = streamKw + "stream".length;
  if (text[dataStart] === 0x0d) dataStart++;
  if (text[dataStart] === 0x0a) dataStart++;
  const data = inflateSync(text.subarray(dataStart, dataStart + length));
  const rowLen = widths[0] + widths[1] + widths[2];
  const read = (pos: number, n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + data[pos + i];
    return v;
  };
  let row = 0;
  for (let s = 0; s < index.length; s += 2) {
    for (let k = 0; k < index[s + 1]; k++, row++) {
      const pos = row * rowLen;
      const type = widths[0] === 0 ? 1 : read(pos, widths[0]);
      if (type === 1) entries.set(index[s] + k, read(pos + widths[0], widths[1]));
    }
  }
  return entries;
}

/** Number of `startxref` keywords, i.e. of cross-reference sections the file ends up with. */
export function countStartXref(bytes: Uint8Array): number {
  return Buffer.from(bytes).toString("latin1").split("startxref").length - 1;
}

const loadDoc = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false });

/** Appends an update as another program would: sets `/Info /Title` (creating `/Info` if needed). */
export async function appendForeignUpdate(bytes: Uint8Array, title = "Edited elsewhere"): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const ctx = doc.context;
  reserveObjectNumbers(bytes, ctx);
  let info = ctx.trailerInfo.Info;
  if (info instanceof PDFRef) {
    ctx.lookup(info, PDFDict).set(PDFName.of("Title"), PDFHexString.fromText(title));
  } else {
    info = ctx.register(ctx.obj({ Title: PDFHexString.fromText(title) }));
    ctx.trailerInfo.Info = info;
  }
  return writeIncrementalUpdate(bytes, ctx, [info as PDFRef]).bytes;
}

/** Removes `/SMV_Data` from our stamp on the first marked page, via a foreign incremental update. */
export async function stripSmvData(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  reserveObjectNumbers(bytes, doc.context);
  const { annotRef } = readMarkup(doc).pages[0];
  doc.context.lookup(annotRef, PDFDict).delete(PDFName.of(SMV_DATA_KEY));
  return writeIncrementalUpdate(bytes, doc.context, [annotRef]).bytes;
}

/** pdf.js' id of an annotation that is an indirect object (`Ref.toString()`). */
export const pdfjsId = (ref: PDFRef) =>
  ref.generationNumber === 0 ? `${ref.objectNumber}R` : `${ref.objectNumber}R${ref.generationNumber}`;

/**
 * Per page, every annotation pdf.js sees. pdf.js 6.5 does not expose `/NM`, so `isOurs` matches the
 * annotation's id against the refs of our valid stamps found by `readMarkup`.
 */
export async function annotationsPerPage(
  bytes: Uint8Array,
): Promise<{ subtype: string; rect: number[]; isOurs: boolean }[][]> {
  const ours = new Set(readMarkup(await loadDoc(bytes)).pages.map((p) => pdfjsId(p.annotRef)));
  const { value } = await inspectWithPdfjs(bytes, async (doc) => {
    const pages: { subtype: string; rect: number[]; isOurs: boolean }[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const annots = (await (await doc.getPage(p)).getAnnotations()) as { subtype: string; rect: number[]; id: string }[];
      pages.push(annots.map((a) => ({ subtype: a.subtype, rect: a.rect, isOurs: ours.has(a.id) })));
    }
    return pages;
  });
  return value;
}

/** A page entry for `saveMarkupToFile`: `payload(page)` plus a tiny PNG as Base64. */
export const pageChange = (page: number) => ({
  page,
  payload: payload(page),
  pngBase64: Buffer.from(makePng(4, 4)).toString("base64"),
});
export const page1 = () => pageChange(1);
export const page2 = () => pageChange(2);

/** Writes `bytes` to `dir/name` and returns the path. */
export async function writeFixture(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  const file = path.join(dir, name);
  await fs.promises.writeFile(file, bytes);
  return file;
}
