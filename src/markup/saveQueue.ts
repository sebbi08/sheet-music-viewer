/**
 * Unsaved markup changes, kept outside the SheetViewer component (spec section 1, final review F1): they
 * survive leaving the sheet, take precedence over the file when the sheet is opened again, and are retried
 * every 30 s while saving fails and with every new save. A save sends the pending pages of one sheet into
 * its PDF, the only place markup is stored: a PDF that cannot be written is a failure like any other.
 * Framework-free (no Vue, no DOM): the renderer wraps it in a Pinia store (`src/store/markupSaves.ts`), the
 * logic is unit-tested in Node.
 */
import type { MarkupPayload, Rect, SaveMarkupInput, SaveMarkupResult } from "../models/markup";

/** What a page shows after the save; `null` = no markup (our stamp is removed). */
export type PageState = { rect: Rect | null; payload: MarkupPayload } | null;

export type SaveEvent =
  /** `firstFailure`: the sheet was saved fine (or never tried) before this failure. */
  | { type: "failed"; path: string; message: string; firstFailure: boolean }
  /** `afterFailure`: earlier attempts for this sheet had failed. Markup is saved into the PDF only. */
  | { type: "saved"; path: string; status: "pdf"; afterFailure: boolean };

export interface SaveQueueOptions {
  save(input: SaveMarkupInput): Promise<SaveMarkupResult>;
  /** Base64 PNG of the payload (the stamp's appearance). */
  renderPng(payload: MarkupPayload): Promise<string>;
  onEvent?(event: SaveEvent): void;
  /** Retry interval while a save fails; default 30 s. */
  retryIntervalMs?: number;
  /** Identity of a path (e.g. case-insensitive on Windows); default: the path itself. */
  keyOf?(path: string): string;
}

interface SheetState {
  /** The spelling used for saving (the first one seen). */
  path: string;
  /** Unsaved changes per 1-based page. */
  pages: Map<number, PageState>;
  /** Attempts run one after another; never rejects. */
  chain: Promise<void>;
  /** Attempts queued or running. */
  busy: number;
  failing: boolean;
}

export class MarkupSaveQueue {
  private readonly sheets = new Map<string, SheetState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: SaveQueueOptions) {}

  private key(path: string): string {
    return this.options.keyOf ? this.options.keyOf(path) : path;
  }

  private sheet(path: string): SheetState {
    const key = this.key(path);
    let sheet = this.sheets.get(key);
    if (!sheet) {
      sheet = { path, pages: new Map(), chain: Promise.resolve(), busy: 0, failing: false };
      this.sheets.set(key, sheet);
    }
    return sheet;
  }

  /** Records a page's new state and saves; sheets whose last save failed are retried as well. */
  setPage(path: string, page: number, state: PageState): void {
    this.setPages(path, [[page, state]]);
  }

  /** Like `setPage` for several pages, sent in one save. */
  setPages(path: string, changes: Iterable<[number, PageState]>): void {
    const sheet = this.sheet(path);
    for (const [page, state] of changes) sheet.pages.set(page, state);
    void this.enqueue(sheet);
    for (const other of this.sheets.values()) {
      if (other !== sheet && other.failing && other.pages.size > 0) void this.enqueue(other);
    }
  }

  /** Unsaved page states of `path` (a copy). */
  pendingPages(path: string): Map<number, PageState> {
    return new Map(this.sheets.get(this.key(path))?.pages ?? []);
  }

  pendingPaths(): string[] {
    return [...this.sheets.values()].filter((s) => s.pages.size > 0).map((s) => s.path);
  }

  /** Unsaved changes of `path` (or of any sheet), including those of a save in flight. */
  hasPending(path?: string): boolean {
    if (path !== undefined) return (this.sheets.get(this.key(path))?.pages.size ?? 0) > 0;
    return this.pendingPaths().length > 0;
  }

  /** Saves the pending changes of `path` (after the saves already queued for it). Never rejects. */
  save(path: string): Promise<void> {
    const sheet = this.sheets.get(this.key(path));
    return sheet ? this.enqueue(sheet) : Promise.resolve();
  }

  /**
   * For closing the window: waits for the saves in flight; sheets with pending changes and no save in
   * flight are tried once more. Resolves `true` when nothing is left unsaved.
   */
  async flush(): Promise<boolean> {
    const sheets = [...this.sheets.values()];
    const busy = sheets.filter((s) => s.busy > 0);
    await Promise.all(busy.map((s) => s.chain));
    await Promise.all(sheets.filter((s) => !busy.includes(s) && s.pages.size > 0).map((s) => this.enqueue(s)));
    return !this.hasPending();
  }

  /** Drops the unsaved changes of `path` (or of all sheets). */
  discard(path?: string): void {
    const sheets = path === undefined ? [...this.sheets.values()] : [this.sheets.get(this.key(path))];
    for (const sheet of sheets) {
      if (!sheet) continue;
      sheet.pages.clear();
      sheet.failing = false;
    }
    this.updateTimer();
  }

  /** Stops the retry timer. */
  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private enqueue(sheet: SheetState): Promise<void> {
    sheet.busy++;
    const run = sheet.chain
      .then(() => this.attempt(sheet))
      .finally(() => {
        sheet.busy--;
      });
    sheet.chain = run;
    return run;
  }

  private async attempt(sheet: SheetState): Promise<void> {
    if (sheet.pages.size === 0) return;
    const sent = [...sheet.pages.entries()].sort(([a], [b]) => a - b);

    let result: SaveMarkupResult;
    try {
      const pages: SaveMarkupInput["pages"] = [];
      for (const [page, state] of sent) {
        pages.push(
          state
            ? { page, payload: state.payload, pngBase64: await this.options.renderPng(state.payload) }
            : { page, payload: null, pngBase64: null },
        );
      }
      result = await this.options.save({ path: sheet.path, pages });
    } catch (e) {
      result = { status: "error", message: e instanceof Error ? e.message : String(e) };
    }

    if (result.status === "error") {
      // The pages stay pending: retried by the timer, with the next save and when the sheet is reopened.
      const firstFailure = !sheet.failing;
      sheet.failing = true;
      this.emit({ type: "failed", path: sheet.path, message: result.message ?? "unknown error", firstFailure });
    } else {
      for (const [page, state] of sent) {
        // A page changed again while saving stays pending.
        if (sheet.pages.has(page) && sheet.pages.get(page) === state) sheet.pages.delete(page);
      }
      const afterFailure = sheet.failing;
      sheet.failing = false;
      this.emit({ type: "saved", path: sheet.path, status: result.status, afterFailure });
    }
    this.updateTimer();
  }

  private emit(event: SaveEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch (e) {
      console.warn("Markup save event handler failed", e);
    }
  }

  /** The retry timer runs while some sheet with pending changes has failed. */
  private updateTimer(): void {
    const needed = [...this.sheets.values()].some((s) => s.failing && s.pages.size > 0);
    if (needed && this.timer === null) {
      this.timer = setInterval(() => {
        for (const sheet of this.sheets.values()) {
          if (sheet.failing && sheet.pages.size > 0 && sheet.busy === 0) void this.enqueue(sheet);
        }
      }, this.options.retryIntervalMs ?? 30_000);
    } else if (!needed && this.timer !== null) {
      this.dispose();
    }
  }
}
