/**
 * Flow of the migration gate: scan -> pass 1 (check every file, write nothing) -> backup -> pass 2 (write
 * every file) -> mark the folder as migrated. Runs in the renderer: no Node or Electron imports,
 * everything comes in through `GateDeps`.
 */
import type { BackupResult } from "./backupZip";
import { sidecarNameOf, type FileOutcome } from "./processFile";
import type { GateFailure, GateFailureReason, MigrationCandidate, ScanError, ScanResult } from "./types";

export interface GateSummary {
  migrated: number;
  zipName: string | null;
}

export interface GateFailed {
  status: "failed";
  stage: "check" | "write";
  total: number;
  migrated: number;
  zipName: string | null;
  failures: GateFailure[];
}

export type GateResult = { status: "passed"; summary: GateSummary | null } | GateFailed | { status: "cancelled" };

export type GatePhase =
  | { phase: "idle" }
  | { phase: "scanning" }
  | { phase: "checking"; index: number; total: number; current: string }
  | { phase: "backup"; doneBytes: number; totalBytes: number }
  | { phase: "migrating"; index: number; total: number; current: string }
  | { phase: "failed"; result: GateFailed }
  | { phase: "done"; summary: GateSummary };

export interface GateDeps {
  isMigrated(root: string): Promise<boolean>;
  flushPending(): Promise<void>;
  scan(root: string): Promise<ScanResult>;
  hasPending(pdfPath: string): boolean;
  processFile(c: MigrationCandidate, mode: "check" | "write"): Promise<FileOutcome>;
  createBackup(
    root: string,
    c: MigrationCandidate[],
    onProgress: (p: { doneBytes: number; totalBytes: number }) => void,
  ): Promise<BackupResult>;
  cancelBackup(): Promise<void>;
  markMigrated(root: string): Promise<void>;
  onPhase(p: GatePhase): void;
}

/** Reasons whose text names the `.data` file. */
const NAMES_SIDECAR: ReadonlySet<GateFailureReason> = new Set<GateFailureReason>([
  "dataDamaged",
  "renderFailed",
  "dataUnreadable",
  "conflict",
  "sidecarNotDeleted",
]);

const CANCELLED = Symbol("cancelled");

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** String-only basename: this runs in the renderer. */
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** The scan names the sheet folder itself `.`; the list names it by its path. */
function scanFailure(root: string, { relativePath, kind, message }: ScanError): GateFailure {
  return {
    relativePath: relativePath === "." ? root : relativePath,
    reason: kind === "folder" ? "folderUnreadable" : "linkUnreadable",
    message,
  };
}

function fileFailure(c: MigrationCandidate, reason: GateFailureReason, message?: string): GateFailure {
  return {
    relativePath: c.relativePath,
    reason,
    ...(message !== undefined ? { message } : {}),
    ...(NAMES_SIDECAR.has(reason) ? { sidecarName: sidecarNameOf(c) } : {}),
  };
}

export class MigrationGate {
  private running: Promise<GateResult> | null = null;
  private cancelled = false;
  private inBackup = false;
  /** Settles when `cancel()` is called during the current run (flush and scan stop waiting at once). */
  private cancelSignal: Promise<typeof CANCELLED> = new Promise(() => {});
  private signalCancel: () => void = () => undefined;

  constructor(private readonly deps: GateDeps) {}

  isRunning(): boolean {
    return this.running !== null;
  }

  /** A second call while one runs joins it. */
  run(root: string): Promise<GateResult> {
    if (this.running) return this.running;
    this.cancelled = false;
    this.cancelSignal = new Promise((resolve) => (this.signalCancel = () => resolve(CANCELLED)));
    const promise = this.execute(root)
      .then((result) => {
        if (result.status !== "cancelled") return result;
        this.deps.onPhase({ phase: "idle" });
        return result;
      })
      .finally(() => {
        this.running = null;
      });
    this.running = promise;
    return promise;
  }

  cancel(): void {
    if (!this.running || this.cancelled) return;
    this.cancelled = true;
    this.signalCancel();
    // A failure must not escape: the backup's own result then says what happened.
    if (this.inBackup) this.deps.cancelBackup().catch((e) => console.warn("Could not cancel the backup", e));
  }

  async cancelAndWait(): Promise<void> {
    const running = this.running;
    if (!running) return;
    this.cancel();
    try {
      await running;
    } catch {
      // the caller of run() sees the error
    }
  }

  /** `p`, or `CANCELLED` as soon as the run is cancelled (only for steps that create nothing in the folder). */
  private untilCancelled<T>(p: Promise<T>): Promise<T | typeof CANCELLED> {
    return Promise.race([p, this.cancelSignal]);
  }

  private async markMigrated(root: string): Promise<void> {
    try {
      await this.deps.markMigrated(root);
    } catch (e) {
      // The gate then simply runs again on the next start.
      console.warn("Could not remember the migrated sheet folder", e);
    }
  }

