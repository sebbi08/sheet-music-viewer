import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, test } from "vitest";
import type { BackupOptions, BackupResult } from "../../src/migration/backupZip";
import {
  BACKUP_PROGRESS_EVENT,
  backupProgress,
  cancelMigrationBackup,
  runMigrationBackup,
  type BackupProgress,
} from "../../src/migration/backupProgress";
import type { MigrationCandidate } from "../../src/migration/types";

const ok: BackupResult = { status: "ok", zipPath: null, included: [], excluded: [] };

/** Collects the emitted progress until `stop()`. */
function listen() {
  const events: BackupProgress[] = [];
  const listener = (p: BackupProgress) => events.push(p);
  backupProgress.on(BACKUP_PROGRESS_EVENT, listener);
  return { events, stop: () => backupProgress.off(BACKUP_PROGRESS_EVENT, listener) };
}

let dirs: string[] = [];
afterEach(() => {
  cancelMigrationBackup();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("runMigrationBackup", () => {
  test("emits the progress of the backup", async () => {
    const l = listen();
    const result = await runMigrationBackup("/noten", [], {
      minIntervalMs: 0,
      createBackup: async (_root, _c, options: BackupOptions) => {
        options.onProgress?.({ doneBytes: 1, totalBytes: 3 });
        options.onProgress?.({ doneBytes: 3, totalBytes: 3 });
        return ok;
      },
    });
    l.stop();
    expect(result).toEqual(ok);
    expect(l.events).toEqual([
      { doneBytes: 1, totalBytes: 3 },
      { doneBytes: 3, totalBytes: 3 },
    ]);
  });

  test("throttles progress, but always emits the first and the final one", async () => {
    const l = listen();
    await runMigrationBackup("/noten", [], {
      minIntervalMs: 60_000,
      createBackup: async (_root, _c, options: BackupOptions) => {
        for (let i = 1; i <= 100; i++) options.onProgress?.({ doneBytes: i, totalBytes: 100 });
        return ok;
      },
    });
    l.stop();
    expect(l.events).toEqual([
      { doneBytes: 1, totalBytes: 100 },
      { doneBytes: 100, totalBytes: 100 },
    ]);
  });

  test("cancelMigrationBackup aborts the running backup", async () => {
    let signal: AbortSignal | undefined;
    const running = runMigrationBackup("/noten", [], {
      createBackup: (_root, _c, options: BackupOptions) =>
        new Promise<BackupResult>((resolve) => {
          signal = options.signal;
          options.signal?.addEventListener("abort", () => resolve({ status: "cancelled" }));
        }),
    });
    cancelMigrationBackup();
    expect(await running).toEqual({ status: "cancelled" });
    expect(signal?.aborted).toBe(true);
  });

  test("at most one backup at a time; afterwards the next one starts fresh", async () => {
    let finish: (r: BackupResult) => void = () => {};
    const first = runMigrationBackup("/noten", [], {
      createBackup: () => new Promise<BackupResult>((resolve) => (finish = resolve)),
    });
    const second = await runMigrationBackup("/noten", [], { createBackup: async () => ok });
    expect(second.status).toBe("error");
    finish(ok);
    expect(await first).toEqual(ok);

    let signal: AbortSignal | undefined;
    await runMigrationBackup("/noten", [], {
      createBackup: async (_root, _c, options: BackupOptions) => {
        signal = options.signal;
        return ok;
      },
    });
    expect(signal?.aborted).toBe(false);
  });

  test("a throwing backup is reported as an error and frees the slot", async () => {
    const failed = await runMigrationBackup("/noten", [], {
      createBackup: async () => {
        throw new Error("disk gone");
      },
    });
    expect(failed).toEqual({ status: "error", message: "disk gone" });
    expect(await runMigrationBackup("/noten", [], { createBackup: async () => ok })).toEqual(ok);
  });

  test("with the real zip writer: writes the backup and reports the full progress", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "smv-backup-progress-"));
    dirs.push(root);
    fs.writeFileSync(path.join(root, "a.pdf"), "%PDF-1.4 test");
    fs.writeFileSync(path.join(root, ".a.data"), "[]");
    const c: MigrationCandidate = {
      pdfPath: path.join(root, "a.pdf"),
      sidecarPath: path.join(root, ".a.data"),
      relativePath: "a.pdf",
    };
    const l = listen();
    const result = await runMigrationBackup(root, [c], { minIntervalMs: 0 });
    l.stop();
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(fs.existsSync(result.zipPath!)).toBe(true);
    const last = l.events.at(-1);
    expect(last && last.doneBytes === last.totalBytes && last.totalBytes > 0).toBe(true);
  });
});
