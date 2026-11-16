import { describe, expect, test, vi } from "vitest";
import type { BackupResult } from "../../src/migration/backupZip";
import { BulkMigration, type BulkMigrationDeps, type MigrationPhase } from "../../src/migration/bulkMigration";
import type { FileOutcome } from "../../src/migration/migrateFile";
import type { FolderCheck } from "../../src/migration/readOnlyFolders";
import type { MigrationCandidate } from "../../src/migration/types";

const cand = (name: string): MigrationCandidate => ({
  pdfPath: `/s/${name}.pdf`,
  sidecarPath: `/s/.${name}.pdf.data`,
  relativePath: `${name}.pdf`,
});
const A = cand("a");
const B = cand("b");
const C = cand("c");
const migrated: FileOutcome = { kind: "migrated" };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(candidates: MigrationCandidate[], over: Partial<BulkMigrationDeps> = {}) {
  const phases: MigrationPhase[] = [];
  const deps: BulkMigrationDeps = {
    findCandidates: vi.fn(async () => candidates),
    checkFolder: vi.fn(async (): Promise<FolderCheck> => "writable"),
    createBackup: vi.fn(
      async (_root: string, c: MigrationCandidate[]): Promise<BackupResult> => ({
        status: "ok",
        zipPath: "/s/Markierungen-Backup 2026-11-16 10-00.zip",
        included: c,
        excluded: [],
      }),
    ),
    cancelBackup: vi.fn(async () => {}),
    migrateFile: vi.fn(async (_c: MigrationCandidate): Promise<FileOutcome> => migrated),
    recordSkip: vi.fn(async () => {}),
    hasPending: vi.fn(() => false),
    onPhase: (p) => phases.push(p),
  };
  // Overrides are spied on, too.
  for (const [key, fn] of Object.entries(over)) {
    (deps as unknown as Record<string, unknown>)[key] = vi.isMockFunction(fn) ? fn : vi.fn(fn as never);
  }
  return { deps, phases, bulk: new BulkMigration(deps) };
}

