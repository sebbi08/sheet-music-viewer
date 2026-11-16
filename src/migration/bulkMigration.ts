/**
 * Flow of the bulk markup migration: candidates -> backup -> file by file. Framework-free and
 * electron-free: everything comes in through `BulkMigrationDeps`.
 */
import type { BackupResult } from "./backupZip";
import type { FileOutcome } from "./migrateFile";
import { PERMANENT_REASONS, type FailureReason, type MigrationCandidate } from "./types";

export interface MigrationSummary {
  migrated: number;
  zipName: string | null;
  failures: { relativePath: string; reason: FailureReason; message?: string }[];
  cancelledRemaining: number;
  backupError: string | null;
}

export type MigrationPhase =
  | { phase: "idle" }
  | { phase: "backup"; doneBytes: number; totalBytes: number }
  | { phase: "migrating"; index: number; total: number; current: string }
  | { phase: "done"; summary: MigrationSummary };

export interface BulkMigrationDeps {
  findCandidates(root: string): Promise<MigrationCandidate[]>;
  createBackup(
    root: string,
    c: MigrationCandidate[],
    onProgress: (p: { doneBytes: number; totalBytes: number }) => void,
  ): Promise<BackupResult>;
  cancelBackup(): Promise<void>;
  migrateFile(c: MigrationCandidate): Promise<FileOutcome>;
  recordSkip(c: MigrationCandidate, reason: FailureReason): Promise<void>;
  hasPending(pdfPath: string): boolean;
  onPhase(p: MigrationPhase): void;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** String-only basename: this runs in the renderer, too. */
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export class BulkMigration {
  private running: Promise<MigrationSummary | null> | null = null;
  private cancelled = false;

  constructor(private readonly deps: BulkMigrationDeps) {}

  isRunning(): boolean {
    return this.running !== null;
  }

  run(root: string): Promise<MigrationSummary | null> {
    if (this.running) return this.running;
    this.cancelled = false;
    const promise = this.execute(root).finally(() => {
      this.running = null;
    });
    this.running = promise;
    return promise;
  }

  cancel(): void {
    if (!this.running || this.cancelled) return;
    this.cancelled = true;
    // During the backup this stops it; afterwards it is a no-op. A failure must not escape.
    this.deps.cancelBackup().catch((e) => console.warn("Could not cancel the backup", e));
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

  private async execute(root: string): Promise<MigrationSummary | null> {
    const { deps } = this;
    let found: MigrationCandidate[];
    try {
      found = await deps.findCandidates(root);
    } catch (e) {
      console.warn("Could not search for legacy markup files", e);
      found = [];
    }
    if (found.length === 0) {
      deps.onPhase({ phase: "idle" });
      return null;
    }

    const summary: MigrationSummary = {
      migrated: 0,
      zipName: null,
      failures: [],
      cancelledRemaining: 0,
      backupError: null,
    };
    const fail = (c: MigrationCandidate, reason: FailureReason, message?: string) =>
      summary.failures.push({ relativePath: c.relativePath, reason, ...(message !== undefined ? { message } : {}) });
    const finish = () => {
      deps.onPhase({ phase: "done", summary });
      return summary;
    };

    const candidates: MigrationCandidate[] = [];
    for (const c of found) {
      if (deps.hasPending(c.pdfPath)) fail(c, "pendingChanges");
      else candidates.push(c);
    }

    let included: MigrationCandidate[] = [];
    if (candidates.length > 0) {
      deps.onPhase({ phase: "backup", doneBytes: 0, totalBytes: 0 });
      let backup: BackupResult;
      try {
        backup = await deps.createBackup(root, candidates, ({ doneBytes, totalBytes }) =>
          deps.onPhase({ phase: "backup", doneBytes, totalBytes }),
        );
      } catch (e) {
        backup = { status: "error", message: errorMessage(e) };
      }
      if (backup.status === "error") {
        summary.backupError = backup.message;
        return finish();
      }
      if (backup.status === "cancelled") {
        summary.cancelledRemaining = candidates.length;
        return finish();
      }
      summary.zipName = backup.zipPath === null ? null : baseName(backup.zipPath);
      for (const { candidate, message } of backup.excluded) fail(candidate, "notBackedUp", message);
      included = backup.included;
    }

    for (let i = 0; i < included.length; i++) {
      if (this.cancelled) {
        summary.cancelledRemaining = included.length - i;
        break;
      }
      const c = included[i];
      deps.onPhase({ phase: "migrating", index: i + 1, total: included.length, current: c.relativePath });
      let outcome: FileOutcome;
      try {
        outcome = await deps.migrateFile(c);
      } catch (e) {
        outcome = { kind: "failed", reason: "other", message: errorMessage(e) };
      }
      if (outcome.kind === "migrated") {
        summary.migrated++;
        continue;
      }
      fail(c, outcome.reason, outcome.message);
      if (PERMANENT_REASONS.has(outcome.reason)) {
        try {
          await deps.recordSkip(c, outcome.reason);
        } catch (e) {
          console.warn("Could not remember the skipped file", c.relativePath, e);
        }
      }
    }
    return finish();
  }
}
