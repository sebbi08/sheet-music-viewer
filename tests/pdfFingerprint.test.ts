import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearFingerprintCache,
  fingerprintFile,
  fingerprintOf,
  originalLength,
} from "../src/pdfFingerprint";
import { saveMarkupToFile } from "../src/pdfMarkup/markupFile";
import { makePdf, page1, page2, writeFixture } from "./pdfMarkup/fixtures";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const append = (bytes: Uint8Array, text: string) => Buffer.concat([bytes, Buffer.from(text, "latin1")]);
const metadataOf = (bytes: Uint8Array) => {
  const matches = [...Buffer.from(bytes).toString("latin1").matchAll(/\/OriginalLength\s+(\d+)\s*\/UpdateStart\s+(\d+)/g)];
  const last = matches[matches.length - 1];
  return { n: Number(last[1]), m: Number(last[2]) };
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-fingerprint-"));
  clearFingerprintCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("fingerprint of a PDF", () => {
  test("a PDF without our markup: the whole file", async () => {
    const bytes = await makePdf({ pages: 1 });
    expect(originalLength(bytes)).toBe(bytes.length);
    expect(fingerprintOf(bytes)).toEqual({ sha256: sha256(bytes), length: bytes.length });
  });

  test("saving markup keeps the fingerprint", async () => {
    const before = await makePdf({ pages: 2 });
    const pdf = await writeFixture(dir, "a.pdf", before);
    const fingerprint = fingerprintOf(before);

    await saveMarkupToFile({ path: pdf, pages: [page1()] });
    const afterFirst = fs.readFileSync(pdf);
    expect(afterFirst.length).toBeGreaterThan(before.length);
    expect(fingerprintOf(afterFirst)).toEqual(fingerprint);

    await saveMarkupToFile({ path: pdf, pages: [page2()] });
    const afterSecond = fs.readFileSync(pdf);
    expect(afterSecond.equals(afterFirst)).toBe(false);
    expect(fingerprintOf(afterSecond)).toEqual(fingerprint);
    expect(originalLength(afterSecond)).toBe(before.length);
  });

  test("an update of another program that keeps our metadata keeps it", async () => {
    const before = await makePdf({ pages: 1 });
    const pdf = await writeFixture(dir, "a.pdf", before);
    await saveMarkupToFile({ path: pdf, pages: [page1()] });
    const saved = fs.readFileSync(pdf);
    const { n, m } = metadataOf(saved);
    const updated = append(saved, `\n99 0 obj\n<< /OriginalLength ${n} /UpdateStart ${m} >>\nendobj\n%%EOF\n`);
    expect(fingerprintOf(updated)).toEqual(fingerprintOf(before));
  });

  test("an invalid OriginalLength is ignored", async () => {
    const plain = await makePdf({ pages: 1 });
    const bytes = append(plain, "<< /OriginalLength 7 /UpdateStart 9 >>");
    expect(originalLength(bytes)).toBe(bytes.length);
  });

  test("the last valid match wins", async () => {
    const base = await makePdf({ pages: 1 });
    const first = append(base, `\n<< /OriginalLength ${base.length} /UpdateStart ${base.length} >>\n%%EOF\n`);
    const second = append(first, `\n<< /OriginalLength ${first.length} /UpdateStart ${first.length} >>\n`);
    expect(originalLength(second)).toBe(first.length);
    // A later invalid block does not hide the last valid one.
    expect(originalLength(append(second, "<< /OriginalLength 3 /UpdateStart 4 >>"))).toBe(first.length);
  });

  test("UpdateStart beyond the file or before OriginalLength is invalid", async () => {
    const base = await makePdf({ pages: 1 });
    expect(originalLength(append(base, `<< /OriginalLength ${base.length} /UpdateStart 99999999 >>`))).toBe(
      base.length + `<< /OriginalLength ${base.length} /UpdateStart 99999999 >>`.length,
    );
    const before = append(base, `<< /OriginalLength ${base.length} /UpdateStart ${base.length - 1} >>`);
    expect(originalLength(before)).toBe(before.length);
  });

  test("different PDFs differ", async () => {
    const a = fingerprintOf(await makePdf({ pages: 1 }));
    const b = fingerprintOf(await makePdf({ pages: 2 }));
    expect(a).not.toEqual(b);
  });

  test("fingerprintFile caches by real path, size and mtime", async () => {
    const one = await makePdf({ pages: 1 });
    const pdf = await writeFixture(dir, "a.pdf", one);
    const readFile = vi.spyOn(fs.promises, "readFile");
    const reads = () => readFile.mock.calls.filter(([f]) => String(f) === pdf).length;

    expect(await fingerprintFile(pdf)).toEqual(fingerprintOf(one));
    expect(await fingerprintFile(pdf)).toEqual(fingerprintOf(one));
    expect(reads()).toBe(1);

    const link = path.join(dir, "link.pdf");
    fs.symlinkSync(pdf, link);
    await fingerprintFile(link);
    expect(reads()).toBe(1);

    const two = await makePdf({ pages: 2 });
    await fs.promises.writeFile(pdf, two);
    expect(await fingerprintFile(pdf)).toEqual(fingerprintOf(two));
    expect(reads()).toBe(2);
  });

  test("fingerprintFile throws on I/O errors", async () => {
    await expect(fingerprintFile(path.join(dir, "missing.pdf"))).rejects.toThrow();
  });
});
