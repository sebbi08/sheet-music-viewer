/**
 * Renderer side of "never close with unsaved markup" (final review F1, B2), framework-free so it is
 * unit-tested in Node; `src/store/markupSaves.ts` wires it to the window, the queue, tRPC and the notices.
 * Main (`src/exitGuardMachine.ts`) watches every blocked exit and steps in with its own dialog when this
 * side does not report in time, so nothing here can keep the window open for good.
 */
import type { UnsavedMarkupChoice } from "../exitGuardMachine";

export const SAVING_ON_CLOSE_TEXT = "Markierungen werden gespeichert …";
export const UPDATE_ASK_FAILED_TEXT =
  "Ungespeicherte Markierungen: Der Neustart für das Update wurde abgebrochen, weil die Rückfrage nicht angezeigt " +
  "werden konnte. Bitte erneut versuchen.";

export interface CloseGuardQueue {
  /** Saves what is pending (waits for saves in flight); `true` = nothing left unsaved. */
  flush(): Promise<boolean>;
  hasPending(): boolean;
  pendingPaths(): string[];
  discard(): void;
}

/** The bulk markup migration (`src/store/bulkMigration.ts`): closing cancels it after the current file. */
export interface CloseGuardMigration {
  isRunning(): boolean;
  /** Cancels and resolves once the file being migrated is finished. */
  cancelAndWait(): Promise<void>;
}

export interface CloseGuardOptions {
  queue: CloseGuardQueue;
  /** Optional: a running migration blocks closing until its current file is done. */
  migration?: CloseGuardMigration;
  /** Queues the changes of an open edit canvas. */
  captureOpenEdits(): void;
  /** The native dialog in main (`askUnsavedMarkup`). */
  ask(files: string[], forExit: boolean): Promise<UnsavedMarkupChoice>;
  /** Everything saved: main continues the blocked exit (`resumeExit`). */
  resume(): Promise<unknown>;
  showNotice(text: string): void;
  hideNotice(text: string): void;
  /** A save on closing that takes longer than this shows a notice; default 500 ms. */
  savingNoticeDelayMs?: number;
  log?(message: string, error: unknown): void;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function createCloseGuard(options: CloseGuardOptions) {
  const { queue } = options;
  const log = (message: string, error: unknown) => (options.log ?? console.warn)(message, error);
  let guarding = false;

  /** Lets a running migration finish its current file; a failure must not stop the close. */
  async function stopMigration(): Promise<void> {
    try {
      await options.migration?.cancelAndWait();
    } catch (e) {
      log("Could not cancel the markup migration", e);
    }
  }

  /**
   * Saves while an exit is blocked. All saved -> main continues the exit. Not saved -> main asks and carries
   * out "discard" (closes) or "cancel" itself; "retry" saves again here.
   */
  async function guardExit(): Promise<void> {
    // Only awaited while one runs: otherwise saving starts synchronously, as before.
    if (options.migration?.isRunning()) await stopMigration();
    for (;;) {
      if (await queue.flush()) {
        await options.resume();
        return;
      }
      const choice = await options.ask(queue.pendingPaths().map(fileName), true);
      if (choice === "discard") {
        queue.discard();
        return;
      }
      if (choice === "cancel") return;
    }
  }

  /**
   * `beforeunload`: blocks closing/reloading while markup is unsaved (and saves it) or a migration runs
   * (cancelled after its current file).
   */
  function onBeforeUnload(event: { preventDefault(): void; returnValue?: unknown }): void {
    options.captureOpenEdits();
    if (!queue.hasPending() && !options.migration?.isRunning()) return;
    event.preventDefault();
    event.returnValue = false;
    // Already saving: this repeated close stays blocked; main sees it and shows its dialog right away.
    if (guarding) return;
    guarding = true;
    const notice = setTimeout(() => options.showNotice(SAVING_ON_CLOSE_TEXT), options.savingNoticeDelayMs ?? 500);
    void guardExit()
      .catch((e: unknown) => {
        // E.g. the IPC call failed. Not a silent "cancel": main did not hear back and shows its own dialog.
        log("Closing with unsaved markup: main takes over", e);
      })
      .finally(() => {
        clearTimeout(notice);
        options.hideNotice(SAVING_ON_CLOSE_TEXT);
        guarding = false;
      });
  }

  /**
   * Before the update restart (nothing blocked yet): cancels a running migration (after its current file),
   * saves everything; if that fails, asks the user and acts on the answer. `true` = may restart.
   */
  async function prepareToClose(): Promise<boolean> {
    if (options.migration?.isRunning()) await stopMigration();
    options.captureOpenEdits();
    for (;;) {
      if (await queue.flush()) return true;
      let choice: UnsavedMarkupChoice;
      try {
        choice = await options.ask(queue.pendingPaths().map(fileName), false);
      } catch (e) {
        log("Could not ask about unsaved markup", e);
        options.showNotice(UPDATE_ASK_FAILED_TEXT);
        return false;
      }
      if (choice === "discard") {
        queue.discard();
        return true;
      }
      if (choice === "cancel") return false;
    }
  }

  return { onBeforeUnload, prepareToClose, isGuarding: () => guarding };
}
