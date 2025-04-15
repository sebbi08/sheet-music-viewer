import { initTRPC } from "@trpc/server";
import { app, dialog, autoUpdater } from "electron";
import path from "path";
import fs from "fs-extra";
import { z } from "zod";
import type { SheetFile, UpdateData } from "./models/types";
import { setListSchema } from "./models/types";
import { glob } from "glob";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";

const isDevelopment = !app.isPackaged;
const { router: createRouter, procedure: publicProcedure } = initTRPC.create({
  transformer: superjson,
});

export const trcpRouter = createRouter({
  getVersion: publicProcedure.query(() => {
    return isDevelopment ? "development" : app.getVersion();
  }),

  checkForUpdates: publicProcedure.query(() => {
    autoUpdater.checkForUpdates();
  }),

  onNewVersion: publicProcedure.subscription(async function () {
    return observable<undefined>((emit) => {
      const handler = () => emit.next(undefined);
      autoUpdater.on("update-available", handler);

      return () => {
        autoUpdater.off("update-available", handler);
      };
    });
  }),

  restartForUpdate: publicProcedure.mutation(() => {
    autoUpdater.quitAndInstall();
  }),

  onNewVersionDownloaded: publicProcedure.subscription(() => {
    return observable<UpdateData>((emit) => {
      const handler: (
        event: Event,
        releaseNotes: string,
        releaseName: string,
        releaseDate: Date,
        updateURL: string
      ) => void = (event, releaseNotes, releaseName, releaseDate) => {
        return emit.next({
          releaseDate,
          releaseName,
          releaseNotes,
        });
      };
      autoUpdater.on("update-downloaded", handler);

      return () => {
        autoUpdater.off("update-downloaded", handler);
      };
    });
  }),

  selectFolder: publicProcedure.query(async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.filePaths[0];
  }),

  search: publicProcedure
    .input(
      z.object({
        basePath: z.string(),
        searchTerm: z.string(),
      })
    )
    .query(async (opts) => {
      const basePath = opts.input.basePath;
      const searchTerm = opts.input.searchTerm;
      const matches = await glob("**/*" + searchTerm + "*.*", {
        cwd: basePath,
        nocase: true,
        nodir: true,
      });
      // matches = matches.map((filepath) => filepath.split("/").join(path.sep));

      const filesAndFolders: SheetFile[] = matches.map((item) => {
        const filePath = item.includes("/") ? "/" + path.dirname(item) : "";

        return {
          path: basePath + filePath,
          name: path.basename(item),
          isFile: true,
          isSearch: true,
        };
      });
      return filesAndFolders;
    }),

  loadFilesForFolder: publicProcedure
    .input(
      z.object({
        basePath: z.string(),
        relativePath: z.string(),
      })
    )
    .query(async (opts) => {
      const {
        input: { basePath, relativePath },
      } = opts;

      const folderPath = path.join(basePath, relativePath);
      let folderContent = await fs.readdir(folderPath, { withFileTypes: true });

      folderContent = folderContent.filter(
        (item) => !item.name.startsWith(".")
      );

      const filesAndFolders: SheetFile[] = folderContent.map((item) => {
        return {
          path: basePath,
          name: item.name,
          isFile: item.isFile(),
          isSearch: false,
        };
      });

      return filesAndFolders;
    }),

  loadSetLists: publicProcedure
    .input(z.string())
    .output(z.array(setListSchema))
    .query(async (opts) => {
      const basePath = opts.input;
      let setListsJson: string;
      try {
        const setListJsonPath = path.join(basePath, ".set-lists.json");
        setListsJson = (await fs.readFile(setListJsonPath)).toString();
      } catch (e) {
        console.log(e);
        setListsJson = "[]";
      }
      return z.array(setListSchema).parse(setListsJson);
    }),

  saveSetLists: publicProcedure
    .input(
      z.object({
        setLists: z.array(setListSchema),
        basePath: z.string(),
      })
    )
    .query(async (opts) => {
      const {
        input: { setLists, basePath },
      } = opts;
      await fs.writeFile(
        path.join(basePath, ".set-lists.json"),
        JSON.stringify(setLists)
      );
    }),
  saveOverlayData: publicProcedure
    .input(z.object({ data: z.string(), path: z.string() }))
    .query(async (opts) => {
      const sheetPath = opts.input.path;
      const overlayData = opts.input.data;
      const overlayDataPath = getOverlayDataFilePathFromSheetPath(sheetPath);
      try {
        await fs.writeFile(overlayDataPath, overlayData);
      } catch (e) {
        console.log("Error while saving:");
        console.log(e);
      }
    }),

  loadOverlayData: publicProcedure.input(z.string()).query(async (opts) => {
    const sheetPath = opts.input;
    const overlayDataPath = getOverlayDataFilePathFromSheetPath(sheetPath);
    let overlayData;
    try {
      overlayData = (await fs.readFile(overlayDataPath)).toString();
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code !== "ENOENT") {
        console.log("Error while loading data file");
        console.log(e);
      }
      overlayData = "";
    }
    return overlayData;
  }),
});

function getOverlayDataFilePathFromSheetPath(sheetPath: string): string {
  let overlayDataPath = path.basename(sheetPath);
  overlayDataPath =
    "." + overlayDataPath.replace(path.extname(overlayDataPath), ".data");
  overlayDataPath = sheetPath.replace(
    path.basename(sheetPath),
    overlayDataPath
  );

  return overlayDataPath;
}
