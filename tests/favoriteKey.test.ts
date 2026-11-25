import path from "node:path";
import { describe, expect, test } from "vitest";
import { folderCardKey, rendererSheetKey } from "../src/favoriteKey";
import { sheetKey } from "../src/folderConfig";
import { favoriteSaveFailedText, favoritesUnreadableText } from "../src/store/favoriteTexts";

describe("rendererSheetKey", () => {
  test("below the folder (win32)", () => {
    expect(rendererSheetKey("C:\\Noten", "C:\\Noten\\Pop\\Abba Gold.pdf", path.win32)).toBe("Pop/Abba Gold.pdf");
  });
  test("below the folder (posix)", () => {
    expect(rendererSheetKey("/n", "/n/Pop/Abba Gold.pdf", path.posix)).toBe("Pop/Abba Gold.pdf");
  });
  test("null for the folder itself, outside paths and another drive", () => {
    expect(rendererSheetKey("C:\\Noten", "C:\\Noten", path.win32)).toBeNull();
    expect(rendererSheetKey("C:\\Noten", "C:\\Andere\\a.pdf", path.win32)).toBeNull();
    expect(rendererSheetKey("C:\\Noten", "D:\\Noten\\a.pdf", path.win32)).toBeNull();
    expect(rendererSheetKey("/n", "/n/..", path.posix)).toBeNull();
    expect(rendererSheetKey("/n", "/x/a.pdf", path.posix)).toBeNull();
  });
  test("equals sheetKey", () => {
    const cases: [string, string][] = [
      ["/n", "/n/a.pdf"],
      ["/n", "/n/x/y/a b.pdf"],
      ["/n", "/n"],
      ["/n", "/m/a.pdf"],
      ["/n", "/n/../a.pdf"],
    ];
    for (const [f, p] of cases) expect(rendererSheetKey(f, p, path.posix)).toBe(sheetKey(f, p, path.posix));
  });
});

describe("folderCardKey", () => {
  // The folder view's route path starts and ends with the separator ("/" on the top level).
  test("equals sheetKey of the card's PDF (posix and win32)", () => {
    const cases: [typeof path.posix, string, string, string][] = [
      [path.posix, "/n", "/", "a.pdf"],
      [path.posix, "/n", "/Pop/", "Abba Gold.pdf"],
      [path.posix, "/n/", "/Pop/Sub/", "x y.pdf"],
      [path.posix, "/n", "/Pop", "a.pdf"],
      [path.win32, "C:\\Noten", "\\", "a.pdf"],
      [path.win32, "C:\\Noten", "\\Pop\\Sub\\", "Abba Gold.pdf"],
      [path.win32, "C:\\Noten\\", "\\Pop\\", "a.pdf"],
    ];
    for (const [p, folder, folderPath, name] of cases) {
      const pdfPath = p.join(folder, folderPath, name);
      expect(folderCardKey(folderPath, name, p.sep)).toBe(sheetKey(folder, pdfPath, p));
    }
  });
});

describe("favorite texts", () => {
  test("save failed", () => {
    expect(favoriteSaveFailedText("boom")).toBe("Der Favorit konnte nicht gespeichert werden: boom.");
    expect(favoriteSaveFailedText("boom.")).toBe("Der Favorit konnte nicht gespeichert werden: boom.");
  });
  test("unreadable", () => {
    expect(favoritesUnreadableText(".config.json", "kaputt", false)).toContain("„.config.json“: kaputt");
    expect(favoritesUnreadableText(".config.json", "x", true)).toContain("neueren Version");
  });
});
