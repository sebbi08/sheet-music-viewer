/**
 * Appends an incremental update to a PDF without touching its bytes: the given objects as
 * `N G obj … endobj`, a new cross-reference section (classic table or xref stream, matching the
 * base's last section) and a trailer whose `/Prev` points at the base's last section.
 *
 * The objects come from a pdf-lib context loaded from the same base
 * (`PDFDocument.load(base, { updateMetadata: false })`); pdf-lib itself can only rewrite whole files.
 */
import { PDFCrossRefStream, type PDFContext, type PDFObject, type PDFRef } from "pdf-lib";
import { findLastStartXref, getSectionTrailer, getXrefKind } from "./fileStructure";

const LF = 0x0a;
const CR = 0x0d;

/** ASCII-only text to bytes (all PDF syntax we write here is ASCII). */
function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function serialize(object: PDFObject): Uint8Array {
  const out = new Uint8Array(object.sizeInBytes());
  object.copyBytesInto(out, 0);
  return out;
}

/** Collects the chunks of the update and tracks absolute offsets in the resulting file. */
class Appender {
  readonly chunks: Uint8Array[] = [];
  constructor(public position: number) {}

  push(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.position += chunk.length;
  }

  /** Writes `N G obj\n<object>\nendobj\n` and returns the offset of its first byte. */
  pushIndirect(ref: PDFRef, object: PDFObject): number {
    const offset = this.position;
    this.push(ascii(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    this.push(serialize(object));
    this.push(ascii("\nendobj\n"));
    return offset;
  }
}

/** `/Size` of the base's last cross-reference section (covers all object numbers ever used). */
function previousSize(base: Uint8Array): number {
  return getSectionTrailer(base, findLastStartXref(base)).size;
}

/**
 * Makes sure new objects (`context.nextRef()`, `context.register()`) get numbers that are unused in
 * every section of the base, including free entries and objects pdf-lib does not register (such as
 * xref streams). Call before creating new objects.
 */
export function reserveObjectNumbers(base: Uint8Array, context: PDFContext): void {
  context.largestObjectNumber = Math.max(context.largestObjectNumber, previousSize(base) - 1);
}

/** Classic `xref` table with one subsection per run of consecutive numbers. */
function xrefTable(entries: [PDFRef, number][]): Uint8Array {
  let text = "xref\n";
  for (let i = 0; i < entries.length; ) {
    let end = i + 1;
    while (end < entries.length && entries[end][0].objectNumber === entries[end - 1][0].objectNumber + 1) end++;
    text += `${entries[i][0].objectNumber} ${end - i}\n`;
    for (; i < end; i++) {
      const [ref, offset] = entries[i];
      text += `${String(offset).padStart(10, "0")} ${String(ref.generationNumber).padStart(5, "0")} n\r\n`;
    }
  }
  return ascii(text);
}

/**
 * Returns `base` + (`\n` if `base` does not end with a line break) + the objects `refs` (ascending by
 * number) + cross-reference section + trailer + `startxref` + `%%EOF\n`, and the absolute offset of
 * every written object. The xref kind follows the base's last section; for an xref stream the stream
 * gets its own number from `context.nextRef()` and an entry for itself.
 */
export function writeIncrementalUpdate(
  base: Uint8Array,
  context: PDFContext,
  refs: PDFRef[],
): { bytes: Uint8Array; offsets: Map<number, number> } {
  if (context.trailerInfo.Encrypt) throw new Error("cannot write an incremental update to an encrypted PDF");
  if (refs.length === 0) throw new Error("incremental update needs at least one object");

  const prev = findLastStartXref(base);
  const kind = getXrefKind(base, prev);
  const prevSize = getSectionTrailer(base, prev).size;

  const unique = new Map<number, PDFRef>();
  for (const ref of refs) {
    const seen = unique.get(ref.objectNumber);
    if (seen && seen !== ref) throw new Error(`conflicting refs ${seen} and ${ref}`);
    unique.set(ref.objectNumber, ref);
  }
  const sorted = [...unique.values()].sort((a, b) => a.objectNumber - b.objectNumber);

  const out = new Appender(base.length);
  const last = base[base.length - 1];
  if (last !== LF && last !== CR) out.push(ascii("\n"));

  const entries: [PDFRef, number][] = [];
  const offsets = new Map<number, number>();
  for (const ref of sorted) {
    const object = context.lookup(ref);
    if (object === undefined) throw new Error(`object ${ref} is not in the context`);
    const offset = out.pushIndirect(ref, object);
    entries.push([ref, offset]);
    offsets.set(ref.objectNumber, offset);
  }

  const { Root, Info, ID } = context.trailerInfo;
  const xrefOffset = out.position;
  if (kind === "table") {
    const size = Math.max(prevSize, sorted[sorted.length - 1].objectNumber + 1);
    out.push(xrefTable(entries));
    out.push(ascii("trailer\n"));
    out.push(serialize(context.obj({ Size: size, Prev: prev, Root, Info, ID })));
    out.push(ascii("\n"));
  } else {
    reserveObjectNumbers(base, context); // in case the caller did not, keep the stream's number unused
    const xrefRef = context.nextRef();
    const size = Math.max(prevSize, xrefRef.objectNumber + 1);
    const dict = context.obj({ Size: size, Prev: prev, Root, Info, ID });
    // Without the free entry for object 0 that PDFCrossRefStream.create() would add.
    const stream = PDFCrossRefStream.of(dict, [], true);
    // computeIndex() expects ascending numbers; the xref stream's number is the largest.
    for (const [ref, offset] of entries) stream.addUncompressedEntry(ref, offset);
    stream.addUncompressedEntry(xrefRef, xrefOffset);
    out.pushIndirect(xrefRef, stream);
  }
  out.push(ascii(`startxref\n${xrefOffset}\n%%EOF\n`));

  const bytes = new Uint8Array(out.position);
  bytes.set(base, 0);
  let pos = base.length;
  for (const chunk of out.chunks) {
    bytes.set(chunk, pos);
    pos += chunk.length;
  }
  return { bytes, offsets };
}
