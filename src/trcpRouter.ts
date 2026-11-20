import { initTRPC } from "@trpc/server";
import { app, autoUpdater } from "electron/main";
import { on } from "events";
import path from "path";
import superjson from "superjson";
import { z } from "zod";
import { askUnsavedMarkup, closeAppWindow, restartForUpdate, resumeExit } from "./exitGuard";
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
import { MigratedFolders } from "./migration/migratedFolders";
import { pdfPathSchema, saveMarkupInputSchema } from "./models/markup";
import { setListsWrapperSchema, type UpdateData } from "./models/types";
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

/** Sheet folders whose legacy markup is migrated; local (userData), never in the sheet folder. Loaded once. */
let migratedFolders: Promise<MigratedFolders> | null = null;
const loadMigratedFolders = () =>
  (migratedFolders ??= MigratedFolders.load(path.join(app.getPath("userData"), "markup-migrated-folders.json")));

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

  /** The migration gate for legacy `.data` files (src/store/bulkMigration.ts, src/migration/gate.ts). */
  isMarkupFolderMigrated: publicProcedure.input(absoluteFolderSchema).query(async ({ input }) => {
    // Test switch: the folder counts as migrated (nothing is stored), so the gate is skipped.
    if (process.env.SMV_DISABLE_BULK_MIGRATION === "1") return true;
    return (await loadMigratedFolders()).has(input);
  }),

  markMarkupFolderMigrated: publicProcedure.input(absoluteFolderSchema).mutation(async ({ input }) => {
    await (await loadMigratedFolders()).add(input);
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

  discardEmptyLegacySidecar: publicProcedure
    .input(pdfPathSchema)
    .mutation(({ input }) => discardEmptyLegacySidecar(input)),

  /** Closing with unsaved markup (see src/exitGuard.ts). */
  askUnsavedMarkup: publicProcedure
    .input(z.object({ files: z.array(z.string()), forExit: z.boolean() }))
    .mutation(({ input }) => askUnsavedMarkup(input.files, input.forExit)),
  resumeExit: publicProcedure.mutation(() => resumeExit()),
  /** The normal close path (with the close guard), e.g. "Schließen" in the migration gate's failure list. */
  closeApp: publicProcedure.mutation(() => closeAppWindow()),
});
