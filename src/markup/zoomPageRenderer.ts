import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { FIT_VIEW, type Size, type ZoomView } from "./editZoom";

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
 * The page under the zoomed edit canvas (spec 2026-11-23-edit-zoom, "Seite"): a canvas of the edit canvas's
 * CSS size and position at screen resolution that shows the visible area. The page is laid out on it the
 * way markup is saved (`payloadFromCanvas`): a fraction f of the page lies at canvas point f * canvasSize,
 * each axis on its own, then the view applies. So a mark lies on the page exactly where it is seen zoomed,
 * although the page canvas itself has a fractional CSS size and the edit canvas a whole-pixel one. While the view changes it is drawn at once from
 * the page canvas and the last sharp render, scaled to the new view (instead of a CSS transform, so nothing
 * reaches beyond the page and areas the last render did not cover show the page canvas, not a gap);
 * SHARP_RENDER_DELAY_MS after the last change pdf.js renders exactly the visible area.
 */
export function createZoomPageRenderer(opts: {
  /**
   * The edit canvas's `.canvas-container`: the picture is inserted right before it with its z-index, so it
   * lies below the edit canvas (same z-index, earlier in the DOM) and so below the buttons, and above the
   * page canvases (inserted after them, z-index not below theirs while edit mode works at all).
   */
  editContainer: HTMLElement;
  /** The current page canvas: the first picture. */
  pageCanvas: HTMLCanvasElement;
  /** CSS size of the edit canvas (= its canvas points at 1x); the picture has this size. */
  canvasSize: Size;
  page: PDFPageProxy;
  optionalContentConfig?: OptionalContentConfig;
  devicePixelRatio: number;
}): ZoomPageRenderer {
  const { editContainer, pageCanvas, page, optionalContentConfig, canvasSize } = opts;
  const dpr = opts.devicePixelRatio;
  let picture: HTMLCanvasElement | null = null;
  let sharp: Picture | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let task: RenderTask | null = null;
  /** Counts the views shown: a render finishing for an older one is dropped. */
  let generation = 0;
  let disposed = false;

  function ensurePicture(): HTMLCanvasElement {
    if (picture) return picture;
    const { width, height } = canvasSize;
    const canvas = document.createElement("canvas");
    canvas.className = "pageCanvas pageVisible zoomPageCanvas";
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    // Centred like the edit canvas (class pageCanvas), so it lies exactly under it.
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.style.zIndex = getComputedStyle(editContainer).zIndex;
    canvas.dataset.zoom = "";
    editContainer.before(canvas);
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
    // Device px per point on each axis: page fraction f -> canvas point f * canvasSize -> screen.
    const page1 = page.getViewport({ scale: 1 });
    const scaleX = (canvasSize.width / page1.width) * view.zoom * dpr;
    const scaleY = (canvasSize.height / page1.height) * view.zoom * dpr;
    const renderTask = page.render({
      canvas,
      viewport: page.getViewport({ scale: scaleY }),
      transform: [scaleX / scaleY, 0, 0, 1, view.x * dpr, view.y * dpr],
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
        const { width, height } = canvasSize;
        if (width > 0 && height > 0) {
          // The page canvas holds the whole page: at 1x it spans exactly the edit canvas.
          const whole = { canvas: pageCanvas, view: FIT_VIEW, scaleX: pageCanvas.width / width, scaleY: pageCanvas.height / height };
          draw(context, whole, view);
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
