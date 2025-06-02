import { z } from "zod";

export const sheetFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  isFile: z.boolean(),
  isSearch: z.boolean(),
});
export type SheetFile = z.infer<typeof sheetFileSchema>;

export const setListSheetSchema = sheetFileSchema.extend({
  path: z.array(z.string()),
})

export type SetListSheet = z.infer<typeof setListSheetSchema>;

export const setListSchema = z.object({
  id: z.number(),
  name: z.string(),
  sheets: z.array(setListSheetSchema),
});

export type SetList = z.infer<typeof setListSchema>;

export const setListSchemaV1 = z.object({
  id: z.number(),
  name: z.string(),
  sheets: z.array(sheetFileSchema),
});
export type SetListV1 = z.infer<typeof setListSchemaV1>;

export const setListsWrapperSchema = z.object({
  version: z.literal(2),
  setLists: z.array(setListSchema),
});
export type SetListsWrapper = z.infer<typeof setListsWrapperSchema>;

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
