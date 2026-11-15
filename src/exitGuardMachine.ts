/**
 * Main-process logic of "never close with unsaved markup, but never get stuck either" (final review F1,
 * B2), without Electron imports so it is unit-tested in Node; `src/exitGuard.ts` wires it to Electron.
 *
 * The renderer blocks an exit (window close, app quit, update restart, reload) in `beforeunload` while
 * markup is unsaved, saves, and then reports back: `resume` (all saved), or `ask` (saving failed: the
 * native dialog). This machine remembers the interrupted exit and does not rely on the renderer alone:
 * - if the renderer has not reported within `timeoutMs` after the exit was requested or blocked, main
 *   shows the dialog itself (also when the renderer hangs, never answers, or its IPC call failed);
 * - an exit blocked again while main still waits for the renderer (a second close click) shows it now;
 * - a renderer that turns unresponsive during an exit it never answered shows it now, a crashed one ends
 *   the exit (its unsaved state is gone);
 * - "Verwerfen und schließen" is carried out here (destroy, quit, update restart or forced reload), so it
 *   works without the renderer.
 */

export type UnsavedMarkupChoice = "retry" | "discard" | "cancel";

/** What was interrupted. `update` = `autoUpdater.quitAndInstall` (restart into the new version). */
export type ExitKind = "reload" | "close" | "quit" | "update";

/** `failed`: the renderer could not save. `stalled`: the renderer did not finish in time or hangs. */
export type DialogReason = "failed" | "stalled";

export interface ExitGuardEffects {
  /** The native dialog. Resolves (any choice) when `signal` aborts it. */
  showDialog(request: { files: string[]; reason: DialogReason; signal: AbortSignal }): Promise<UnsavedMarkupChoice>;
  /** Continues the exit normally; the renderer's `beforeunload` decides again. */
  proceed(kind: ExitKind): void;
  /** Ends the exit without the renderer: destroy the window (then quit / update restart), or reload anyway. */
  force(kind: ExitKind): void;
  log?(message: string, error?: unknown): void;
}

/** How long main waits for the renderer before it shows the dialog itself. */
export const EXIT_GUARD_TIMEOUT_MS = 10_000;

/** A requested exit replaces a weaker one: a quit includes closing, an update restart includes quitting. */
const RANK: Record<ExitKind, number> = { reload: 0, close: 1, quit: 2, update: 3 };

interface OpenDialog {
  /** `main`: shown by this machine (timeout, second close, hang); `renderer`: asked for by the renderer. */
  owner: "main" | "renderer";
  controller: AbortController;
  result: Promise<UnsavedMarkupChoice>;
}

export class ExitGuard {
  private kind: ExitKind | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** An exit was blocked by the renderer and the renderer has not reported since. */
  private awaitingRenderer = false;
  private dialog: OpenDialog | null = null;
  /** The renderer reported "all saved" while a dialog was open. */
  private resumeRequested = false;
  /** File names of the last renderer request, shown in dialogs main opens itself. */
  private files: string[] = [];
  private readonly timeoutMs: number;

  constructor(
    private readonly effects: ExitGuardEffects,
    options: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? EXIT_GUARD_TIMEOUT_MS;
  }

  /** The interrupted exit, if any (for tests and logging). */
  get pendingExit(): ExitKind | null {
    return this.kind;
  }

  get dialogOpen(): boolean {
    return this.dialog !== null;
  }

  /** Window `close`, app `before-quit`, or the update restart was started. */
  exitRequested(kind: Exclude<ExitKind, "reload">): void {
    if (this.kind === null || RANK[kind] > RANK[this.kind]) this.kind = kind;
    if (this.dialog) return;
    // Not restarted: repeated close clicks of a hanging window must not delay the dialog.
    this.armTimer(false);
  }

  /** The renderer's `beforeunload` blocked the exit (`will-prevent-unload`). */
  unloadPrevented(): void {
    if (this.kind === null) this.kind = "reload"; // neither a close nor a quit: Ctrl+R / View → Reload
    if (this.dialog) return;
    if (this.awaitingRenderer) {
      // Blocked again while the renderer is still busy with the last one: let the user decide now.
      void this.openDialog("stalled", "main");
      return;
    }
    this.awaitingRenderer = true;
    this.armTimer(true);
  }

