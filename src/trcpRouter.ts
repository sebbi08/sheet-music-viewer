import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import {
  setListsWrapperSchema,
} from "./models/types";
import { checkForUpdates, getAppVersion, loadFilesAndFolder, loadFilesAndFolderInputSchema, loadOverlayData, loadSetLists, openFolderDialog, quitAndInstallUpdates, saveOverlayData, saveOverlayDataInputSchema, saveSetLists, saveSetListsInputSchema, searchForSheet, searchForSheetParams, updateAvailableNotifier, updateDownloadedNotifier } from "./trcpLib";


const { router: createRouter, procedure: publicProcedure } = initTRPC.create({
  transformer: superjson,
});


export const trcpRouter = createRouter({
  getVersion: publicProcedure.query(getAppVersion),

  checkForUpdates: publicProcedure.query(checkForUpdates),

  onNewVersion: publicProcedure.subscription(updateAvailableNotifier),

  restartForUpdate: publicProcedure.mutation(quitAndInstallUpdates),

  onNewVersionDownloaded: publicProcedure.subscription(
    updateDownloadedNotifier
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