describe("BulkMigration", () => {
  test("no candidates -> null and no phases", async () => {
    const { bulk, phases, deps } = setup([]);
    expect(await bulk.run("/s")).toBeNull();
    expect(phases.every((p) => p.phase === "idle")).toBe(true);
    expect(deps.createBackup).not.toHaveBeenCalled();
    expect(bulk.isRunning()).toBe(false);
  });

  test("migrates all files and reports the zip name", async () => {
    const { bulk, phases } = setup([A, B]);
    const summary = await bulk.run("/s");
    expect(summary).toEqual({
      migrated: 2,
      zipName: "Markierungen-Backup 2026-11-16 10-00.zip",
      failures: [],
      cancelledRemaining: 0,
      backupError: null,
      readOnlyFolder: false,
    });
    expect(phases.filter((p) => p.phase === "migrating")).toEqual([
      { phase: "migrating", index: 1, total: 2, current: "a.pdf" },
      { phase: "migrating", index: 2, total: 2, current: "b.pdf" },
    ]);
    expect(phases.at(-1)).toEqual({ phase: "done", summary });
  });

  test("zip name works with Windows paths and a missing zip", async () => {
    const win = setup([A], {
      createBackup: async (_r, c) => ({ status: "ok", zipPath: "C:\\Noten\\x.zip", included: c, excluded: [] }),
    });
    expect((await win.bulk.run("/s"))?.zipName).toBe("x.zip");
    const none = setup([A], {
      createBackup: async (_r, c) => ({ status: "ok", zipPath: null, included: c, excluded: [] }),
    });
    expect((await none.bulk.run("/s"))?.zipName).toBeNull();
  });

  test("no candidates -> the folder is not checked", async () => {
    const { bulk, deps } = setup([]);
    await bulk.run("/s");
    expect(deps.checkFolder).not.toHaveBeenCalled();
  });

  test("read-only folder, first time -> only the read-only summary, no backup", async () => {
    const { bulk, deps, phases } = setup([A, B], { checkFolder: async () => "readOnlyReport" });
    const summary = await bulk.run("/s");
    expect(summary).toEqual({
      migrated: 0,
      zipName: null,
      failures: [],
      cancelledRemaining: 0,
      backupError: null,
      readOnlyFolder: true,
    });
    expect(deps.checkFolder).toHaveBeenCalledWith("/s");
    expect(phases).toEqual([{ phase: "done", summary }]);
    expect(deps.createBackup).not.toHaveBeenCalled();
    expect(deps.migrateFile).not.toHaveBeenCalled();
    expect(deps.recordSkip).not.toHaveBeenCalled();
  });

  test("read-only folder, already reported -> silent (null, no dialog)", async () => {
    const { bulk, deps, phases } = setup([A], { checkFolder: async () => "readOnlyKnown" });
    expect(await bulk.run("/s")).toBeNull();
    expect(phases.every((p) => p.phase === "idle")).toBe(true);
    expect(deps.createBackup).not.toHaveBeenCalled();
    expect(deps.migrateFile).not.toHaveBeenCalled();
  });

  test("a failing folder check does not stop the migration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { bulk } = setup([A], {
        checkFolder: async () => {
          throw new Error("ipc down");
        },
      });
      expect((await bulk.run("/s"))?.migrated).toBe(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("forwards backup progress", async () => {
    const { bulk, phases } = setup([A], {
      createBackup: async (_r, c, onProgress) => {
        onProgress({ doneBytes: 5, totalBytes: 10 });
        return { status: "ok", zipPath: null, included: c, excluded: [] };
      },
    });
    await bulk.run("/s");
    expect(phases).toContainEqual({ phase: "backup", doneBytes: 5, totalBytes: 10 });
  });

  test("backup error -> nothing migrated, backupError set", async () => {
    const { bulk, deps } = setup([A, B], { createBackup: async () => ({ status: "error", message: "disk full" }) });
    const summary = await bulk.run("/s");
    expect(summary).toMatchObject({ migrated: 0, backupError: "disk full", cancelledRemaining: 0 });
    expect(deps.migrateFile).not.toHaveBeenCalled();
    expect(deps.recordSkip).not.toHaveBeenCalled();
  });

  test("a rejecting backup counts as backup error", async () => {
    const { bulk } = setup([A], {
      createBackup: async () => {
        throw new Error("kaputt");
      },
    });
    expect((await bulk.run("/s"))?.backupError).toBe("kaputt");
  });

  test("excluded files fail as notBackedUp and are not recorded", async () => {
    const { bulk, deps } = setup([A, B], {
      createBackup: async () => ({
        status: "ok",
        zipPath: "/s/z.zip",
        included: [A],
        excluded: [{ candidate: B, message: "unreadable" }],
      }),
    });
    const summary = await bulk.run("/s");
    expect(summary?.migrated).toBe(1);
    expect(summary?.failures).toEqual([{ relativePath: "b.pdf", reason: "notBackedUp", message: "unreadable" }]);
    expect(deps.migrateFile).toHaveBeenCalledTimes(1);
    expect(deps.recordSkip).not.toHaveBeenCalled();
  });

  test("pending files are skipped as pendingChanges and not backed up", async () => {
    const { bulk, deps } = setup([A, B], { hasPending: (p) => p === A.pdfPath });
    const summary = await bulk.run("/s");
    expect(summary?.failures).toEqual([{ relativePath: "a.pdf", reason: "pendingChanges" }]);
    expect(summary?.migrated).toBe(1);
    expect(vi.mocked(deps.createBackup).mock.calls[0][1]).toEqual([B]);
    expect(deps.recordSkip).not.toHaveBeenCalled();
  });

  test("only pending files: no backup, no zip", async () => {
    const { bulk, deps } = setup([A], { hasPending: () => true });
    const summary = await bulk.run("/s");
    expect(deps.createBackup).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ migrated: 0, zipName: null });
    expect(summary?.failures).toHaveLength(1);
  });

  test("permanent failures are recorded after the attempt, transient ones not", async () => {
    const order: string[] = [];
    const outcomes: Record<string, FileOutcome> = {
      "a.pdf": { kind: "failed", reason: "corruptData" },
      "b.pdf": { kind: "failed", reason: "locked" },
      "c.pdf": { kind: "failed", reason: "other", message: "x" },
    };
    const { bulk, deps } = setup([A, B, C], {
      migrateFile: async (c) => {
        order.push(`migrate ${c.relativePath}`);
        return outcomes[c.relativePath];
      },
      recordSkip: async (c, reason) => {
        order.push(`skip ${c.relativePath} ${reason}`);
      },
    });
    const summary = await bulk.run("/s");
    expect(order).toEqual(["migrate a.pdf", "skip a.pdf corruptData", "migrate b.pdf", "migrate c.pdf"]);
    expect(summary?.failures).toEqual([
      { relativePath: "a.pdf", reason: "corruptData" },
      { relativePath: "b.pdf", reason: "locked" },
      { relativePath: "c.pdf", reason: "other", message: "x" },
    ]);
    expect(deps.recordSkip).toHaveBeenCalledTimes(1);
  });

  test("a failing recordSkip does not abort the run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { bulk, deps } = setup([A, B], {
      migrateFile: vi.fn(async (c: MigrationCandidate): Promise<FileOutcome> =>
        c === A ? { kind: "failed", reason: "notWritable" } : migrated,
      ),
      recordSkip: async () => {
        throw new Error("disk");
      },
    });
    const summary = await bulk.run("/s");
    expect(summary?.migrated).toBe(1);
    expect(deps.migrateFile).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test("a vanished file fails as other, the run continues", async () => {
    const { bulk } = setup([A, B], {
      migrateFile: vi.fn(async (c: MigrationCandidate): Promise<FileOutcome> => {
        if (c === A) throw new Error("ENOENT");
        return migrated;
      }),
    });
    const summary = await bulk.run("/s");
    expect(summary?.migrated).toBe(1);
    expect(summary?.failures).toEqual([{ relativePath: "a.pdf", reason: "other", message: "ENOENT" }]);
  });

  test("cancel finishes the current file and counts the rest", async () => {
    const gate = deferred<FileOutcome>();
    const { bulk, deps } = setup([A, B, C], {
      migrateFile: vi.fn((c: MigrationCandidate) => (c === A ? gate.promise : Promise.resolve(migrated))),
    });
    const run = bulk.run("/s");
    await vi.waitFor(() => expect(deps.migrateFile).toHaveBeenCalledTimes(1));
    bulk.cancel();
    gate.resolve(migrated);
    const summary = await run;
    expect(summary).toMatchObject({ migrated: 1, cancelledRemaining: 2 });
    expect(deps.migrateFile).toHaveBeenCalledTimes(1);
  });

  test("cancel during backup calls cancelBackup and migrates nothing", async () => {
    const gate = deferred<BackupResult>();
    const { bulk, deps } = setup([A, B], { createBackup: () => gate.promise });
    const run = bulk.run("/s");
    await vi.waitFor(() => expect(deps.createBackup).toHaveBeenCalled());
    bulk.cancel();
    expect(deps.cancelBackup).toHaveBeenCalledTimes(1);
    gate.resolve({ status: "cancelled" });
    const summary = await run;
    expect(summary).toMatchObject({ migrated: 0, cancelledRemaining: 2, backupError: null });
    expect(deps.migrateFile).not.toHaveBeenCalled();
  });

  test("a cancel that arrives as the backup finishes stops before the first file", async () => {
    const gate = deferred<BackupResult>();
    const { bulk, deps } = setup([A, B], { createBackup: () => gate.promise });
    const run = bulk.run("/s");
    await vi.waitFor(() => expect(deps.createBackup).toHaveBeenCalled());
    bulk.cancel();
    gate.resolve({ status: "ok", zipPath: "/s/z.zip", included: [A, B], excluded: [] });
    expect(await run).toMatchObject({ migrated: 0, cancelledRemaining: 2, zipName: "z.zip" });
    expect(deps.migrateFile).not.toHaveBeenCalled();
  });

  test("cancel during the candidate search makes no backup", async () => {
    const gate = deferred<MigrationCandidate[]>();
    const { bulk, deps } = setup([], { findCandidates: () => gate.promise });
    const run = bulk.run("/s");
    await vi.waitFor(() => expect(deps.findCandidates).toHaveBeenCalled());
    bulk.cancel();
    gate.resolve([A, B]);
    expect(await run).toMatchObject({ migrated: 0, cancelledRemaining: 2, zipName: null });
    expect(deps.createBackup).not.toHaveBeenCalled();
    expect(deps.migrateFile).not.toHaveBeenCalled();
  });

  test("a second run while running returns the running one", async () => {
    const gate = deferred<FileOutcome>();
    const { bulk, deps } = setup([A], { migrateFile: vi.fn(() => gate.promise) });
    const first = bulk.run("/s");
    const second = bulk.run("/s");
    expect(second).toBe(first);
    expect(bulk.isRunning()).toBe(true);
    await vi.waitFor(() => expect(deps.migrateFile).toHaveBeenCalled());
    gate.resolve(migrated);
    await first;
    expect(deps.findCandidates).toHaveBeenCalledTimes(1);
    expect(bulk.isRunning()).toBe(false);
  });

  test("cancelAndWait resolves after the current file", async () => {
    const gate = deferred<FileOutcome>();
    const { bulk, deps } = setup([A, B], { migrateFile: vi.fn(() => gate.promise) });
    const run = bulk.run("/s");
    await vi.waitFor(() => expect(deps.migrateFile).toHaveBeenCalledTimes(1));
    let waited = false;
    const waiting = bulk.cancelAndWait().then(() => (waited = true));
    await Promise.resolve();
    expect(waited).toBe(false);
    gate.resolve(migrated);
    await waiting;
    expect(bulk.isRunning()).toBe(false);
    expect((await run)?.cancelledRemaining).toBe(1);
  });

  test("cancelAndWait without a run resolves", async () => {
    const { bulk } = setup([A]);
    await expect(bulk.cancelAndWait()).resolves.toBeUndefined();
  });

  test("can run again after finishing", async () => {
    const { bulk, deps } = setup([A]);
    await bulk.run("/s");
    await bulk.run("/s");
    expect(deps.findCandidates).toHaveBeenCalledTimes(2);
  });
});
