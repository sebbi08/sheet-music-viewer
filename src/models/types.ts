export interface SheetFile {
  path: string;
  name: string;
  isFile: boolean;
  isSearch: boolean;
}

export interface SetList {
  id: number;
  name: string;
  sheets: SheetFile[];
}

import { z } from "zod";

export const sheetFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  isFile: z.boolean(),
  isSearch: z.boolean(),
});

export const setListSchema = z.object({
  id: z.number(),
  name: z.string(),
  sheets: z.array(sheetFileSchema),
});
export interface OverlayData {
  page: number;
  data: object;
  dataUrl?: string;
  drawHeight: number;
  drawWidth: number;
}
export interface EditState {
  drawingMode: boolean;
  interactiveMode: boolean;
  pencilMode: boolean;
  color: Color;
  thickness: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
}

export interface UpdateData {
  releaseDate: Date;
  releaseName: string;
  releaseNotes: string;
}
