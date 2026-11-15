import { createCanvas } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import path from "node:path";
import { AnnotationMode, getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Img } from "./imageCompare";

// pdf.js in Node reads these with fs, so plain directory paths (with trailing separator) keep it offline.
const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const assetDir = (name: string) => path.join(pdfjsRoot, name) + path.sep;

/**
 * Renders one page (1-based) with pdf.js at `cssWidth` pixels wide on a white background,
 * the way another PDF viewer would show it.
 */
export async function renderPdfPage(
  bytes: Uint8Array,
  page: number,
  cssWidth: number,
  opts: { hideOcgNamed?: string; annotations: boolean },
): Promise<Img> {
  const loadingTask = getDocument({
    data: bytes.slice(), // pdf.js takes ownership of (detaches) the buffer
    wasmUrl: assetDir("wasm"),
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetDir("standard_fonts"),
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const doc = await loadingTask.promise;
    const pdfPage = await doc.getPage(page);
    const viewport = pdfPage.getViewport({ scale: cssWidth / pdfPage.getViewport({ scale: 1 }).width });
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);
    const canvas = createCanvas(width, height);

    const optionalContentConfig = await doc.getOptionalContentConfig();
    if (opts.hideOcgNamed !== undefined) {
      for (const [id, group] of optionalContentConfig) {
        if (group.name === opts.hideOcgNamed) optionalContentConfig.setVisibility(id, false);
      }
    }

    await pdfPage.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
      background: "#ffffff",
      annotationMode: opts.annotations ? AnnotationMode.ENABLE : AnnotationMode.DISABLE,
      optionalContentConfigPromise: Promise.resolve(optionalContentConfig),
    }).promise;

    const pixels = canvas.getContext("2d").getImageData(0, 0, width, height).data;
    return { width, height, data: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) };
  } finally {
    await loadingTask.destroy();
  }
}
