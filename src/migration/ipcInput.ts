/**
 * tRPC inputs of the migration gate (main): the renderer must not make main read, pack or change files
 * outside the sheet folder. Electron-free, unit-tested.
 */
import path from "path";
import { z } from "zod";
import { pdfPathSchema, saveMarkupInputSchema } from "../models/markup";
import { getSidecarPath } from "../pdfMarkup/markupFile";
import type { MigrationCandidate } from "./types";

/** `file` lies below `folder` (not the folder itself); case-insensitive on Windows. */
export function isInsideFolder(folder: string, file: string, pathApi: typeof path.posix = path): boolean {
  const norm = (p: string) => {
    const resolved = pathApi.resolve(p);
    return pathApi.sep === "\\" ? resolved.toLowerCase() : resolved;
  };
  const rel = pathApi.relative(norm(folder), norm(file));
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + pathApi.sep) && !pathApi.isAbsolute(rel);
}

export const absoluteFolderSchema = z
  .string()
  .refine((p) => p !== "" && !p.includes("\0") && path.isAbsolute(p), { message: "expected an absolute folder path" });

/** A candidate as `scanMigrationCandidates` builds it: its sidecar is the PDF's own. */
const candidateSchema = z
  .object({ pdfPath: pdfPathSchema, sidecarPath: z.string(), relativePath: z.string() })
  .refine((c) => c.sidecarPath === getSidecarPath(c.pdfPath), { message: "not the sidecar of the pdf" });

const relativeOf = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/");

/**
 * Adds an issue at `at` unless `c` lies below `root`. Checked lexically: a PDF reached through a link in
 * the folder is accepted (the scan follows links, like the sheet list).
 */
function checkInFolder(root: string, c: MigrationCandidate, ctx: z.RefinementCtx, at: (string | number)[]): void {
  if (!isInsideFolder(root, c.pdfPath) || !isInsideFolder(root, c.sidecarPath)) {
    ctx.addIssue({ code: "custom", path: at, message: "outside the sheet folder" });
  } else if (c.relativePath !== relativeOf(root, c.pdfPath)) {
    // It names the zip entry.
    ctx.addIssue({ code: "custom", path: [...at, "relativePath"], message: "does not match the pdf" });
  }
}

export const migrationBackupInputSchema = z
  .object({ root: absoluteFolderSchema, candidates: z.array(candidateSchema) })
  .superRefine(({ root, candidates }, ctx) => {
    candidates.forEach((c, i) => checkInFolder(root, c, ctx, ["candidates", i]));
  });

/** Pass 1 of the gate: reads one candidate's sidecar and checks its PDF (writes nothing). */
export const readMigrationSourceInputSchema = z
  .object({ root: absoluteFolderSchema, candidate: candidateSchema })
  .superRefine(({ root, candidate }, ctx) => checkInFolder(root, candidate, ctx, ["candidate"]));

/** Moves one candidate's converted sidecar into its PDF (`dryRun`: checks only, writes nothing). */
export const migrateMarkupSidecarInputSchema = z
  .object({
    root: absoluteFolderSchema,
    candidate: candidateSchema,
    pages: saveMarkupInputSchema.shape.pages,
    dryRun: z.boolean(),
  })
  .superRefine(({ root, candidate }, ctx) => checkInFolder(root, candidate, ctx, ["candidate"]));