  private async execute(root: string): Promise<GateResult> {
    const { deps } = this;
    let migrated = false;
    try {
      migrated = await deps.isMigrated(root);
    } catch (e) {
      console.warn("Could not read the list of migrated sheet folders", e);
    }
    if (migrated) {
      deps.onPhase({ phase: "idle" });
      return { status: "passed", summary: null };
    }

    deps.onPhase({ phase: "scanning" });
    const flushed = await this.untilCancelled(
      deps.flushPending().catch((e) => console.warn("Could not save pending markup changes", e)),
    );
    if (flushed === CANCELLED) return { status: "cancelled" };

    const failures: GateFailure[] = [];
    const failedResult = (stage: "check" | "write", total: number, migratedCount: number, zipName: string | null) => {
      const result: GateFailed = { status: "failed", stage, total, migrated: migratedCount, zipName, failures };
      deps.onPhase({ phase: "failed", result });
      return result;
    };

    let scan: ScanResult | typeof CANCELLED;
    try {
      scan = await this.untilCancelled(deps.scan(root));
    } catch (e) {
      // A failed scan never counts as "nothing found".
      failures.push({ relativePath: root, reason: "folderUnreadable", message: errorMessage(e) });
      return failedResult("check", 0, 0, null);
    }
    if (scan === CANCELLED) return { status: "cancelled" };
    failures.push(...scan.errors.map((error) => scanFailure(root, error)));

    // Pass 1: every file, also after failures; nothing is written.
    const { candidates } = scan;
    const toWrite: MigrationCandidate[] = [];
    let failedFiles = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (this.cancelled) return { status: "cancelled" };
      const c = candidates[i];
      deps.onPhase({ phase: "checking", index: i + 1, total: candidates.length, current: c.relativePath });
      if (deps.hasPending(c.pdfPath)) {
        failures.push(fileFailure(c, "pendingChanges"));
        failedFiles++;
        continue;
      }
      // Not raced against the cancel: the check may have the folder probe in flight in main, and the app
      // closes once the run ends. The current file finishes; a cancel stops before the next one.
      const outcome = await this.processFile(c, "check");
      if (this.cancelled) return { status: "cancelled" };
      if (outcome.kind === "ok") toWrite.push(c);
      else if (outcome.kind === "failed") {
        failures.push(fileFailure(c, outcome.reason, outcome.message));
        failedFiles++;
      }
      // "gone": the sidecar vanished since the scan, the file is no candidate any more.
    }
    if (this.cancelled) return { status: "cancelled" };
    if (failures.length > 0) return failedResult("check", toWrite.length + failedFiles, 0, null);

    if (toWrite.length === 0) {
      await this.markMigrated(root);
      deps.onPhase({ phase: "idle" });
      return { status: "passed", summary: null };
    }

    // Backup of every file that is about to change; incomplete means nothing is written.
    deps.onPhase({ phase: "backup", doneBytes: 0, totalBytes: 0 });
    let backup: BackupResult;
    this.inBackup = true;
    try {
      backup = await deps.createBackup(root, toWrite, ({ doneBytes, totalBytes }) =>
        deps.onPhase({ phase: "backup", doneBytes, totalBytes }),
      );
    } catch (e) {
      backup = { status: "error", message: errorMessage(e) };
    } finally {
      this.inBackup = false;
    }
    if (backup.status === "cancelled" || this.cancelled) return { status: "cancelled" };
    if (backup.status === "error") {
      failures.push({ relativePath: null, reason: "backupFailed", message: backup.message });
      return failedResult("write", toWrite.length, 0, null);
    }
    const zipName = backup.zipPath === null ? null : baseName(backup.zipPath);

    // Pass 2: every file, also after failures; each one is recomputed from its current bytes.
    let migratedCount = 0;
    for (let i = 0; i < toWrite.length; i++) {
      // The current file always finishes; a cancel stops before the next one.
      if (this.cancelled) return { status: "cancelled" };
      const c = toWrite[i];
      deps.onPhase({ phase: "migrating", index: i + 1, total: toWrite.length, current: c.relativePath });
      const outcome = await this.processFile(c, "write");
      if (outcome.kind === "ok") migratedCount++;
      else if (outcome.kind === "failed") failures.push(fileFailure(c, outcome.reason, outcome.message));
    }
    if (this.cancelled) return { status: "cancelled" };
    if (failures.length > 0) return failedResult("write", toWrite.length, migratedCount, zipName);

    await this.markMigrated(root);
    const summary: GateSummary = { migrated: migratedCount, zipName };
    deps.onPhase({ phase: "done", summary });
    return { status: "passed", summary };
  }

  /** `deps.processFile`, with a rejection as a failure of that file. */
  private async processFile(c: MigrationCandidate, mode: "check" | "write"): Promise<FileOutcome> {
    try {
      return await this.deps.processFile(c, mode);
    } catch (e) {
      return { kind: "failed", reason: "other", message: errorMessage(e) };
    }
  }
}
