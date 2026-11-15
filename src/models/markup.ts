import { z } from "zod";

/** `[x0, y0, x1, y1]` in PDF user space, normalized so that x0 < x1 and y0 < y1. */
export type Rect = [number, number, number, number];

/**
 * fabric data of one page. `width`/`height` are the displayed page size in points (pdf.js viewport at
 * scale 1, rotation included); the fabric coordinates refer to it.
 */
export const markupPayloadSchema = z.object({
  version: z.literal(1),
  width: z.number().positive(),
  height: z.number().positive(),
  fabric: z.object({ objects: z.array(z.unknown()) }).passthrough(),
});
export type MarkupPayload = z.infer<typeof markupPayloadSchema>;

export interface LoadedMarkupPage {
  page: number;
  /** `null` = the whole visible page. */
  rect: Rect | null;
  payload: MarkupPayload;
}

export interface LoadMarkupResult {
  source: "pdf" | "sidecar" | "none";
  pages: LoadedMarkupPage[];
  legacyOverlayData: string | null;
}

/**
 * Absolute path of a PDF file: POSIX (`/…`), Windows drive (`C:\…`, `C:/…`) or UNC (`\\server\…`), ending
 * in `.pdf` (any case). Checked without `node:path`, because the renderer uses this module too.
 */
export const pdfPathSchema = z
  .string()
  .refine((p) => !p.includes("\0") && /^(\/|[A-Za-z]:[\\/]|\\\\[^\\])/.test(p) && /\.pdf$/i.test(p), {
    message: "expected an absolute path to a .pdf file",
  });

export const saveMarkupInputSchema = z.object({
  path: pdfPathSchema,
  pages: z.array(
    z.object({
      page: z.number().int().positive(),
      payload: markupPayloadSchema.nullable(),
      pngBase64: z.string().nullable(),
    }),
  ),
  deleteLegacySidecar: z.boolean(),
});
export type SaveMarkupInput = z.infer<typeof saveMarkupInputSchema>;

export interface SaveMarkupResult {
  status: "pdf" | "sidecar" | "error";
  message?: string;
}

export const sidecarV1Schema = z.object({
  version: z.literal(1),
  pages: z.array(z.object({ page: z.number().int().positive(), payload: markupPayloadSchema })),
});
