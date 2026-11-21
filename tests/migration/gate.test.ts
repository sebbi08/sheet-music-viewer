import { describe, expect, test, vi } from "vitest";
import type { BackupResult } from "../../src/migration/backupZip";
import { MigrationGate, type GateDeps, type GateFailed, type GatePhase } from "../../src/migration/gate";
import type { FileOutcome } from "../../src/migration/processFile";
import type { GateFailureReason, MigrationCandidate, ScanResult } from "../../src/migration/types";

const cand = (name: string): MigrationCandidate => ({
  pdfPath: `/s/${name}.pdf`,
  sidecarPath: `/s/.${name}.data`,
  relativePath: `${name}.pdf`,
});
const A = cand("a");
const B = cand("b");
const C = cand("c");
const ok: FileOutcome = { kind: "ok", plan: "migrate" };
const gone: FileOutcome = { kind: "gone" };
const failed = (reason: GateFailureReason, message?: string): FileOutcome =>
  message === undefined ? { kind: "failed", reason } : { kind: "failed", reason, message };
const ZIP = "/s/Markierungen-Backup 2026-11-16 10-00.zip";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(candidates: MigrationCandidate[], over: Partial<GateDeps> = {}) {
  const phases: GatePhase[] = [];
  const deps: GateDeps = {
    isMigrated: vi.fn(async () => false),
    flushPending: vi.fn(async () => {}),
    scan: vi.fn(async (): Promise<ScanResult> => ({ candidates, errors: [] })),
    hasPending: vi.fn(() => false),
    processFile: vi.fn(async (): Promise<FileOutcome> => ok),
    createBackup: vi.fn(
      async (_root: string, c: MigrationCandidate[]): Promise<BackupResult> => ({
        status: "ok",
        zipPath: ZIP,
        included: c,
      }),
    ),
    cancelBackup: vi.fn(async () => {}),
    markMigrated: vi.fn(async () => {}),
    onPhase: (p) => phases.push(p),
  };
  // Overrides are spied on, too.
  for (const [key, fn] of Object.entries(over)) {
    (deps as unknown as Record<string, unknown>)[key] = vi.isMockFunction(fn) ? fn : vi.fn(fn as never);
  }
  return { deps, phases, gate: new MigrationGate(deps) };
}

const writeCalls = (deps: GateDeps) => vi.mocked(deps.processFile).mock.calls.filter(([, mode]) => mode === "write");

