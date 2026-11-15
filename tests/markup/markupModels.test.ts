import { describe, expect, test } from "vitest";
import { pdfPathSchema, saveMarkupInputSchema } from "../../src/models/markup";

describe("pdfPathSchema (tRPC inputs of loadMarkup/saveMarkup)", () => {
  test.each([
    "/home/user/Noten/Song.pdf",
    "/x/UPPER.PDF",
    "C:\\Users\\Me\\Noten\\Song.pdf",
    "d:/Noten/Song.Pdf",
    "\\\\server\\share\\Song.pdf",
  ])("accepts %s", (p) => {
    expect(pdfPathSchema.safeParse(p).success).toBe(true);
  });

  test.each([
    "",
    "Song.pdf",
    "Noten/Song.pdf",
    "./Song.pdf",
    "..\\Song.pdf",
    "C:Song.pdf",
    "/home/user/Noten/.Song.data",
    "/home/user/Noten/Song.pdf.exe",
    "/home/user/Noten/Song",
    "/home/user/evil\0.pdf",
  ])("rejects %j", (p) => {
    expect(pdfPathSchema.safeParse(p).success).toBe(false);
  });

  test("saveMarkup input rejects a relative path", () => {
    expect(saveMarkupInputSchema.safeParse({ path: "a.pdf", pages: [], deleteLegacySidecar: false }).success).toBe(false);
    expect(saveMarkupInputSchema.safeParse({ path: "/a.pdf", pages: [], deleteLegacySidecar: false }).success).toBe(true);
  });
});
