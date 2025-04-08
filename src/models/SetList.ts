import { type SheetFile } from "./SheetFile";

export interface SetList {
  id: number;
  name: string;
  sheets: SheetFile[];
}

import { z } from "zod"

export const sheetFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  isFile: z.boolean(),
  isSearch: z.boolean()
})

export const setListSchema = z.object({
  id: z.number(),
  name: z.string(),
  sheets: z.array(sheetFileSchema)
})
