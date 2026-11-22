import { initTRPC } from "@trpc/server";
import { app, autoUpdater } from "electron/main";
import { on } from "events";
import fs from "node:fs";
import path from "path";
import superjson from "superjson";
import { z } from "zod";
import { askUnsavedMarkup, closeAppWindow, restartForUpdate, resumeExit } from "./exitGuard";
import { loadFolderConfig, updateFolderConfig } from "./folderConfig";
import {
    BACKUP_PROGRESS_EVENT,
    backupProgress,
    cancelMigrationBackup,
    runMigrationBackup,
    type BackupProgress,
} from "./migration/backupProgress";
import { scanMigrationCandidates } from "./migration/candidates";
import {
    absoluteFolderSchema,
    migrateMarkupSidecarInputSchema,
    migrationBackupInputSchema,
    readMigrationSourceInputSchema,
} from "./migration/ipcInput";
import type { MigratedState } from "./migration/types";
import { pdfPathSchema, saveMarkupInputSchema } from "./models/markup";
import { type UpdateData } from "./models/types";
import { readSidecarContent } from "./pdfMarkup/legacySidecar";
import {
    checkMarkupWritable,
    discardEmptyLegacySidecar,
    loadMarkupFromFile,
    migrateSidecarToFile,
    saveMarkupToFile,
} from "./pdfMarkup/markupFile";
import {
    checkForUpdates,
    getAppVersion,
    loadFilesAndFolder,
    loadFilesAndFolderInputSchema,
    loadSetLists,
    openFolderDialog,
    saveSetLists,
    saveSetListsInputSchema,
    searchForSheet,
    searchForSheetParams,
} from "./trcpLib";

const { router: createRouter, procedure: publicProcedure } = initTRPC.create({
  transformer: superjson,
});

/**
 * The migration mark used to be kept per path in the profile; it now lives in the sheet folder's
 * `.config.json`. The old file is deleted once, best effort, and its entries are not taken over: the
 * path-based mark is what let a folder copied again at the same path count as migrated.
 */
void fs.promises
  .rm(path.join(app.getPath("userData"), "markup-migrated-folders.json"), { force: true })
  .catch((e) => console.warn("Could not delete markup-migrated-folders.json", e));

export const trcpRouter = createRouter({
  getVersion: publicProcedure.query(getAppVersion),

  checkForUpdates: publicProcedure.query(checkForUpdates),

  onNewVersion: publicProcedure.subscription(async function* (opts) {
    const iterable = on(autoUpdater, "update-available", {
      signal: opts.signal,
    });

    for await (const _event of iterable) {
      yield undefined;
    }
  }),

  /** Through the exit guard, so a blocked restart is continued as an update restart (src/exitGuard.ts). */
  restartForUpdate: publicProcedure.mutation(() => restartForUpdate()),

  onNewVersionDownloaded: publicProcedure.subscription(async function* (opts) {
    // 1. Create an async iterable for the "update-downloaded" event.
    // Passing opts.signal ensures the listener is removed if the client disconnects.
    const iterable = on(autoUpdater, "update-downloaded", {
      signal: opts.signal,
    });

    for await (const [
      _event,
      releaseNotes,
      releaseName,
      _releaseDate,
      _updateURL,
    ] of iterable) {
      // 2. Yield the data in the format your client expects.
      // 'on' yields an array of arguments from the event callback.
      yield {
        releaseName,
        releaseNotes,
      } as UpdateData;
    }
  }),

  selectFolder: publicProcedure
    .input(z.string().optional())
    .query(({ input }) => openFolderDialog(input)),

  search: publicProcedure.input(searchForSheetParams).query(searchForSheet),

  loadFilesForFolder: publicProcedure
    .input(loadFilesAndFolderInputSchema)
    .query(loadFilesAndFolder),

  /** Set lists of a sheet folder, from its `.config.json` (src/folderConfig.ts). */
  loadSetLists: publicProcedure
    .input(z.string())
    .query(({ input }) => loadSetLists(input)),

  saveSetLists: publicProcedure
    .input(saveSetListsInputSchema)
    .mutation(({ input }) => saveSetLists(input)),

  loadMarkup: publicProcedure.input(pdfPathSchema).query(({ input }) => loadMarkupFromFile(input)),

  saveMarkup: publicProcedure
    .input(saveMarkupInputSchema)
    .mutation(({ input }) => saveMarkupToFile(input)),

  /**
   * The migration gate for legacy `.data` files (src/store/bulkMigration.ts, src/migration/gate.ts).
   * Migrated: the sheet folder's `.config.json` is readable and holds `markupMigrated`.
   */
  isMarkupFolderMigrated: publicProcedure.input(absoluteFolderSchema).query(async ({ input }): Promise<MigratedState> => {
    // Test switch, only in tests (IS_TEST): the folder counts as migrated (nothing is read or written), so
    // the gate is skipped and legacy `.data` files are ignored.
    if (process.env.IS_TEST === "1" && process.env.SMV_DISABLE_BULK_MIGRATION === "1") return "migrated";
    const read = await loadFolderConfig(input);
    if (read.kind === "unreadable") return { unreadable: { file: read.file, message: read.message } };
    return read.kind === "ok" && read.config.markupMigrated !== undefined ? "migrated" : "notMigrated";
  }),

  markMarkupFolderMigrated: publicProcedure.input(absoluteFolderSchema).mutation(async ({ input }) => {
    await updateFolderConfig(input, { markupMigrated: { at: new Date().toISOString() } });
  }),

  scanMigrationCandidates: publicProcedure.input(absoluteFolderSchema).query(({ input }) => scanMigrationCandidates(input)),

  /** Pass 1 reads through this: the sidecar and why the PDF cannot take markup. Writes nothing but the probe. */
  readMigrationSource: publicProcedure.input(readMigrationSourceInputSchema).query(async ({ input }) => ({
    sidecar: await readSidecarContent(input.candidate.pdfPath),
    writeBlock: await checkMarkupWritable(input.candidate.pdfPath),
  })),

  migrateMarkupSidecar: publicProcedure
    .input(migrateMarkupSidecarInputSchema)
    .mutation(({ input }) =>
      migrateSidecarToFile({ path: input.candidate.pdfPath, pages: input.pages, dryRun: input.dryRun }),
    ),

  createMigrationBackup: publicProcedure
    .input(migrationBackupInputSchema)
    .mutation(({ input }) => runMigrationBackup(input.root, input.candidates)),

  cancelMigrationBackup: publicProcedure.mutation(() => cancelMigrationBackup()),

  onMigrationBackupProgress: publicProcedure.subscription(async function* (opts) {
    for await (const [progress] of on(backupProgress, BACKUP_PROGRESS_EVENT, { signal: opts.signal })) {
      yield progress as BackupProgress;
    }
  }),

  /** Pass 2 for an empty sidecar; the candidate is checked against the folder like in the calls above. */
  discardEmptyLegacySidecar: publicProcedure
    .input(readMigrationSourceInputSchema)
    .mutation(({ input }) => discardEmptyLegacySidecar(input.candidate.pdfPath)),

  /** Closing with unsaved markup (see src/exitGuard.ts). */
  askUnsavedMarkup: publicProcedure
    .input(z.object({ files: z.array(z.string()), forExit: z.boolean() }))
    .mutation(({ input }) => askUnsavedMarkup(input.files, input.forExit)),
  resumeExit: publicProcedure.mutation(() => resumeExit()),
  /** The normal close path (with the close guard), e.g. "Schließen" in the migration gate's failure list. */
  closeApp: publicProcedure.mutation(() => closeAppWindow()),
});
