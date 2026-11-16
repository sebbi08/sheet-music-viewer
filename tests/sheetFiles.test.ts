import { describe, expect, it } from "vitest";
import { isListedSheetEntry } from "../src/sheetFiles";

describe("isListedSheetEntry", () => {
  it("lists pdfs in any spelling", () => {
    expect(isListedSheetEntry("a.pdf", false)).toBe(true);
    expect(isListedSheetEntry("A.PDF", false)).toBe(true);
  });
  it("hides other files and hidden files", () => {
    for (const n of ["Backup.zip", "x.png", ".a.pdf", ".data"]) {
      expect(isListedSheetEntry(n, false)).toBe(false);
    }
  });
  it("lists folders without a leading dot", () => {
    expect(isListedSheetEntry("Weihnachten", true)).toBe(true);
    expect(isListedSheetEntry(".git", true)).toBe(false);
  });
});
