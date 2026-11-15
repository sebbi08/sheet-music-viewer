import * as fabric from "fabric";
import * as fontfaceobserver from "fontfaceobserver";
import type { MarkupPayload } from "../models/markup";
import { pngLayout } from "./fabricTransform";

/** Renders a payload to a transparent PNG (Base64 without `data:` prefix). DOM only. */
export async function renderMarkupPng(payload: MarkupPayload): Promise<string> {
  await new fontfaceobserver.default("notoIcons").load();
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
    await canvas.loadFromJSON(payload.fabric);
    canvas.setViewportTransform([scaleX, 0, 0, scaleY, 0, 0]);
    canvas.renderAll();
    const url = canvas.getElement().toDataURL("image/png");
    return url.replace(/^data:image\/png;base64,/, "");
  } finally {
    canvas.dispose();
  }
}
