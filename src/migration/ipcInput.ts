/**
 * tRPC inputs of the bulk migration (main): the renderer must not make main read, pack or remember files
 * outside the sheet folder. Electron-free, unit-tested.
 */
import path from "path";
import { z } from "zod";
import { pdfPathSchema } from "../models/markup";
import { getSidecarPath } from "../pdfMarkup/markupFile";
import { PERMANENT_REASONS, type FailureReason, type MigrationCandidate } from "./types";

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

/** A candidate as `findMigrationCandidates` builds it: its sidecar is the PDF's own. */
const candidateSchema = z
  .object({ pdfPath: pdfPathSchema, sidecarPath: z.string(), relativePath: z.string() })
  .refine((c) => c.sidecarPath === getSidecarPath(c.pdfPath), { message: "not the sidecar of the pdf" });

const relativeOf = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/");

export const migrationBackupInputSchema = z
  .object({ root: absoluteFolderSchema, candidates: z.array(candidateSchema) })
  .superRefine(({ root, candidates }, ctx) => {
    candidates.forEach((c: MigrationCandidate, i) => {
      if (!isInsideFolder(root, c.pdfPath) || !isInsideFolder(root, c.sidecarPath)) {
        ctx.addIssue({ code: "custom", path: ["candidates", i], message: "outside the sheet folder" });
      } else if (c.relativePath !== relativeOf(root, c.pdfPath)) {
        // It names the zip entry.
        ctx.addIssue({ code: "custom", path: ["candidates", i, "relativePath"], message: "does not match the pdf" });
      }
    });
  });

/** Only permanent failures are remembered: a transient one must never skip a file. */
export const recordMigrationSkipInputSchema = z.object({
  candidate: candidateSchema,
  reason: z.custom<FailureReason>((r) => typeof r === "string" && PERMANENT_REASONS.has(r as FailureReason), {
    message: "expected a permanent failure reason",
  }),
});
