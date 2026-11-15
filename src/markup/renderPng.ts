import * as fabric from "fabric";
import * as fontfaceobserver from "fontfaceobserver";
import type { MarkupPayload } from "../models/markup";
import { pngMultiplier } from "./fabricTransform";

/** Renders a payload to a transparent PNG (Base64 without `data:` prefix). DOM only. */
export async function renderMarkupPng(payload: MarkupPayload): Promise<string> {
  await new fontfaceobserver.default("notoIcons").load();
  const canvas = new fabric.StaticCanvas(undefined, {
    width: payload.width,
    height: payload.height,
    backgroundColor: "",
    renderOnAddRemove: false,
  });
  try {
    await canvas.loadFromJSON(payload.fabric);
    canvas.renderAll();
    const url = canvas.toDataURL({
      format: "png",
      multiplier: pngMultiplier(payload.width, payload.height),
    });
    return url.replace(/^data:image\/png;base64,/, "");
  } finally {
    canvas.dispose();
  }
}
