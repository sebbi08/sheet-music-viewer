import { createRequire } from "node:module";
import path from "node:path";
import { getDocument, VerbosityLevel, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { vi } from "vitest";

// pdf.js in Node reads these with fs, so plain directory paths keep it offline (see tests/visual/pdfRender.ts).
const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const assetDir = (name: string) => path.join(pdfjsRoot, name) + path.sep;

/**
 * Opens `bytes` with pdf.js (like another viewer would), runs `inspect` on the document and closes it.
 * `recovered` is true if pdf.js had to fall back to indexing all objects because the xref chain was
 * unusable (detected from its console warnings).
 */
export async function inspectWithPdfjs<T>(
  bytes: Uint8Array,
  inspect: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<{ value: T; recovered: boolean }> {
  const warnings: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((msg: unknown) => void warnings.push(String(msg)));
  const task = getDocument({
    data: bytes.slice(), // pdf.js detaches the buffer
    wasmUrl: assetDir("wasm"),
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetDir("standard_fonts"),
    verbosity: VerbosityLevel.WARNINGS,
  });
  try {
    const value = await inspect(await task.promise);
    return { value, recovered: warnings.some((w) => /Indexing all PDF objects|xref/i.test(w)) };
  } finally {
    await task.destroy();
    spy.mockRestore();
  }
}

/** Loads every page and the document info with pdf.js; see {@link inspectWithPdfjs} for `recovered`. */
export async function openWithPdfjs(
  bytes: Uint8Array,
): Promise<{ numPages: number; title: string | undefined; recovered: boolean }> {
  const { value, recovered } = await inspectWithPdfjs(bytes, async (doc) => {
    for (let p = 1; p <= doc.numPages; p++) await doc.getPage(p);
    const { info } = await doc.getMetadata();
    return { numPages: doc.numPages, title: (info as { Title?: string }).Title };
  });
  return { ...value, recovered };
}
