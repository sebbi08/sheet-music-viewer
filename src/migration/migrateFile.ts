/**
 * Moves the markup of one legacy sidecar into its PDF (bulk migration). Framework-free and electron-free:
 * everything comes in through `MigrateFileDeps`. Never throws.
 */
import type { LoadMarkupResult, MarkupPayload, SaveMarkupInput, SaveMarkupResult } from "../models/markup";
import {
  convertLegacyOverlayData,
  hasMarkup,
  sidecarPagesToChanges,
  type ViewportOf,
} from "../markup/legacyMigration";
import type { PageState } from "../markup/saveQueue";
import type { FailureReason, MigrationCandidate } from "./types";

export type FileOutcome = { kind: "migrated" } | { kind: "failed"; reason: FailureReason; message?: string };

export interface MigrateFileDeps {
  loadPdf(path: string): Promise<{ numPages: number; viewportOf: ViewportOf; destroy(): Promise<void> }>;
  loadMarkup(path: string): Promise<LoadMarkupResult>;
  save(input: SaveMarkupInput): Promise<SaveMarkupResult>;
  renderPng(payload: MarkupPayload): Promise<string>;
  discardEmptySidecar(path: string): Promise<{ deleted: boolean }>;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function saveFailure(result: SaveMarkupResult): FileOutcome {
  const { status, reason, message } = result;
  if (status === "sidecar" && (reason === "readOnly" || reason === "encrypted" || reason === "unparseable")) {
    return { kind: "failed", reason: "notWritable" };
  }
  if (reason === "locked") return { kind: "failed", reason: "locked" };
  return { kind: "failed", reason: "other", message: message ?? "unknown error" };
}

export async function migrateFile(c: MigrationCandidate, deps: MigrateFileDeps): Promise<FileOutcome> {
  let pdf: Awaited<ReturnType<MigrateFileDeps["loadPdf"]>> | null = null;
  try {
    const markup = await deps.loadMarkup(c.pdfPath);
    if (markup.source === "pdf") return { kind: "failed", reason: "alreadyEmbedded" };

    try {
      pdf = await deps.loadPdf(c.pdfPath);
    } catch (e) {
      return markup.pdfIssue
        ? { kind: "failed", reason: "notWritable" }
        : { kind: "failed", reason: "other", message: errorMessage(e) };
    }

    let changes: [number, PageState][] = [];
    if (markup.legacyOverlayData !== null) {
      const converted = await convertLegacyOverlayData(markup.legacyOverlayData, pdf.numPages, pdf.viewportOf);
      if (converted.unreadable) return { kind: "failed", reason: "corruptData" };
      changes = converted.changes;
    } else if (markup.source === "sidecar") {
      changes = await sidecarPagesToChanges(markup.pages, pdf.numPages, pdf.viewportOf);
    }

    const hasV1Pages = markup.source === "sidecar" && markup.pages.length > 0;
    if (!hasMarkup(changes) && !hasV1Pages) {
      const { deleted } = await deps.discardEmptySidecar(c.pdfPath);
      return deleted ? { kind: "migrated" } : { kind: "failed", reason: "corruptData" };
    }

    const pages: SaveMarkupInput["pages"] = [];
    for (const [page, state] of changes) {
      pages.push(
        state
          ? { page, payload: state.payload, pngBase64: await deps.renderPng(state.payload) }
          : { page, payload: null, pngBase64: null },
      );
    }
    const result = await deps.save({ path: c.pdfPath, pages, deleteLegacySidecar: true });
    return result.status === "pdf" ? { kind: "migrated" } : saveFailure(result);
  } catch (e) {
    return { kind: "failed", reason: "other", message: errorMessage(e) };
  } finally {
    if (pdf) {
      try {
        await pdf.destroy();
      } catch (e) {
        console.warn("Could not release the PDF", e);
      }
    }
  }
}
