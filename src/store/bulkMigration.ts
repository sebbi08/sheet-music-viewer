import * as pdfJs from "pdfjs-dist";
import { defineStore } from "pinia";
import { shallowRef } from "vue";
import { renderMarkupPng } from "../markup/renderPng";
import { BulkMigration, type MigrationPhase } from "../migration/bulkMigration";
import { migrateFile, type MigrateFileDeps } from "../migration/migrateFile";
import { client } from "../trcpClient";
import { useMarkupSaves } from "./markupSaves";

// Same pdf.js assets and options as SheetViewer.vue (the worker port is set globally in renderer.ts).
const pdfJsAssetBaseUrl = window.location.protocol.startsWith("http")
  ? new URL("./pdfjs/", window.location.href).toString()
  : "app://bundle/pdfjs/";

const loadPdf: MigrateFileDeps["loadPdf"] = async (path) => {
  const task = pdfJs.getDocument({
    url: "local-resource://file.html?url=" + btoa(encodeURIComponent(path)),
    wasmUrl: new URL("wasm/", pdfJsAssetBaseUrl).toString(),
    cMapUrl: new URL("cmaps/", pdfJsAssetBaseUrl).toString(),
    standardFontDataUrl: new URL("standard_fonts/", pdfJsAssetBaseUrl).toString(),
    // Saving replaces the file, so pdf.js must hold all of it in memory instead of reading ranges later.
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
  });
  let doc: pdfJs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch((destroyError: unknown) => console.warn("Could not release the PDF", destroyError));
    throw e;
  }
  return {
    numPages: doc.numPages,
    viewportOf: async (page) => {
      const { width, height, rotation } = (await doc.getPage(page)).getViewport({ scale: 1 });
      return { width, height, rotation };
    },
    // pdf.js 6: the loading task frees the document (and its worker connection, set up again for the next one).
    destroy: () => task.destroy(),
  };
};

/**
 * The bulk migration of legacy `.data` files (spec 2026-11-16): runs `BulkMigration` against main over
 * tRPC; `MigrationDialog.vue` shows `phase`. Started by App.vue, cancelled by the close guard and the
 * update restart.
 */
export const useBulkMigration = defineStore("bulkMigration", () => {
  const markupSaves = useMarkupSaves();
  const phase = shallowRef<MigrationPhase>({ phase: "idle" });
  /** "Abbrechen" was clicked: the current file is finished first. */
  const cancelling = shallowRef(false);

  const fileDeps: MigrateFileDeps = {
    loadPdf,
    loadMarkup: (path) => client.loadMarkup.query(path),
    save: (input) => client.saveMarkup.mutate(input),
    // Waits for the music font (loadMarkupFonts) before drawing.
    renderPng: renderMarkupPng,
    discardEmptySidecar: (path) => client.discardEmptyLegacySidecar.mutate(path),
  };

  const migration = new BulkMigration({
    findCandidates: (root) => client.findMigrationCandidates.query(root),
    checkFolder: (root) => client.checkMigrationFolder.mutate(root),
    async createBackup(root, candidates, onProgress) {
      // Subscribed before the backup starts, so no progress is missed.
      const subscription = client.onMigrationBackupProgress.subscribe(undefined, {
        onData: onProgress,
        onError: (e) => console.warn("Backup progress unavailable", e),
      });
      try {
        return await client.createMigrationBackup.mutate({ root, candidates });
      } finally {
        subscription.unsubscribe();
      }
    },
    cancelBackup: async () => {
      await client.cancelMigrationBackup.mutate();
    },
    migrateFile: (candidate) => migrateFile(candidate, fileDeps),
    recordSkip: async (candidate, reason) => {
      await client.recordMigrationSkip.mutate({ candidate, reason });
    },
    hasPending: (path) => markupSaves.queue.hasPending(path),
    onPhase: (p) => {
      phase.value = p;
    },
  });

  /** Migrates everything below `root`; a second call while one runs joins it. Nothing found: no dialog. */
  async function run(root: string): Promise<void> {
    if (!migration.isRunning()) cancelling.value = false;
    try {
      await migration.run(root);
    } catch (e) {
      console.warn("The markup migration failed", e);
      phase.value = { phase: "idle" };
    }
  }

  function cancel(): void {
    if (!migration.isRunning()) return;
    cancelling.value = true;
    migration.cancel();
  }

  /** Cancels a running migration and resolves once its current file is done. */
  async function cancelAndWait(): Promise<void> {
    if (migration.isRunning()) cancelling.value = true;
    await migration.cancelAndWait();
  }

  /** "OK" on the summary. */
  function dismiss(): void {
    if (phase.value.phase === "done") phase.value = { phase: "idle" };
  }

  const isRunning = () => migration.isRunning();

  return { phase, cancelling, run, cancel, cancelAndWait, dismiss, isRunning };
});
