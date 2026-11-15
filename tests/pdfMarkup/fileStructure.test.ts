import { expect, test } from "vitest";
import {
  findLastStartXref,
  getSectionTrailer,
  getXrefKind,
  isValidSectionEnd,
} from "../../src/pdfMarkup/fileStructure";
import { makePdf, readXrefEntries } from "./fixtures";

test("findLastStartXref returns last value", async () => {
  const pdf = await makePdf({ xref: "table" });
  const text = Buffer.from(pdf).toString("latin1");
  expect(findLastStartXref(pdf)).toBe(Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1]));
});

test("findLastStartXref throws without startxref", () => {
  expect(() => findLastStartXref(new Uint8Array([1, 2, 3]))).toThrow();
});

test("isValidSectionEnd", async () => {
  const pdf = await makePdf({ xref: "table" });
  expect(isValidSectionEnd(pdf, pdf.length)).toBe(true);
  expect(isValidSectionEnd(pdf, pdf.length - 10)).toBe(false);
  expect(isValidSectionEnd(pdf, pdf.length + 1)).toBe(false);
  expect(isValidSectionEnd(pdf, 0)).toBe(false);
});

test("isValidSectionEnd accepts trailing line breaks", () => {
  for (const eol of ["", "\r", "\n", "\r\n"]) {
    const bytes = Buffer.from(`x\n%%EOF${eol}`, "latin1");
    expect(isValidSectionEnd(bytes, bytes.length)).toBe(true);
  }
});

test.each(["table", "stream"] as const)("getXrefKind/%s", async (kind) => {
  const pdf = await makePdf({ xref: kind });
  expect(getXrefKind(pdf, findLastStartXref(pdf))).toBe(kind);
  expect(getSectionTrailer(pdf, findLastStartXref(pdf))).toEqual({
    prev: null,
    size: expect.any(Number),
  });
});

test("readXrefEntries offsets point at objects", async () => {
  for (const kind of ["table", "stream"] as const) {
    const pdf = await makePdf({ xref: kind });
    const entries = readXrefEntries(pdf, findLastStartXref(pdf));
    expect(entries.size).toBeGreaterThan(0);
    for (const [num, off] of entries)
      expect(Buffer.from(pdf.subarray(off, off + 20)).toString("latin1")).toMatch(
        new RegExp(`^${num} \\d+ obj`),
      );
  }
});

test("out-of-range offsets fail with a clear error", async () => {
  const pdf = await makePdf({ xref: "table" });
  for (const off of [pdf.length, pdf.length + 100, -1, 1.5]) {
    expect(() => getXrefKind(pdf, off)).toThrow(/outside the file/);
    expect(() => getSectionTrailer(pdf, off)).toThrow(/outside the file/);
  }
});

test("offset near the end does not throw RangeError", async () => {
  const pdf = await makePdf({ xref: "table" });
  expect(getXrefKind(pdf, pdf.length - 3)).toBe("stream");
  expect(() => getSectionTrailer(pdf, pdf.length - 3)).toThrow(/xref stream not found/);
});

test("subarray input never reads neighbouring bytes of the shared buffer", () => {
  const text = "xref\n0 0\ntrailer\n<< /Size 1 >>\nstartxref\n0\n%%EOF";
  const shared = new Uint8Array(Buffer.from(text + " /Prev 999 xref", "latin1"));
  const view = shared.subarray(0, text.length);
  expect(getSectionTrailer(view, 0)).toEqual({ prev: null, size: 1 });
  // A view cut after "xre" must not see the "f" that follows in the shared buffer.
  const cut = new Uint8Array(Buffer.from("xref", "latin1")).subarray(0, 3);
  expect(getXrefKind(cut, 0)).toBe("stream");
  expect(isValidSectionEnd(shared.subarray(0, text.length - 1), text.length - 1)).toBe(false);
  expect(() => findLastStartXref(shared.subarray(0, 20))).toThrow();
});
