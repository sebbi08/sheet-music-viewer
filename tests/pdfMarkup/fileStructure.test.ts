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