describe("MigrationGate", () => {
  test("a migrated folder: passed without scan, no phase but idle", async () => {
    const { gate, deps, phases } = setup([A], { isMigrated: async () => true });
    expect(await gate.run("/s")).toEqual({ status: "passed", summary: null });
    expect(deps.isMigrated).toHaveBeenCalledWith("/s");
    expect(deps.scan).not.toHaveBeenCalled();
    expect(deps.flushPending).not.toHaveBeenCalled();
    expect(deps.markMigrated).not.toHaveBeenCalled();
    expect(phases.every((p) => p.phase === "idle")).toBe(true);
    expect(gate.isRunning()).toBe(false);
  });

  test("a failing isMigrated counts as not migrated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { gate, deps } = setup([], {
        isMigrated: async () => {
          throw new Error("ipc down");
        },
      });
      expect(await gate.run("/s")).toEqual({ status: "passed", summary: null });
      expect(deps.scan).toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("no candidates and a complete scan: marked, passed with summary null, no backup", async () => {
    const { gate, deps, phases } = setup([]);
    expect(await gate.run("/s")).toEqual({ status: "passed", summary: null });
    expect(deps.markMigrated).toHaveBeenCalledWith("/s");
    expect(deps.createBackup).not.toHaveBeenCalled();
    expect(deps.processFile).not.toHaveBeenCalled();
    expect(phases.at(-1)).toEqual({ phase: "idle" });
  });

  test("a failing scan: failed with folderUnreadable for '.', not marked", async () => {
    const { gate, deps, phases } = setup([], {
      scan: async () => {
        throw new Error("EACCES: permission denied");
      },
    });
    const result = await gate.run("/s");
    expect(result).toEqual({
      status: "failed",
      stage: "check",
      total: 0,
      migrated: 0,
      zipName: null,
      failures: [{ relativePath: ".", reason: "folderUnreadable", message: "EACCES: permission denied" }],
    });
    expect(deps.markMigrated).not.toHaveBeenCalled();
    expect(deps.createBackup).not.toHaveBeenCalled();
    expect(phases.at(-1)).toEqual({ phase: "failed", result });
  });

  test("scan errors are listed and every candidate is still checked", async () => {
    const { gate, deps } = setup([], {
      scan: async () => ({
        candidates: [A, B],
        errors: [
          { relativePath: "Pop", kind: "folder", message: "EACCES" },
          { relativePath: "Link", kind: "link", message: "ENOENT" },
        ],
      }),
    });
    const result = await gate.run("/s");
    expect(result).toMatchObject({ status: "failed", stage: "check", total: 2, migrated: 0, zipName: null });
    expect((result as GateFailed).failures).toEqual([
      { relativePath: "Pop", reason: "folderUnreadable", message: "EACCES" },
      { relativePath: "Link", reason: "linkUnreadable", message: "ENOENT" },
    ]);
    expect(deps.processFile).toHaveBeenCalledTimes(2);
    expect(deps.processFile).toHaveBeenCalledWith(A, "check");
    expect(deps.processFile).toHaveBeenCalledWith(B, "check");
    expect(deps.createBackup).not.toHaveBeenCalled();
    expect(deps.markMigrated).not.toHaveBeenCalled();
  });

  test("pass 1 checks every file even after failures and lists all of them", async () => {
    const { gate, deps } = setup([A, B, C], { processFile: async (c) => (c === B ? ok : failed("dataDamaged")) });
    const result = await gate.run("/s");
    expect(result).toMatchObject({ status: "failed", stage: "check", total: 3, migrated: 0, zipName: null });
    expect((result as GateFailed).failures.map((f) => f.relativePath)).toEqual(["a.pdf", "c.pdf"]);
    expect(deps.processFile).toHaveBeenCalledTimes(3);
    expect(deps.createBackup).not.toHaveBeenCalled();
    expect(deps.markMigrated).not.toHaveBeenCalled();
    expect(deps.processFile).not.toHaveBeenCalledWith(expect.anything(), "write");
  });

  test("a candidate with unsaved changes is a pendingChanges failure and is not processed", async () => {
    const { gate, deps } = setup([A, B], { hasPending: (p) => p === A.pdfPath });
    const result = await gate.run("/s");
    expect(result).toMatchObject({ status: "failed", stage: "check", total: 2 });
    expect((result as GateFailed).failures).toEqual([{ relativePath: "a.pdf", reason: "pendingChanges" }]);
    expect(deps.processFile).toHaveBeenCalledTimes(1);
    expect(deps.processFile).toHaveBeenCalledWith(B, "check");
    expect(deps.createBackup).not.toHaveBeenCalled();
  });

  test("pending saves are flushed before the scan", async () => {
    const order: string[] = [];
    const { gate } = setup([A], {
      flushPending: async () => {
        order.push("flush");
      },
      scan: async () => {
        order.push("scan");
        return { candidates: [A], errors: [] };
      },
      hasPending: () => {
        order.push("hasPending");
        return false;
      },
    });
    await gate.run("/s");
    expect(order).toEqual(["flush", "scan", "hasPending"]);
  });

  test("a failing flush does not stop the gate; a file still pending then fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { gate } = setup([A], {
        flushPending: async () => {
          throw new Error("save failed");
        },
        hasPending: () => true,
      });
      const result = await gate.run("/s");
      expect((result as GateFailed).failures).toEqual([{ relativePath: "a.pdf", reason: "pendingChanges" }]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("gone candidates are dropped; if none is left the folder is marked without a backup", async () => {
    const all = setup([A, B], { processFile: async () => gone });
    expect(await all.gate.run("/s")).toEqual({ status: "passed", summary: null });
    expect(all.deps.createBackup).not.toHaveBeenCalled();
    expect(all.deps.markMigrated).toHaveBeenCalledWith("/s");
    expect(writeCalls(all.deps)).toEqual([]);

    const some = setup([A, B], { processFile: async (c) => (c === A ? gone : ok) });
    expect(await some.gate.run("/s")).toEqual({
      status: "passed",
      summary: { migrated: 1, zipName: "Markierungen-Backup 2026-11-16 10-00.zip" },
    });
    expect(vi.mocked(some.deps.createBackup).mock.calls[0][1]).toEqual([B]);
    expect(writeCalls(some.deps).map(([c]) => c)).toEqual([B]);
  });

  test("clean pass 1: backup of all candidates, then every file in write mode, marked, phase done", async () => {
    const order: string[] = [];
    const plans: Record<string, FileOutcome> = {
      "a.pdf": { kind: "ok", plan: "deleteEmpty" },
      "b.pdf": { kind: "ok", plan: "deleteMigrated" },
    };
    const { gate, deps, phases } = setup([A, B], {
      processFile: async (c, mode) => {
        order.push(`${mode} ${c.relativePath}`);
        return plans[c.relativePath];
      },
      createBackup: async (_r, c) => {
        order.push(`backup ${c.map((x) => x.relativePath).join(",")}`);
        return { status: "ok", zipPath: ZIP, included: c };
      },
      markMigrated: async () => {
        order.push("mark");
      },
    });
    const result = await gate.run("/s");
    const summary = { migrated: 2, zipName: "Markierungen-Backup 2026-11-16 10-00.zip" };
    expect(result).toEqual({ status: "passed", summary });
    expect(order).toEqual(["check a.pdf", "check b.pdf", "backup a.pdf,b.pdf", "write a.pdf", "write b.pdf", "mark"]);
    expect(vi.mocked(deps.createBackup).mock.calls[0][0]).toBe("/s");
    expect(phases.at(-1)).toEqual({ phase: "done", summary });
  });

  test("the zip name works with Windows paths", async () => {
    const { gate } = setup([A], {
      createBackup: async (_r, c) => ({ status: "ok", zipPath: "C:\\Noten\\x.zip", included: c }),
    });
    expect(await gate.run("/s")).toEqual({ status: "passed", summary: { migrated: 1, zipName: "x.zip" } });
  });

  test("backup error: failed stage write with one backupFailed failure (relativePath null), no file written", async () => {
    const error = setup([A, B], { createBackup: async () => ({ status: "error", message: "Nicht lesbar: b.pdf" }) });
    const result = await error.gate.run("/s");
    expect(result).toEqual({
      status: "failed",
      stage: "write",
      total: 2,
      migrated: 0,
      zipName: null,
      failures: [{ relativePath: null, reason: "backupFailed", message: "Nicht lesbar: b.pdf" }],
    });
    expect(writeCalls(error.deps)).toEqual([]);
    expect(error.deps.markMigrated).not.toHaveBeenCalled();
    expect(error.phases.at(-1)).toEqual({ phase: "failed", result });

    const rejects = setup([A], {
      createBackup: async () => {
        throw new Error("ipc down");
      },
    });
    expect(await rejects.gate.run("/s")).toMatchObject({
      status: "failed",
      stage: "write",
      failures: [{ relativePath: null, reason: "backupFailed", message: "ipc down" }],
    });
    expect(writeCalls(rejects.deps)).toEqual([]);
  });

  test("pass 2 goes on after a failure; the folder is not marked", async () => {
    const { gate, deps, phases } = setup([A, B, C], {
      processFile: async (c, mode) => (mode === "write" && c === A ? failed("locked") : ok),
    });
    const result = await gate.run("/s");
    expect(result).toEqual({
      status: "failed",
      stage: "write",
      total: 3,
      migrated: 2,
      zipName: "Markierungen-Backup 2026-11-16 10-00.zip",
      failures: [{ relativePath: "a.pdf", reason: "locked" }],
    });
    expect(writeCalls(deps).map(([c]) => c)).toEqual([A, B, C]);
    expect(deps.markMigrated).not.toHaveBeenCalled();
    expect(phases.at(-1)).toEqual({ phase: "failed", result });
  });

  test("a file that passed the check but fails in write mode is reported (changed in between)", async () => {
    // The PDF got other markup between the passes (e.g. a sync): pass 2 recomputes and reports it.
    const { gate, deps } = setup([A, B], {
      processFile: async (c, mode) => (mode === "write" && c === B ? failed("conflict") : ok),
    });
    const result = await gate.run("/s");
    expect(result).toMatchObject({ status: "failed", stage: "write", total: 2, migrated: 1 });
    expect((result as GateFailed).failures).toEqual([{ relativePath: "b.pdf", reason: "conflict", sidecarName: ".b.data" }]);
    expect(deps.processFile).toHaveBeenCalledWith(B, "check");
    expect(deps.processFile).toHaveBeenCalledWith(B, "write");
  });

  test("a gone file in pass 2 is neither migrated nor a failure", async () => {
    const { gate, deps } = setup([A, B], { processFile: async (c, mode) => (mode === "write" && c === A ? gone : ok) });
    expect(await gate.run("/s")).toEqual({
      status: "passed",
      summary: { migrated: 1, zipName: "Markierungen-Backup 2026-11-16 10-00.zip" },
    });
    expect(deps.markMigrated).toHaveBeenCalled();
  });

  test("a rejecting processFile is a failure of that file, the run goes on", async () => {
    const { gate, deps } = setup([A, B], {
      processFile: async (c) => {
        if (c === A) throw new Error("ipc down");
        return ok;
      },
    });
    const result = await gate.run("/s");
    expect((result as GateFailed).failures).toEqual([{ relativePath: "a.pdf", reason: "other", message: "ipc down" }]);
    expect(deps.processFile).toHaveBeenCalledWith(B, "check");
  });

  test("failures carry sidecarName for dataDamaged, renderFailed, dataUnreadable, conflict and sidecarNotDeleted", async () => {
    const D = cand("d");
    const E = cand("e");
    const F = cand("f");
    const reasons: Record<string, FileOutcome> = {
      "a.pdf": failed("dataDamaged"),
      "b.pdf": failed("dataUnreadable", "EACCES"),
      "c.pdf": failed("conflict"),
      "d.pdf": failed("sidecarNotDeleted", "EBUSY"),
      "e.pdf": failed("encrypted"),
      "f.pdf": failed("renderFailed", "canvas too large"),
    };
    const { gate } = setup([A, B, C, D, E, F], { processFile: async (c) => reasons[c.relativePath] });
    const result = await gate.run("/s");
    expect((result as GateFailed).failures).toEqual([
      { relativePath: "a.pdf", reason: "dataDamaged", sidecarName: ".a.data" },
      { relativePath: "b.pdf", reason: "dataUnreadable", message: "EACCES", sidecarName: ".b.data" },
      { relativePath: "c.pdf", reason: "conflict", sidecarName: ".c.data" },
      { relativePath: "d.pdf", reason: "sidecarNotDeleted", message: "EBUSY", sidecarName: ".d.data" },
      { relativePath: "e.pdf", reason: "encrypted" },
      { relativePath: "f.pdf", reason: "renderFailed", message: "canvas too large", sidecarName: ".f.data" },
    ]);
  });

  test("cancel during the scan still ends at once", async () => {
    // The scan never settles (a stalled share), the run still ends.
    const { gate, deps, phases } = setup([], { scan: () => new Promise<ScanResult>(() => {}) });
    const run = gate.run("/s");
    await vi.waitFor(() => expect(deps.scan).toHaveBeenCalled());
    gate.cancel();
    expect(await run).toEqual({ status: "cancelled" });
    expect(deps.processFile).not.toHaveBeenCalled();
    expect(deps.markMigrated).not.toHaveBeenCalled();
    expect(phases.at(-1)).toEqual({ phase: "idle" });
    expect(gate.isRunning()).toBe(false);
  });

  test("cancel while pending saves are flushed still ends at once", async () => {
    const { gate, deps, phases } = setup([A], { flushPending: () => new Promise<void>(() => {}) });
    const run = gate.run("/s");
    await vi.waitFor(() => expect(deps.flushPending).toHaveBeenCalled());
    gate.cancel();
    expect(await run).toEqual({ status: "cancelled" });
    expect(deps.scan).not.toHaveBeenCalled();
    expect(phases.at(-1)).toEqual({ phase: "idle" });
  });

  test("cancel during pass 1 waits for the file being checked, then ends without checking the next one", async () => {
    // The check of a file may create the folder probe in the main process: the run must not end (and the
    // app must not close) while it is in flight.
    const current = deferred<FileOutcome>();
    const { gate, deps, phases } = setup([A, B], {
      processFile: (c) => (c === A ? current.promise : Promise.resolve(ok)),
    });
    const run = gate.run("/s");
    await vi.waitFor(() => expect(deps.processFile).toHaveBeenCalledTimes(1));
    gate.cancel();
    let settled = false;
    void run.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    expect(gate.isRunning()).toBe(true);

    current.resolve(ok);
    expect(await run).toEqual({ status: "cancelled" });
    expect(deps.processFile).toHaveBeenCalledTimes(1);
    expect(deps.processFile).toHaveBeenCalledWith(A, "check");
    expect(deps.createBackup).not.toHaveBeenCalled();
    expect(deps.cancelBackup).not.toHaveBeenCalled();
    expect(deps.markMigrated).not.toHaveBeenCalled();
    expect(phases.at(-1)).toEqual({ phase: "idle" });
    expect(gate.isRunning()).toBe(false);
  });

  test("cancelAndWait during pass 1 resolves only after the file being checked", async () => {
    const current = deferred<FileOutcome>();
    const { gate, deps } = setup([A, B], { processFile: () => current.promise });
    const run = gate.run("/s");
    await vi.waitFor(() => expect(deps.processFile).toHaveBeenCalledTimes(1));
    let waited = false;
    const waiting = gate.cancelAndWait().then(() => (waited = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(waited).toBe(false);
    current.resolve(failed("dataDamaged"));
    await waiting;
    expect(await run).toEqual({ status: "cancelled" });
    expect(deps.processFile).toHaveBeenCalledTimes(1);
  });

  test("cancel during the backup: cancelBackup is called, cancelled", async () => {
    const backup = deferred<BackupResult>();
    const { gate, deps, phases } = setup([A, B], { createBackup: () => backup.promise });
    const run = gate.run("/s");
    await vi.waitFor(() => expect(deps.createBackup).toHaveBeenCalled());
    gate.cancel();
    expect(deps.cancelBackup).toHaveBeenCalledTimes(1);
    backup.resolve({ status: "cancelled" });
    expect(await run).toEqual({ status: "cancelled" });
    expect(writeCalls(deps)).toEqual([]);
    expect(deps.markMigrated).not.toHaveBeenCalled();
    expect(phases.at(-1)).toEqual({ phase: "idle" });
  });

  test("a cancel that arrives as the backup finishes stops before the first file", async () => {
    const backup = deferred<BackupResult>();
    const { gate, deps } = setup([A, B], { createBackup: () => backup.promise });
    const run = gate.run("/s");
    await vi.waitFor(() => expect(deps.createBackup).toHaveBeenCalled());
    gate.cancel();
    backup.resolve({ status: "ok", zipPath: ZIP, included: [A, B] });
    expect(await run).toEqual({ status: "cancelled" });
    expect(writeCalls(deps)).toEqual([]);
  });

  test("cancel during pass 2: the current file finishes, then cancelled, not marked", async () => {
    const current = deferred<FileOutcome>();
    let finished = false;
    const { gate, deps, phases } = setup([A, B, C], {
      processFile: (c, mode) =>
        mode === "write" && c === A ? current.promise.then((o) => ((finished = true), o)) : Promise.resolve(ok),
    });
    const run = gate.run("/s");
    await vi.waitFor(() => expect(writeCalls(deps)).toHaveLength(1));
    gate.cancel();
    expect(deps.cancelBackup).not.toHaveBeenCalled();
    let settled = false;
    void run.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    current.resolve(ok);
    expect(await run).toEqual({ status: "cancelled" });
    expect(finished).toBe(true);
    expect(writeCalls(deps).map(([c]) => c)).toEqual([A]);
    expect(deps.markMigrated).not.toHaveBeenCalled();
    expect(phases.at(-1)).toEqual({ phase: "idle" });
  });

  test("a second run while one is running returns the same promise", async () => {
    const current = deferred<FileOutcome>();
    const { gate, deps } = setup([A], { processFile: () => current.promise });
    const first = gate.run("/s");
    const second = gate.run("/s");
    expect(second).toBe(first);
    expect(gate.isRunning()).toBe(true);
    await vi.waitFor(() => expect(deps.processFile).toHaveBeenCalled());
    current.resolve(gone);
    await first;
    expect(deps.scan).toHaveBeenCalledTimes(1);
    expect(gate.isRunning()).toBe(false);
    await gate.run("/s");
    expect(deps.scan).toHaveBeenCalledTimes(2);
  });

  test("cancelAndWait resolves after the current file of pass 2; without a run at once", async () => {
    const idle = setup([A]);
    await expect(idle.gate.cancelAndWait()).resolves.toBeUndefined();

    const current = deferred<FileOutcome>();
    const { gate, deps } = setup([A, B], {
      processFile: (_c, mode) => (mode === "write" ? current.promise : Promise.resolve(ok)),
    });
    const run = gate.run("/s");
    await vi.waitFor(() => expect(writeCalls(deps)).toHaveLength(1));
    let waited = false;
    const waiting = gate.cancelAndWait().then(() => (waited = true));
    await Promise.resolve();
    expect(waited).toBe(false);
    current.resolve(ok);
    await waiting;
    expect(gate.isRunning()).toBe(false);
    expect(await run).toEqual({ status: "cancelled" });
  });

  test("phases: scanning, checking 1..n, backup, migrating 1..n, done", async () => {
    const { gate, phases } = setup([A, B], {
      createBackup: async (_r, c, onProgress) => {
        onProgress({ doneBytes: 5, totalBytes: 10 });
        return { status: "ok", zipPath: ZIP, included: c };
      },
    });
    await gate.run("/s");
    expect(phases).toEqual([
      { phase: "scanning" },
      { phase: "checking", index: 1, total: 2, current: "a.pdf" },
      { phase: "checking", index: 2, total: 2, current: "b.pdf" },
      { phase: "backup", doneBytes: 0, totalBytes: 0 },
      { phase: "backup", doneBytes: 5, totalBytes: 10 },
      { phase: "migrating", index: 1, total: 2, current: "a.pdf" },
      { phase: "migrating", index: 2, total: 2, current: "b.pdf" },
      { phase: "done", summary: { migrated: 2, zipName: "Markierungen-Backup 2026-11-16 10-00.zip" } },
    ]);
  });

  test("markMigrated failing does not turn a passed run into a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const markMigrated = async () => {
        throw new Error("EROFS");
      };
      const none = setup([], { markMigrated });
      expect(await none.gate.run("/s")).toEqual({ status: "passed", summary: null });
      const some = setup([A], { markMigrated });
      expect(await some.gate.run("/s")).toEqual({
        status: "passed",
        summary: { migrated: 1, zipName: "Markierungen-Backup 2026-11-16 10-00.zip" },
      });
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
