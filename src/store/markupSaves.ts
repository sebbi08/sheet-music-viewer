import { defineStore } from "pinia";
import { markRaw } from "vue";
import { renderMarkupPng } from "../markup/renderPng";
import { MarkupSaveQueue, type SaveEvent } from "../markup/saveQueue";
import { client } from "../trcpClient";
import { useNotices } from "./notices";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

const saveFailedText = (path: string) =>
  `Markierungen in „${fileName(path)}“ konnten nicht gespeichert werden (ist die PDF in einem anderen Programm geöffnet?). ` +
  "Sie bleiben erhalten; es wird alle 30 Sekunden und beim nächsten Speichern erneut versucht.";
const savedLaterText = (path: string) => `Markierungen in „${fileName(path)}“ wurden jetzt gespeichert.`;
const sidecarHintText = (path: string) =>
  `„${fileName(path)}“ kann nicht beschrieben werden. Markierungen werden in einer Begleitdatei gespeichert.`;

/** Paths are case-insensitive on Windows (the preload exposes Node's path separator). */
const isWindows = typeof window !== "undefined" && (window as { path?: { sep?: string } }).path?.sep === "\\";
const keyOf = (path: string) => (isWindows ? path.replace(/\//g, "\\").toLowerCase() : path);

/** The sidecar hint is shown once per PDF, ever (persisted; storage errors only mean it shows again). */
function sidecarHintSeen(path: string): boolean {
  const key = `smv-sidecar-hint:${keyOf(path)}`;
  try {
    if (localStorage.getItem(key) !== null) return true;
    localStorage.setItem(key, new Date().toISOString());
  } catch (e) {
    console.warn("Could not remember the sidecar hint", e);
  }
  return false;
}

/**
 * Unsaved markup of all sheets (final review F1): survives leaving a sheet, is retried, reported
 * app-wide, and guards closing the window and installing an update.
 */
export const useMarkupSaves = defineStore("markupSaves", () => {
  const notices = useNotices();

  function onEvent(event: SaveEvent): void {
    if (event.type === "failed") {
      console.warn(`Could not save markup of ${event.path}:`, event.message);
      if (event.firstFailure) notices.show(saveFailedText(event.path));
      return;
    }
    if (event.afterFailure) notices.show(savedLaterText(event.path));
    if (event.status === "sidecar" && !sidecarHintSeen(event.path)) notices.show(sidecarHintText(event.path));
  }

  const queue = markRaw(
    new MarkupSaveQueue({ save: (input) => client.saveMarkup.mutate(input), renderPng: renderMarkupPng, onEvent, keyOf }),
  );

  /** Set by the SheetViewer while it is open: queues the changes of an open edit canvas. */
  let captureOpenEdits: (() => void) | null = null;
  function setEditCapture(capture: (() => void) | null): void {
    captureOpenEdits = capture;
  }

  /**
   * Before the window closes or the app restarts for an update: saves everything (waiting for saves in
   * flight); if that fails, asks the user (retry / discard / cancel). `true` = may close.
   */
  async function prepareToClose(): Promise<boolean> {
    captureOpenEdits?.();
    for (;;) {
      if (await queue.flush()) return true;
      const choice = await client.askUnsavedMarkup
        .mutate({ files: queue.pendingPaths().map(fileName) })
        .catch((e: unknown) => {
          console.warn("Could not ask about unsaved markup", e);
          return "cancel" as const;
        });
      if (choice === "discard") {
        queue.discard();
        return true;
      }
      if (choice === "cancel") return false;
    }
  }

  let guardInstalled = false;
  /** Blocks closing/reloading the window while markup is unsaved, until it is saved or discarded. */
  function installCloseGuard(): void {
    if (guardInstalled) return;
    guardInstalled = true;
    let mayClose = false;
    let guarding = false;
    window.addEventListener("beforeunload", (event) => {
      if (mayClose) return;
      captureOpenEdits?.();
      if (!queue.hasPending()) return;
      event.preventDefault();
      event.returnValue = false;
      if (guarding) return;
      guarding = true;
      void prepareToClose().then(async (ok) => {
        guarding = false;
        if (ok) {
          mayClose = true;
          await client.resumeExit.mutate();
        } else {
          await client.cancelExit.mutate();
        }
      });
    });
  }

  return { queue, setEditCapture, prepareToClose, installCloseGuard };
});
