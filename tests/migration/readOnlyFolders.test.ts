import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BulkMigration, type MigrationSummary } from "../../src/migration/bulkMigration";
import { ReadOnlyFolders } from "../../src/migration/readOnlyFolders";
import type { MigrationCandidate } from "../../src/migration/types";

/** chmod-based read-only tests do not work as root (root ignores permission bits). */
const isRoot = process.getuid?.() === 0;

let base: string;
let root: string;
let stateFile: string;
const denied = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code });

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "smv-readonly-"));
  root = path.join(base, "Noten");
  fs.mkdirSync(root);
  stateFile = path.join(base, "userData", "bulk-migration-read-only.json");
});
afterEach(() => {
  fs.chmodSync(root, 0o755);
  fs.rmSync(base, { recursive: true, force: true });
});

describe("ReadOnlyFolders", () => {
  it.skipIf(isRoot)("reports a read-only folder once, then stays silent, also after a restart", async () => {
    fs.chmodSync(root, 0o555);
    expect(await (await ReadOnlyFolders.load(stateFile)).check(root)).toBe("readOnlyReport");
    expect(await (await ReadOnlyFolders.load(stateFile)).check(root)).toBe("readOnlyKnown");
    const same = await ReadOnlyFolders.load(stateFile);
    expect(await same.check(root)).toBe("readOnlyKnown");
    expect(await same.check(root)).toBe("readOnlyKnown");
  });

  it.skipIf(isRoot)("writable again: forgets the folder; read-only once more is reported again", async () => {
    fs.chmodSync(root, 0o555);
    expect(await (await ReadOnlyFolders.load(stateFile)).check(root)).toBe("readOnlyReport");
    fs.chmodSync(root, 0o755);
    expect(await (await ReadOnlyFolders.load(stateFile)).check(root)).toBe("writable");
    expect(JSON.parse(fs.readFileSync(stateFile, "utf8"))).toEqual({ version: 1, folders: [] });
    fs.chmodSync(root, 0o555);
    expect(await (await ReadOnlyFolders.load(stateFile)).check(root)).toBe("readOnlyReport");
  });

  it.skipIf(isRoot)("remembers each folder on its own", async () => {
    const other = path.join(base, "Andere");
    fs.mkdirSync(other, { mode: 0o555 });
    fs.chmodSync(root, 0o555);
    try {
      const folders = await ReadOnlyFolders.load(stateFile);
      expect(await folders.check(root)).toBe("readOnlyReport");
      expect(await folders.check(other)).toBe("readOnlyReport");
      expect(await folders.check(root + path.sep)).toBe("readOnlyKnown");
    } finally {
      fs.chmodSync(other, 0o755);
    }
  });

  it("is case-insensitive on Windows", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
    Object.defineProperty(process, "platform", { value: "win32" });
    // The upper-case path does not exist on Linux: access() passes as on Windows, creating the probe is denied.
    const access = vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
    const open = vi.spyOn(fs.promises, "open").mockRejectedValue(denied("EPERM"));
    try {
      expect(await (await ReadOnlyFolders.load(stateFile)).check(root)).toBe("readOnlyReport");
      expect(await (await ReadOnlyFolders.load(stateFile)).check(root.toUpperCase())).toBe("readOnlyKnown");
    } finally {
      access.mockRestore();
      open.mockRestore();
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("a missing or broken state file is empty", async () => {
    const open = vi.spyOn(fs.promises, "open").mockRejectedValue(denied("EACCES"));
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, "{not json");
      expect(await (await ReadOnlyFolders.load(stateFile)).check(root)).toBe("readOnlyReport");
      fs.writeFileSync(stateFile, JSON.stringify({ version: 1, folders: [7, null] }));
      expect(await (await ReadOnlyFolders.load(stateFile)).check(root)).toBe("readOnlyReport");
    } finally {
      open.mockRestore();
    }
  });

  it("a state file that cannot be written still reports (and logs)", async () => {
    const open = vi.spyOn(fs.promises, "open").mockRejectedValue(denied("EACCES"));
    const writeFile = vi.spyOn(fs.promises, "writeFile").mockRejectedValue(denied("EACCES"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await (await ReadOnlyFolders.load(stateFile)).check(root)).toBe("readOnlyReport");
      expect(warn).toHaveBeenCalled();
    } finally {
      open.mockRestore();
      writeFile.mockRestore();
      warn.mockRestore();
    }
  });
});

describe.skipIf(isRoot)("bulk migration of a read-only sheet folder over several starts", () => {
  const candidate = (): MigrationCandidate => ({
    pdfPath: path.join(root, "a.pdf"),
    sidecarPath: path.join(root, ".a.pdf.data"),
    relativePath: "a.pdf",
  });

  /** One app start: a fresh ReadOnlyFolders from the state file, as main loads it. */
  async function start(): Promise<{ summary: MigrationSummary | null; backups: number; dialogs: number }> {
    const folders = await ReadOnlyFolders.load(stateFile);
    let backups = 0;
    let dialogs = 0;
    const bulk = new BulkMigration({
      findCandidates: async () => [candidate()],
      checkFolder: (folder) => folders.check(folder),
      createBackup: async (_root, c) => {
        backups++;
        return { status: "ok", zipPath: path.join(root, "x.zip"), included: c, excluded: [] };
      },
      cancelBackup: async () => {},
      migrateFile: async () => ({ kind: "migrated" }),
      recordSkip: async () => {},
      hasPending: () => false,
      onPhase: (p) => {
        if (p.phase !== "idle") dialogs++;
      },
    });
    return { summary: await bulk.run(root), backups, dialogs };
  }

  it("first start reports, the second is silent, writable again migrates", async () => {
    fs.chmodSync(root, 0o555);

    const first = await start();
    expect(first.summary).toMatchObject({ readOnlyFolder: true, migrated: 0 });
    expect(first.backups).toBe(0);
    expect(first.dialogs).toBe(1);

    const second = await start();
    expect(second.summary).toBeNull();
    expect(second.backups).toBe(0);
    expect(second.dialogs).toBe(0);

    fs.chmodSync(root, 0o755);
    const third = await start();
    expect(third.summary).toMatchObject({ readOnlyFolder: false, migrated: 1, backupError: null });
    expect(third.backups).toBe(1);
  });
});
