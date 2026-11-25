import * as fabric from "fabric";
import type { MarkupPayload } from "../models/markup";
import { MUSIC_FONT_FAMILY } from "../models/markupConstants";
import notoMusicUrl from "../assets/musicIcons/NotoMusic-Regular.ttf?url";
import { pngLayout } from "./fabricTransform";
import { whiteoutFirst } from "./whiteout";

let musicFont: Promise<void> | undefined;

/**
 * Registers the bundled Noto Music as `MUSIC_FONT_FAMILY` (once) and waits until it is loaded, so fabric
 * draws the symbols with it and not with whatever font the system would fall back to. Never rejects: if
 * the font cannot be loaded, fabric draws with a fallback font and the next call tries again.
 */
export function loadMarkupFonts(): Promise<void> {
  musicFont ??= (async () => {
    try {
      const face = new FontFace(MUSIC_FONT_FAMILY, `url(${JSON.stringify(notoMusicUrl)})`);
      document.fonts.add(await face.load());
    } catch (e) {
      musicFont = undefined;
      console.warn("The music font could not be loaded; drawing with a fallback font", e);
    }
  })();
  return musicFont;
}

/** Renders a payload to a transparent PNG (Base64 without `data:` prefix). DOM only. */
export async function renderMarkupPng(payload: MarkupPayload): Promise<string> {
  await loadMarkupFonts();
  // Whole pixels, scaled per axis so the PNG covers exactly payload.width×payload.height points
  // (the PDF stretches it over that rect). Not toDataURL({ multiplier }): its canvas is truncated
  // to whole pixels, and it scales both axes by the x zoom.
  const { pxWidth, pxHeight, scaleX, scaleY } = pngLayout(payload.width, payload.height);
  const canvas = new fabric.StaticCanvas(undefined, {
    width: pxWidth,
    height: pxHeight,
    backgroundColor: "",
    renderOnAddRemove: false,
    enableRetinaScaling: false,
  });
  try {
    // The white pen below every other mark, also in markup saved before that rule.
    await canvas.loadFromJSON({ ...payload.fabric, objects: whiteoutFirst(payload.fabric.objects) });
    canvas.setViewportTransform([scaleX, 0, 0, scaleY, 0, 0]);
    canvas.renderAll();
    const url = canvas.getElement().toDataURL("image/png");
    return url.replace(/^data:image\/png;base64,/, "");
  } finally {
    canvas.dispose();
  }
}
