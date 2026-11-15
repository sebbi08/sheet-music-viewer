/**
 * Byte-level helpers for inspecting the structure at the end of a PDF file
 * (startxref, %%EOF, xref section kind, trailer /Prev and /Size).
 * PDF structure is ASCII, so all text is decoded as latin1.
 */

const TAIL_WINDOW = 4096;

function latin1(bytes: Uint8Array, start: number, end: number): string {
  const e = Math.min(Math.max(0, end), bytes.length);
  const s = Math.min(Math.max(0, start), e);
  return Buffer.from(bytes.buffer, bytes.byteOffset + s, e - s).toString("latin1");
}

function assertOffset(bytes: Uint8Array, offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length)
    throw new Error(`xref offset ${offset} is outside the file`);
}

/** Value of the last `startxref` in the file. Throws if there is none. */
export function findLastStartXref(bytes: Uint8Array): number {
  const text = latin1(bytes, Math.max(0, bytes.length - TAIL_WINDOW), bytes.length);
  const idx = text.lastIndexOf("startxref");
  if (idx < 0) throw new Error("startxref not found");
  const match = /^startxref\s+(\d+)/.exec(text.slice(idx));
  if (!match) throw new Error("startxref has no offset");
  return Number(match[1]);
}

/** PDF whitespace: NUL, TAB, LF, FF, CR, SPACE. */
const isWhitespace = (byte: number) =>
  byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;

/**
 * True if `0 < length <= bytes.length` and `bytes[0..length)` ends with `%%EOF`, optionally followed by
 * any run of PDF whitespace (real files often carry extra line breaks or NUL padding after it).
 */
export function isValidSectionEnd(bytes: Uint8Array, length: number): boolean {
  if (!Number.isInteger(length) || length <= 0 || length > bytes.length) return false;
  let end = length;
  while (end > 0 && isWhitespace(bytes[end - 1])) end--;
  return end >= 5 && latin1(bytes, end - 5, end) === "%%EOF";
}

/** `table` if an `xref` keyword (after whitespace) stands at `offset`, otherwise `stream`. */
export function getXrefKind(bytes: Uint8Array, offset: number): "table" | "stream" {
  assertOffset(bytes, offset);
  return /^\s*xref/.test(latin1(bytes, offset, offset + 32)) ? "table" : "stream";
}

/** Reads `/Prev` and `/Size` from the trailer (table) or xref stream dictionary (stream). */
export function getSectionTrailer(
  bytes: Uint8Array,
  offset: number,
): { prev: number | null; size: number } {
  const text = latin1(bytes, offset, bytes.length);
  let dict: string;
  if (getXrefKind(bytes, offset) === "table") {
    const start = text.indexOf("trailer");
    if (start < 0) throw new Error("trailer not found");
    const end = text.indexOf("startxref", start);
    dict = text.slice(start, end < 0 ? undefined : end);
  } else {
    const end = text.indexOf("stream");
    if (end < 0) throw new Error("xref stream not found");
    dict = text.slice(0, end);
  }
  const size = /\/Size\s+(\d+)/.exec(dict);
  if (!size) throw new Error("/Size not found");
  const prev = /\/Prev\s+(\d+)/.exec(dict);
  return { prev: prev ? Number(prev[1]) : null, size: Number(size[1]) };
}