  /**
   * The renderer could not save and asks the user. `forExit`: asked while an exit is blocked (main then
   * carries out the choice itself); otherwise (before the update restart) the renderer acts on it.
   */
  ask(files: string[], forExit: boolean): Promise<UnsavedMarkupChoice> {
    this.files = files;
    if (!forExit) return this.openDialog("failed", "renderer");
    this.awaitingRenderer = false;
    // Nothing interrupted any more: the user already chose to stay in a dialog main showed meanwhile.
    if (this.kind === null) return Promise.resolve("cancel");
    return this.openDialog("failed", "renderer");
  }

  /** The renderer saved everything: continue the interrupted exit. */
  resume(): void {
    this.awaitingRenderer = false;
    if (this.dialog) {
      this.resumeRequested = true;
      this.dialog.controller.abort();
      return;
    }
    const kind = this.kind;
    if (kind === null) return; // late report of an exit the user cancelled meanwhile
    this.reset();
    this.effects.proceed(kind);
  }

  /** `render-process-gone`: the unsaved state is lost with the renderer; an interrupted exit goes ahead. */
  rendererGone(): void {
    const kind = this.kind;
    this.awaitingRenderer = false;
    this.reset();
    this.dialog?.controller.abort();
    if (kind !== null) this.effects.force(kind);
  }

  /**
   * `unresponsive`. Electron also reports it 5 s after a close that did not finish, even when the renderer
   * blocked the close on purpose and is busy saving; so it counts only while the renderer has not answered
   * the exit at all. A renderer that hangs before or after that is covered by the timeout.
   */
  rendererUnresponsive(): void {
    if (this.kind !== null && !this.awaitingRenderer && !this.dialog) void this.openDialog("stalled", "main");
  }

  /** The window is gone (`closed`). */
  windowClosed(): void {
    this.awaitingRenderer = false;
    this.reset();
    this.dialog?.controller.abort();
  }

  /** The exit could not start (e.g. `quitAndInstall` reported an error) and nothing blocks it. */
  exitFailed(kind: ExitKind): void {
    if (this.kind === kind && !this.dialog && !this.awaitingRenderer) this.reset();
  }

  private reset(): void {
    this.kind = null;
    this.resumeRequested = false;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private armTimer(restart: boolean): void {
    if (this.dialog || (this.timer !== null && !restart)) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.kind !== null && !this.dialog) void this.openDialog("stalled", "main");
    }, this.timeoutMs);
  }

  /** One dialog at a time: a request while one is open gets its answer. */
  private openDialog(reason: DialogReason, owner: OpenDialog["owner"]): Promise<UnsavedMarkupChoice> {
    if (this.dialog) return this.dialog.result;
    this.clearTimer();
    const controller = new AbortController();
    let shown: Promise<UnsavedMarkupChoice>;
    try {
      shown = this.effects.showDialog({ files: this.files, reason, signal: controller.signal });
    } catch (e) {
      shown = Promise.reject(e);
    }
    const result = shown
      .catch((e: unknown) => {
        // No dialog can be shown: stay (closing would drop the markup without asking); the next close tries again.
        this.effects.log?.("Could not show the unsaved markup dialog", e);
        return "cancel" as const;
      })
      .then((choice) => this.dialogClosed(choice, owner));
    this.dialog = { owner, controller, result };
    return result;
  }

  private dialogClosed(choice: UnsavedMarkupChoice, owner: OpenDialog["owner"]): UnsavedMarkupChoice {
    this.dialog = null;
    const resumed = this.resumeRequested;
    this.resumeRequested = false;
    const kind = this.kind;
    // Nothing interrupted: the renderer asked before the update restart and acts on the answer itself.
    if (kind === null) return resumed ? "retry" : choice;
    if (choice === "discard") {
      this.reset();
      this.effects.force(kind);
      return choice;
    }
    if (resumed) {
      // Everything was saved meanwhile.
      this.reset();
      this.effects.proceed(kind);
      return "retry";
    }
    if (choice === "cancel") {
      this.reset();
      return choice;
    }
    // Retry. The renderer that asked saves again by itself; after a dialog of main, the exit is requested
    // again, so the renderer's `beforeunload` saves (or blocks) once more. Either way main waits again.
    this.armTimer(true);
    if (owner === "main") {
      this.awaitingRenderer = false;
      this.effects.proceed(kind);
    } else {
      this.awaitingRenderer = true;
    }
    return choice;
  }
}
