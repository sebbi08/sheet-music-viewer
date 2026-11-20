/**
 * Checks ("check": writes nothing) or migrates ("write") one legacy sidecar for the migration gate.
 * Runs in the renderer: no Node or Electron imports, everything comes in through `ProcessFileDeps`.
 * Never throws.
 */
import type {
  MarkupPayload,
  MigrateSidecarInput,
  MigrateSidecarResult,
  SaveMarkupInput,
  WriteBlock,
} from "../models/markup";
import type { SidecarContent } from "../pdfMarkup/legacySidecar";
import {
  convertLegacyOverlayData,
  hasMarkup,
  sidecarPagesToChanges,
  type ViewportOf,
} from "../markup/legacyMigration";
import type { PageState } from "../markup/saveQueue";
import type { GateFailureReason, MigrationCandidate } from "./types";

export type FileOutcome =
  | { kind: "ok"; plan: "migrate" | "deleteEmpty" | "deleteMigrated" }
  | { kind: "gone" } // sidecar vanished since the scan
  | { kind: "failed"; reason: GateFailureReason; message?: string };

export interface ProcessFileDeps {
  readSource(c: MigrationCandidate): Promise<{ sidecar: SidecarContent; writeBlock: WriteBlock | null }>;
  loadPdf(path: string): Promise<{ numPages: number; viewportOf: ViewportOf; destroy(): Promise<void> }>;
  renderPng(payload: MarkupPayload): Promise<string>;
  migrate(input: MigrateSidecarInput): Promise<MigrateSidecarResult>;
  discardEmptySidecar(path: string): Promise<{ deleted: boolean }>;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Basename of the candidate's `.data` file (string-only: this runs in the renderer). */
export const sidecarNameOf = (c: MigrationCandidate): string => c.sidecarPath.split(/[\\/]/).pop() ?? c.sidecarPath;

const failed = (reason: GateFailureReason, message?: string): FileOutcome =>
  message === undefined ? { kind: "failed", reason } : { kind: "failed", reason, message };

export async function processFile(
  c: MigrationCandidate,
  deps: ProcessFileDeps,
  mode: "check" | "write",
): Promise<FileOutcome> {
  let pdf: Awaited<ReturnType<ProcessFileDeps["loadPdf"]>> | null = null;
  try {
    const { sidecar, writeBlock } = await deps.readSource(c);
    if (sidecar.kind === "gone") return { kind: "gone" };
    if (sidecar.kind === "unreadable") return failed("dataUnreadable", sidecar.message);
    if (sidecar.kind === "empty") {
      // Only the sidecar gets deleted, so only "readOnly" matters; pass 1 must predict that pass 2 fails.
      if (writeBlock?.reason === "readOnly") return failed("readOnly", writeBlock.message);
      if (mode === "check") return { kind: "ok", plan: "deleteEmpty" };
      const { deleted } = await deps.discardEmptySidecar(c.pdfPath);
      return deleted
        ? { kind: "ok", plan: "deleteEmpty" }
        : failed("other", `Die Markierungsdatei „${sidecarNameOf(c)}“ hat sich seit der Prüfung geändert. Bitte erneut prüfen.`);
    }

    if (writeBlock) return failed(writeBlock.reason, writeBlock.message);

    try {
      pdf = await deps.loadPdf(c.pdfPath);
    } catch (e) {
      return failed("unparseable", errorMessage(e));
    }

    let changes: [number, PageState][];
    if (sidecar.kind === "legacy") {
      const converted = await convertLegacyOverlayData(sidecar.text, pdf.numPages, pdf.viewportOf);
      // The sidecar holds markup (else it would be "empty"); none converted means it lies on pages the PDF lacks.
      if (converted.unreadable || !hasMarkup(converted.changes)) return failed("dataDamaged");
      changes = converted.changes;
    } else {
      if (sidecar.pages.some((p) => p.page > pdf!.numPages)) return failed("dataDamaged");
      const pages = sidecar.pages.map(({ page, payload }) => ({ page, rect: null, payload }));
      changes = await sidecarPagesToChanges(pages, pdf.numPages, pdf.viewportOf);
    }

    const pages: SaveMarkupInput["pages"] = [];
    try {
      for (const [page, state] of changes) {
        pages.push(
          state
            ? { page, payload: state.payload, pngBase64: await deps.renderPng(state.payload) }
            : { page, payload: null, pngBase64: null },
        );
      }
    } catch (e) {
      return failed("dataDamaged", errorMessage(e));
    }

    const result = await deps.migrate({ path: c.pdfPath, pages, dryRun: mode === "check" });
    if (result.status === "migrated") return { kind: "ok", plan: "migrate" };
    if (result.status === "alreadyMigrated") return { kind: "ok", plan: "deleteMigrated" };
    return failed(result.reason, result.message);
  } catch (e) {
    return failed("other", errorMessage(e));
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
