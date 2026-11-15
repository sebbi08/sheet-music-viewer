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
 *
 * The image is the rendered size rounded to whole pixels.
 */
export async function renderPdfPage(
  bytes: Uint8Array,
  page: number,
  cssWidth: number,
  opts: { hideOcgNamed?: string; annotations: boolean },
): Promise<Img> {
  return render(bytes, page, (viewport) => {
    const scale = cssWidth / viewport.width;
    return { scale, width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale) };
  }, opts);
}

/**
 * Renders one page like the app shows it in a capture (`Capture.cssSize` from electronDriver): drawn
 * at the unrounded CSS width, the image is the CSS size rounded down to whole pixels. Pixel and mask
 * comparisons with captures of the app then line up exactly, without a 1 px size or scale difference.
 */
export async function renderPdfPageAsCaptured(
  bytes: Uint8Array,
  page: number,
  cssSize: { width: number; height: number },
  opts: { hideOcgNamed?: string; annotations: boolean },
): Promise<Img> {
  return render(bytes, page, (viewport) => ({
    scale: cssSize.width / viewport.width,
    width: Math.floor(cssSize.width),
    height: Math.floor(cssSize.height),
  }), opts);
}

async function render(
  bytes: Uint8Array,
  page: number,
  layout: (scale1: { width: number; height: number }) => { scale: number; width: number; height: number },
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
    const { scale, width, height } = layout(pdfPage.getViewport({ scale: 1 }));
    const viewport = pdfPage.getViewport({ scale });
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
