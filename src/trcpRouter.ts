import { initTRPC } from "@trpc/server";
import { autoUpdater } from "electron/main";
import { on } from "events";
import superjson from "superjson";
import { z } from "zod";
import { setListsWrapperSchema } from "./models/types";
import {
  checkForUpdates,
  getAppVersion,
  loadFilesAndFolder,
  loadFilesAndFolderInputSchema,
  loadOverlayData,
  loadSetLists,
  openFolderDialog,
  quitAndInstallUpdates,
  saveOverlayData,
  saveOverlayDataInputSchema,
  saveSetLists,
  saveSetListsInputSchema,
  searchForSheet,
  searchForSheetParams,
} from "./trcpLib";

const { router: createRouter, procedure: publicProcedure } = initTRPC.create({
  transformer: superjson,
});

export const trcpRouter = createRouter({
  getVersion: publicProcedure.query(getAppVersion),

  checkForUpdates: publicProcedure.query(checkForUpdates),

  onNewVersion: publicProcedure.subscription(
    async function* updateAvailableNotifier() {
      const iterable = on(autoUpdater, "update-available");

      for await (const _event of iterable) {
        yield undefined;
      }
    },
  ),

  restartForUpdate: publicProcedure.mutation(quitAndInstallUpdates),

  onNewVersionDownloaded: publicProcedure.subscription(
    async function* updateDownloadedNotifier(opts) {
      // 1. Create an async iterable for the "update-downloaded" event.
      // Passing opts.signal ensures the listener is removed if the client disconnects.
      const iterable = on(autoUpdater, "update-downloaded", {
        signal: opts.signal,
      });

      for await (const [releaseNotes, releaseName, releaseDate] of iterable) {
        // 2. Yield the data in the format your client expects.
        // 'on' yields an array of arguments from the event callback.
        yield {
          releaseDate,
          releaseName,
          releaseNotes,
        };
      }
    },
  ),

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
  saveOverlayData: publicProcedure
    .input(saveOverlayDataInputSchema)
    .query(saveOverlayData),

  loadOverlayData: publicProcedure.input(z.string()).query(loadOverlayData),
});
