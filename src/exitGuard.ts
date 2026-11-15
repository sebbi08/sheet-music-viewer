/**
 * Main-process side of "never close with unsaved markup" (final review F1). The renderer blocks the
 * unload (`beforeunload`) while markup is unsaved, tries to save it and, if that fails, asks the user here
 * with a native dialog. Afterwards it resumes or cancels the exit; this module remembers which exit was
 * interrupted (window close, app quit, or neither, i.e. a reload) so it can be resumed.
 */
import { app, BrowserWindow, dialog } from "electron";

export type UnsavedMarkupChoice = "retry" | "discard" | "cancel";

let interruptedExit: "quit" | "close" | null = null;

/** Records closes and quits of `win`; call once per window. */
export function trackExits(win: BrowserWindow): void {
  win.on("close", () => {
    if (interruptedExit !== "quit") interruptedExit = "close";
  });
}

app.on("before-quit", () => {
  interruptedExit = "quit";
});

/** The app has one window. */
const appWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

/** Native dialog: saving failed; retry, discard and close, or cancel the close. */
export async function askUnsavedMarkup(files: string[]): Promise<UnsavedMarkupChoice> {
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title: "Sheet Music Viewer",
    message: "Markierungen konnten nicht gespeichert werden.",
    detail:
      (files.length > 0 ? `Betroffen: ${files.join(", ")}\n\n` : "") +
      "Ist die PDF in einem anderen Programm geöffnet? Dann dort schließen und „Erneut versuchen“ wählen.",
    buttons: ["Erneut versuchen", "Verwerfen und schließen", "Abbrechen"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };
  const win = appWindow();
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return response === 0 ? "retry" : response === 1 ? "discard" : "cancel";
}

/** Continues the exit the renderer interrupted: quit, close the window, or reload it. */
export function resumeExit(): void {
  const exit = interruptedExit;
  interruptedExit = null;
  if (exit === "quit") {
    app.quit();
    return;
  }
  const win = appWindow();
  if (exit === "close") win?.close();
  else win?.webContents.reload();
}

/** The user chose to stay: forget the interrupted exit. */
export function cancelExit(): void {
  interruptedExit = null;
}
