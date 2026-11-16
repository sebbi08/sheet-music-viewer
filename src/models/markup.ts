import { z } from "zod";

/** `[x0, y0, x1, y1]` in PDF user space, normalized so that x0 < x1 and y0 < y1. */
export type Rect = [number, number, number, number];

/**
 * fabric data of one page. `width`/`height` are the displayed page size in points (pdf.js viewport at
 * scale 1, rotation included); the fabric coordinates refer to it. `rotation` is the page's display
 * rotation when it was saved; if another program turns the page later, the app turns the markup with it
 * (`rotatePayload`). Payloads saved before the field existed have none: no correction.
 */
export const markupPayloadSchema = z.object({
  version: z.literal(1),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
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
  /** Why the PDF's own markup cannot be read (`null`: the PDF is parseable and not encrypted). */
  pdfIssue: "encrypted" | "unparseable" | null;
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

export type SaveFailureReason = "locked" | "readOnly" | "encrypted" | "unparseable" | "other";

export interface SaveMarkupResult {
  status: "pdf" | "sidecar" | "error";
  message?: string;
  /** Set for `sidecar` (why the PDF was not written) and `error`. */
  reason?: SaveFailureReason;
}

export const sidecarV1Schema = z.object({
  version: z.literal(1),
  pages: z.array(z.object({ page: z.number().int().positive(), payload: markupPayloadSchema })),
});
