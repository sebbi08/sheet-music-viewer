import { inflateSync, deflateSync, crc32 } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, StandardFonts, degrees } from "pdf-lib";

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

/** Opaque-gradient RGBA PNG of the given size, built without extra dependencies. */
export function makePng(w: number, h: number): Uint8Array {
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
      raw[p + 3] = 255;
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
