import * as pdfJs from "pdfjs-dist";
import { defineStore } from "pinia";
import { shallowRef } from "vue";
import { RouteNames } from "../Enums";
import { renderMarkupPng } from "../markup/renderPng";
import { MigrationGate, type GatePhase } from "../migration/gate";
import { processFile, type ProcessFileDeps } from "../migration/processFile";
import type { MigrationCandidate } from "../migration/types";
import router from "../router";
import { client } from "../trcpClient";
import useStore from "./index";
import { keyOf, useMarkupSaves } from "./markupSaves";

// Same pdf.js assets and options as SheetViewer.vue (the worker port is set globally in renderer.ts).
const pdfJsAssetBaseUrl = window.location.protocol.startsWith("http")
  ? new URL("./pdfjs/", window.location.href).toString()
  : "app://bundle/pdfjs/";

const loadPdf: ProcessFileDeps["loadPdf"] = async (path) => {
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

/** What `processFile` needs for one candidate of a run below `root` (main checks both against the folder). */
const fileDeps = (root: string, candidate: MigrationCandidate): ProcessFileDeps => ({
  readSource: (c) => client.readMigrationSource.query({ root, candidate: c }),
  loadPdf,
  // Waits for the music font (loadMarkupFonts) before drawing.
  renderPng: renderMarkupPng,
  migrate: ({ pages, dryRun }) => client.migrateMarkupSidecar.mutate({ root, candidate, pages, dryRun }),
  discardEmptySidecar: (path) => client.discardEmptyLegacySidecar.mutate(path),
});

/**
 * The migration gate for legacy `.data` files (spec 2026-11-20): runs `MigrationGate` against main over
 * tRPC; `MigrationDialog.vue` shows `phase`. Started by App.vue, which opens no sheet before `isPassed`;
 * cancelled by the close guard and the update restart.
 */
export const useBulkMigration = defineStore("bulkMigration", () => {
  const markupSaves = useMarkupSaves();
  const phase = shallowRef<GatePhase>({ phase: "idle" });
  /** "Abbrechen" was clicked (during the write pass the current file is finished first). */
  const cancelling = shallowRef(false);
  /** Folders (as `keyOf`) whose gate passed in this session. */
  const passed = shallowRef<ReadonlySet<string>>(new Set());
  /** Root of the current (or last) run. */
  let runRoot = "";
  /** The folder dialog is open (it is not modal): no second run may start for the old folder meanwhile. */
  let choosingFolder = false;

  const gate = new MigrationGate({
    isMigrated: (root) => client.isMarkupFolderMigrated.query(root),
    flushPending: async () => {
      await markupSaves.queue.flush();
    },
    scan: (root) => client.scanMigrationCandidates.query(root),
    hasPending: (path) => markupSaves.queue.hasPending(path),
    processFile: (c, mode) => processFile(c, fileDeps(runRoot, c), mode),
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
    markMigrated: async (root) => {
      await client.markMarkupFolderMigrated.mutate(root);
    },
    onPhase: (p) => {
      phase.value = p;
    },
  });

  /** Runs the gate for `root`; a second call while one runs joins it. */
  async function run(root: string): Promise<void> {
    if (!gate.isRunning()) {
      cancelling.value = false;
      runRoot = root;
    }
    const target = runRoot;
    try {
      const result = await gate.run(target);
      if (result.status === "passed") passed.value = new Set([...passed.value, keyOf(target)]);
    } catch (e) {
      console.warn("The markup migration failed", e);
      phase.value = { phase: "idle" };
    }
  }

  /** "Erneut prüfen": the same folder again, the window stays up. */
  async function recheck(): Promise<void> {
    if (gate.isRunning() || choosingFolder || !runRoot) return;
    phase.value = { phase: "scanning" };
    await run(runRoot);
  }

  /** "Anderen Notenordner wählen": the folder dialog; a chosen folder (even the same one) runs the gate. */
  async function chooseOtherFolder(): Promise<void> {
    if (gate.isRunning() || choosingFolder) return;
    let folder: string | undefined;
    choosingFolder = true;
    try {
      folder = await client.selectFolder.query();
    } finally {
      choosingFolder = false;
    }
    if (!folder) return; // cancelled: the list stays
    useStore().setSheetMusicFolder(folder);
    await router.push({ name: RouteNames.SheetSelection, params: { path: window.path.sep } });
    // Explicitly: the folder watch in App.vue does not fire for the same folder.
    await run(folder);
  }

  /** "Abbrechen": stops the run and closes the app. */
  async function cancel(): Promise<void> {
    cancelling.value = true;
    await gate.cancelAndWait();
    await client.closeApp.mutate();
  }

  /** For the close guard and the update restart (the window is closing already): stops a run, never closes. */
  async function cancelAndWait(): Promise<void> {
    if (gate.isRunning()) cancelling.value = true;
    await gate.cancelAndWait();
  }

  /** "OK" on the summary. */
  function dismiss(): void {
    if (phase.value.phase === "done") phase.value = { phase: "idle" };
  }

  /** "Schließen" on the failure list: the normal close path. */
  async function close(): Promise<void> {
    await client.closeApp.mutate();
  }

  const isRunning = () => gate.isRunning();

  /** The gate passed for `folder` in this session (reactive). */
  const isPassed = (folder: string) => folder !== "" && passed.value.has(keyOf(folder));

  return { phase, cancelling, run, recheck, chooseOtherFolder, cancel, cancelAndWait, dismiss, close, isRunning, isPassed };
});
