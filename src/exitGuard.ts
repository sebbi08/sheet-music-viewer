/**
 * Electron wiring of the exit guard (final review F1, B2; logic in `src/exitGuardMachine.ts`). The
 * renderer blocks an exit in `beforeunload` while markup is unsaved and saves it; this module tells the
 * machine which exit was requested (window close, app quit, update restart) or blocked
 * (`will-prevent-unload`), how the renderer is doing (crashed, unresponsive), and carries out its
 * decisions: continue the exit, or end it without the renderer after "Verwerfen und schließen".
 */
import { app, autoUpdater, BrowserWindow, dialog } from "electron";
import {
  EXIT_GUARD_TIMEOUT_MS,
  ExitGuard,
  type DialogReason,
  type ExitKind,
  type UnsavedMarkupChoice,
} from "./exitGuardMachine";

export type { UnsavedMarkupChoice } from "./exitGuardMachine";

/** The app has one window: the one passed to `trackExits`. */
let trackedWindow: BrowserWindow | null = null;
const appWindow = (): BrowserWindow | undefined =>
  trackedWindow && !trackedWindow.isDestroyed() ? trackedWindow : BrowserWindow.getAllWindows()[0];

const DETAIL: Record<DialogReason, string> = {
  failed: "Ist die PDF in einem anderen Programm geöffnet? Dann dort schließen und „Erneut versuchen“ wählen.",
  stalled:
    "Das Speichern ist nicht rechtzeitig fertig geworden, oder die Anzeige reagiert nicht. „Erneut versuchen“ " +
    "wartet weiter auf das Speichern; „Verwerfen und schließen“ schließt ohne die ungespeicherten Markierungen.",
};

/** Native dialog: saving failed (or hangs); retry, discard and close, or cancel the close. */
async function showUnsavedMarkupDialog(request: {
  files: string[];
  reason: DialogReason;
  signal: AbortSignal;
}): Promise<UnsavedMarkupChoice> {
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title: "Sheet Music Viewer",
    message: "Markierungen konnten nicht gespeichert werden.",
    detail: (request.files.length > 0 ? `Betroffen: ${request.files.join(", ")}\n\n` : "") + DETAIL[request.reason],
    buttons: ["Erneut versuchen", "Verwerfen und schließen", "Abbrechen"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    signal: request.signal,
  };
  const win = appWindow();
  let response: number;
  try {
    ({ response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options));
  } catch (e) {
    // E.g. the parent window is in a bad state: try once more without it.
    console.warn("Could not show the unsaved markup dialog on the window", e);
    ({ response } = await dialog.showMessageBox(options));
  }
  return response === 0 ? "retry" : response === 1 ? "discard" : "cancel";
}

/** Set before a forced reload: the next `will-prevent-unload` is overridden, so the reload happens. */
let forceUnload = false;

/** For tests (visual e2e): `SMV_EXIT_GUARD_TIMEOUT_MS` shortens the wait, honoured only with `IS_TEST`. */
function timeoutMs(): number {
  const fromEnv = Number(process.env.SMV_EXIT_GUARD_TIMEOUT_MS);
  return process.env.IS_TEST && Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : EXIT_GUARD_TIMEOUT_MS;
}

const guard = new ExitGuard(
  {
    showDialog: showUnsavedMarkupDialog,
    proceed(kind: ExitKind) {
      const win = appWindow();
      if (kind === "close") win?.close();
      else if (kind === "reload") win?.webContents.reload();
      // `update`: `quitAndInstall` already armed the restart (Windows: Squirrel waits for this process to
      // exit; macOS: it installs once all windows are closed); calling it again would start it twice.
      else app.quit();
    },
    force(kind: ExitKind) {
      if (kind === "reload") {
        const win = appWindow();
        if (!win) return;
        forceUnload = true;
        win.webContents.reload();
        return;
      }
      if (kind === "close") {
        appWindow()?.destroy();
        return;
      }
      // quit, update: no window may stop it any more (see `proceed` for the update restart).
      for (const win of BrowserWindow.getAllWindows()) win.destroy();
      app.quit();
    },
    log: (message, error) => console.warn(message, error),
  },
  { timeoutMs: timeoutMs() },
);

/** Watches closes, blocked unloads and the renderer of `win`; call once per window. */
export function trackExits(win: BrowserWindow): void {
  trackedWindow = win;
  win.on("close", () => guard.exitRequested("close"));
  win.on("closed", () => guard.windowClosed());
  win.on("unresponsive", () => guard.rendererUnresponsive());
  win.webContents.on("will-prevent-unload", (event) => {
    if (forceUnload) {
      forceUnload = false;
      event.preventDefault(); // ignore the renderer's beforeunload: the user discarded the markup
      return;
    }
    guard.unloadPrevented();
  });
  win.webContents.on("did-start-navigation", () => {
    forceUnload = false;
  });
  win.webContents.on("render-process-gone", () => guard.rendererGone());
}

app.on("before-quit", () => guard.exitRequested("quit"));
autoUpdater.on("error", () => guard.exitFailed("update"));

/** The native dialog for the renderer: saving failed. See `ExitGuard.ask`. */
export function askUnsavedMarkup(files: string[], forExit: boolean): Promise<UnsavedMarkupChoice> {
  return guard.ask(files, forExit);
}

/** The renderer saved everything: continue the exit it blocked. */
export function resumeExit(): void {
  guard.resume();
}

/** Closes the app window the normal way, so the close guard runs (the migration gate's "Schließen"). */
export function closeAppWindow(): void {
  appWindow()?.close();
}

/** Restart into the downloaded update (the renderer saved or discarded its markup first). */
export function restartForUpdate(): void {
  guard.exitRequested("update");
  autoUpdater.quitAndInstall();
}
