import { initTRPC } from "@trpc/server";
import { app, autoUpdater } from "electron/main";
import { on } from "events";
import path from "path";
import superjson from "superjson";
import { z } from "zod";
import { askUnsavedMarkup, restartForUpdate, resumeExit } from "./exitGuard";
import {
    BACKUP_PROGRESS_EVENT,
    backupProgress,
    cancelMigrationBackup,
    runMigrationBackup,
    type BackupProgress,
} from "./migration/backupProgress";
import { findMigrationCandidates } from "./migration/candidates";
import {
    absoluteFolderSchema,
    migrationBackupInputSchema,
    recordMigrationSkipInputSchema,
} from "./migration/ipcInput";
import { SkipList } from "./migration/skipList";
import { pdfPathSchema, saveMarkupInputSchema } from "./models/markup";
import { setListsWrapperSchema, type UpdateData } from "./models/types";
import { discardEmptyLegacySidecar, loadMarkupFromFile, saveMarkupToFile } from "./pdfMarkup/markupFile";
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

/** Files that failed the bulk migration permanently; local, never in the sheet folder. */
let skipList: Promise<SkipList> | null = null;
const loadSkipList = () =>
  (skipList ??= SkipList.load(path.join(app.getPath("userData"), "bulk-migration-skips.json")));

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

  selectFolder: publicProcedure.query(openFolderDialog),

  search: publicProcedure.input(searchForSheetParams).query(searchForSheet),

  loadFilesForFolder: publicProcedure
    .input(loadFilesAndFolderInputSchema)
    .query(loadFilesAndFolder),

  loadSetLists: publicProcedure
    .input(z.string())
    .output(setListsWrapperSchema)
    .query(loadSetLists),

  saveSetLists: publicProcedure
    .input(saveSetListsInputSchema)
    .query(saveSetLists),

  loadMarkup: publicProcedure.input(pdfPathSchema).query(({ input }) => loadMarkupFromFile(input)),

  saveMarkup: publicProcedure
    .input(saveMarkupInputSchema)
    .mutation(({ input }) => saveMarkupToFile(input)),

  /** Bulk migration of legacy `.data` files (src/store/bulkMigration.ts). */
  findMigrationCandidates: publicProcedure.input(absoluteFolderSchema).query(async ({ input }) => {
    // Test switch: e2e tests of the open path keep their `.data` files.
    if (process.env.SMV_DISABLE_BULK_MIGRATION === "1") return [];
    return findMigrationCandidates(input, await loadSkipList());
  }),

  createMigrationBackup: publicProcedure
    .input(migrationBackupInputSchema)
    .mutation(({ input }) => runMigrationBackup(input.root, input.candidates)),

  cancelMigrationBackup: publicProcedure.mutation(() => cancelMigrationBackup()),

  onMigrationBackupProgress: publicProcedure.subscription(async function* (opts) {
    for await (const [progress] of on(backupProgress, BACKUP_PROGRESS_EVENT, { signal: opts.signal })) {
      yield progress as BackupProgress;
    }
  }),

  recordMigrationSkip: publicProcedure
    .input(recordMigrationSkipInputSchema)
    .mutation(async ({ input }) => (await loadSkipList()).record(input.candidate, input.reason)),

  discardEmptyLegacySidecar: publicProcedure
    .input(pdfPathSchema)
    .mutation(({ input }) => discardEmptyLegacySidecar(input)),

  /** Closing with unsaved markup (see src/exitGuard.ts). */
  askUnsavedMarkup: publicProcedure
    .input(z.object({ files: z.array(z.string()), forExit: z.boolean() }))
    .mutation(({ input }) => askUnsavedMarkup(input.files, input.forExit)),
  resumeExit: publicProcedure.mutation(() => resumeExit()),
});
