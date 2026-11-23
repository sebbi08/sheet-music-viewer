import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { FIT_VIEW, type ZoomView } from "./editZoom";

/** Wait after the last change of the view before the visible area is rendered sharply. */
export const SHARP_RENDER_DELAY_MS = 200;

type OptionalContentConfig = Awaited<ReturnType<PDFDocumentProxy["getOptionalContentConfig"]>>;

export interface ZoomPageRenderer {
  /** Shows `view` at once (the page canvas and the last sharp picture, scaled onto the picture canvas)
   *  and renders the visible area sharply SHARP_RENDER_DELAY_MS after the last call; a newer call cancels
   *  a running render (RenderTask.cancel) and a result for an older view is never shown. */
  show(view: ZoomView): void;
  /** Back to the whole page: hides the picture, cancels pending work. */
  hide(): void;
  dispose(): void;
}

/** A picture of the page as shown at `view`: its pixel u lies at screen CSS px u / scale. */
interface Picture {
  canvas: HTMLCanvasElement;
  view: ZoomView;
  scaleX: number;
  scaleY: number;
}

/**
 * The page under the zoomed edit canvas (spec 2026-11-23-edit-zoom, "Seite"): a canvas of the page canvas's
 * CSS size at screen resolution that shows the visible area. While the view changes it is drawn at once from
 * the page canvas and the last sharp render, scaled to the new view (instead of a CSS transform, so nothing
 * reaches beyond the page and areas the last render did not cover show the page canvas, not a gap);
 * SHARP_RENDER_DELAY_MS after the last change pdf.js renders exactly the visible area.
 */
export function createZoomPageRenderer(opts: {
  container: HTMLElement;
  pageCanvas: HTMLCanvasElement;
  page: PDFPageProxy;
  optionalContentConfig?: OptionalContentConfig;
  devicePixelRatio: number;
}): ZoomPageRenderer {
  const { container, pageCanvas, page, optionalContentConfig } = opts;
  const dpr = opts.devicePixelRatio;
  let picture: HTMLCanvasElement | null = null;
  let sharp: Picture | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let task: RenderTask | null = null;
  /** Counts the views shown: a render finishing for an older one is dropped. */
  let generation = 0;
  let disposed = false;

  const cssSize = () => ({
    width: parseFloat(pageCanvas.style.width) || 0,
    height: parseFloat(pageCanvas.style.height) || 0,
  });

  function ensurePicture(): HTMLCanvasElement {
    if (picture) return picture;
    const { width, height } = cssSize();
    const canvas = document.createElement("canvas");
    canvas.className = "pageCanvas pageVisible zoomPageCanvas";
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = pageCanvas.style.width;
    canvas.style.height = pageCanvas.style.height;
    canvas.style.zIndex = String((parseInt(pageCanvas.style.zIndex, 10) || 0) + 1);
    canvas.dataset.zoom = "";
    container.appendChild(canvas);
    picture = canvas;
    return canvas;
  }

  /** Draws `source` onto the picture's context as it looks at `view`. */
  function draw(context: CanvasRenderingContext2D, source: Picture, view: ZoomView): void {
    const k = view.zoom / source.view.zoom;
    context.setTransform(
      (dpr * k) / source.scaleX,
      0,
      0,
      (dpr * k) / source.scaleY,
      dpr * (view.x - source.view.x * k),
      dpr * (view.y - source.view.y * k),
    );
    context.drawImage(source.canvas, 0, 0);
  }

  function cancelRender(): void {
    clearTimeout(timer);
    timer = undefined;
    task?.cancel();
    task = null;
  }

  function renderSharp(view: ZoomView, shown: number): void {
    if (!picture) return;
    const target = picture;
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const scale = (cssSize().width / page.getViewport({ scale: 1 }).width) * view.zoom * dpr;
    const renderTask = page.render({
      canvas,
      viewport: page.getViewport({ scale }),
      transform: [1, 0, 0, 1, view.x * dpr, view.y * dpr],
      background: "#ffffff",
      // The same settings as the page itself: our stamps stay hidden.
      optionalContentConfigPromise: optionalContentConfig ? Promise.resolve(optionalContentConfig) : undefined,
    });
    task = renderTask;
    renderTask.promise.then(
      () => {
        if (task === renderTask) task = null;
        if (shown !== generation || picture !== target) return;
        sharp = { canvas, view, scaleX: dpr, scaleY: dpr };
        const context = target.getContext("2d");
        if (!context) return;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(canvas, 0, 0);
        target.dataset.zoom = String(view.zoom);
      },
      (error: unknown) => {
        if (task === renderTask) task = null;
        if ((error as { name?: string } | null)?.name !== "RenderingCancelledException") {
          console.warn("Could not render the zoomed page", error);
        }
      },
    );
  }

  function hide(): void {
    generation++;
    cancelRender();
    picture?.remove();
    picture = null;
    sharp = null;
  }

  return {
    show(view) {
      if (disposed) return;
      const shown = ++generation;
      cancelRender();
      const canvas = ensurePicture();
      canvas.dataset.zoom = "";
      const context = canvas.getContext("2d");
      if (context) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const { width, height } = cssSize();
        if (width > 0 && height > 0) {
          const page = { canvas: pageCanvas, view: FIT_VIEW, scaleX: pageCanvas.width / width, scaleY: pageCanvas.height / height };
          draw(context, page, view);
        }
        if (sharp) draw(context, sharp, view);
      }
      timer = setTimeout(() => renderSharp(view, shown), SHARP_RENDER_DELAY_MS);
    },
    hide,
    dispose() {
      hide();
      disposed = true;
    },
  };
}
