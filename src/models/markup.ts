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

/**
 * Why markup cannot be saved into a PDF: `encrypted`, `unparseable` (pdf-lib cannot read it, or the file
 * cannot be read), `readOnly` (the file or its folder does not take writes), `structure` (building and
 * reading back an update in memory fails, e.g. a broken `startxref`; `message` says why).
 */
export type WriteBlockReason = "encrypted" | "unparseable" | "readOnly" | "structure";
export interface WriteBlock {
  reason: WriteBlockReason;
  message?: string;
}

/** Markup of a PDF, read from the PDF only (a `.data` file next to it is never read). */
export interface LoadMarkupResult {
  /** `pdf`: the PDF has our embedded data; `none`: it has none, or its data cannot be read (`writeBlock`). */
  source: "pdf" | "none";
  pages: LoadedMarkupPage[];
  /**
   * What parsing shows about saving into this PDF: `encrypted`, `unparseable` (with the parser's message;
   * the markup could not be read), else `null`. Not the full write check: read-only and the trial build
   * come from `checkMarkupOnOpen` (tRPC `checkMarkupOnOpen`).
   */
  writeBlock: WriteBlock | null;
  /**
   * The PDF has orphaned stamps of ours (no usable data). `checkMarkupOnOpen` repairs them when it can write
   * the PDF, which takes them out of our optional content group; the viewer awaits that check before pdf.js
   * reads the file, so the repaired stamps show on this open.
   */
  orphans: boolean;
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
});
export type SaveMarkupInput = z.infer<typeof saveMarkupInputSchema>;

export type SaveFailureReason = "locked" | "readOnly" | "encrypted" | "unparseable" | "structure" | "other";

/** Markup is saved into the PDF only: `pdf` = saved; `error` = not saved, the PDF is unchanged. */
export interface SaveMarkupResult {
  status: "pdf" | "error";
  message?: string;
  /** Set for `error`. */
  reason?: SaveFailureReason;
}

/** `conflict`: the PDF holds other markup; `sidecarNotDeleted`: the PDF holds the markup, the sidecar stayed. */
export type MigrateFailureReason = SaveFailureReason | "conflict" | "sidecarNotDeleted";

/** One legacy sidecar converted to page changes, to move into its PDF (`dryRun`: check only, write nothing). */
export interface MigrateSidecarInput {
  path: string;
  pages: SaveMarkupInput["pages"];
  dryRun: boolean;
}

export type MigrateSidecarResult =
  | { status: "migrated" } // dryRun: would be written. Otherwise: written, read back, sidecar deleted
  | { status: "alreadyMigrated" } // the PDF already holds exactly these pages. Otherwise also: sidecar deleted
  | { status: "error"; reason: MigrateFailureReason; message?: string };

export const sidecarV1Schema = z.object({
  version: z.literal(1),
  pages: z.array(z.object({ page: z.number().int().positive(), payload: markupPayloadSchema })),
});
