/**
 * The running migration backup (main): its progress for the `onMigrationBackupProgress` subscription and
 * its AbortController for `cancelMigrationBackup`. At most one backup at a time. Electron-free.
 */
import { EventEmitter } from "events";
import { createBackupZip, type BackupOptions, type BackupResult } from "./backupZip";
import type { MigrationCandidate } from "./types";

export interface BackupProgress {
  doneBytes: number;
  totalBytes: number;
}

export const BACKUP_PROGRESS_EVENT = "progress";
/** Emits `BACKUP_PROGRESS_EVENT` with a `BackupProgress`. */
export const backupProgress = new EventEmitter();

let running: AbortController | null = null;

export interface RunBackupOptions {
  /** Progress is sent over IPC: at most one event per interval (default 100 ms), plus the final one. */
  minIntervalMs?: number;
  /** For tests. */
  createBackup?: (root: string, candidates: MigrationCandidate[], options: BackupOptions) => Promise<BackupResult>;
}

export async function runMigrationBackup(
  root: string,
  candidates: MigrationCandidate[],
  options: RunBackupOptions = {},
): Promise<BackupResult> {
  if (running) return { status: "error", message: "Es läuft bereits eine Sicherung" };
  const controller = new AbortController();
  running = controller;
  const minIntervalMs = options.minIntervalMs ?? 100;
  let lastEmit = -Infinity;
  const onProgress = (p: BackupProgress) => {
    const now = Date.now();
    if (p.doneBytes < p.totalBytes && now - lastEmit < minIntervalMs) return;
    lastEmit = now;
    backupProgress.emit(BACKUP_PROGRESS_EVENT, { doneBytes: p.doneBytes, totalBytes: p.totalBytes });
  };
  try {
    return await (options.createBackup ?? createBackupZip)(root, candidates, {
      now: new Date(),
      signal: controller.signal,
      onProgress,
    });
  } catch (e) {
    // createBackupZip never throws; this only guards the contract.
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  } finally {
    running = null;
  }
}

/** Aborts the running backup (it then resolves as `cancelled`); a no-op without one. */
export function cancelMigrationBackup(): void {
  running?.abort();
}
