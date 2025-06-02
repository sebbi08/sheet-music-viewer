import { observable } from "@trpc/server/observable";
import { app, autoUpdater, dialog } from "electron";
import fs from "fs-extra";
import { glob } from "glob";
import path from "path";
import { z } from "zod";
import {
  SetList,
  SetListSheet,
  SetListsWrapper,
  setListsWrapperSchema,
  SetListV1,
  SheetFile,
  UpdateData,
} from "./models/types";

const isDevelopment = !app.isPackaged;

type input<T> = {
  input: T extends z.ZodTypeAny ? z.infer<T> : T;
};

export function getAppVersion() {
  return isDevelopment ? "development" : app.getVersion();
}
export function checkForUpdates() {
  if (!isDevelopment) {
    autoUpdater.checkForUpdates();
  }
}
export async function updateAvailableNotifier() {
  return observable<undefined>((emit) => {
    const handler = () => emit.next(undefined);
    autoUpdater.on("update-available", handler);

    return () => {
      autoUpdater.off("update-available", handler);
    };
  });
}

export function quitAndInstallUpdates() {
  autoUpdater.quitAndInstall();
}
export function updateDownloadedNotifier() {
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
}
export async function openFolderDialog() {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  return result.filePaths[0];
}

export const searchForSheetParams = z.object({
  basePath: z.string(),
  searchTerm: z.string(),
});

export async function searchForSheet(opts: input<typeof searchForSheetParams>) {
  const basePath = opts.input.basePath;
  const searchTerm = opts.input.searchTerm;
  const matches = await glob("**/*" + searchTerm + "*.*", {
    cwd: basePath,
    nocase: true,
    nodir: true,
  });
  // matches = matches.map((filepath) => filepath.split("/").join(path.sep));
  const filesAndFolders: SheetFile[] = matches.map((item) => {
    const filePath = item.includes(path.sep)
      ? path.sep + path.dirname(item)
      : "";

    return {
      path: basePath + filePath,
      name: path.basename(item),
      isFile: true,
      isSearch: true,
    };
  });
  return filesAndFolders;
}
export const loadFilesAndFolderInputSchema = z.object({
  basePath: z.string(),
  relativePath: z.string(),
});
export async function loadFilesAndFolder(
  opts: input<typeof loadFilesAndFolderInputSchema>
) {
  const {
    input: { basePath, relativePath },
  } = opts;

  const folderPath = path.join(basePath, relativePath);
  let folderContent = await fs.readdir(folderPath, { withFileTypes: true });

  folderContent = folderContent.filter((item) => !item.name.startsWith("."));

  const filesAndFolders: SheetFile[] = folderContent.map((item) => {
    return {
      path: basePath,
      name: item.name,
      isFile: item.isFile(),
      isSearch: false,
    };
  });

  return filesAndFolders;
}
export async function loadSetLists(opts: input<string>) {
  const basePath = opts.input;
  let setLists: SetListsWrapper;
  try {
    const setListJsonPath = path.join(basePath, ".set-lists.json");
    let setListsJson = (await fs.readFile(setListJsonPath)).toString();

    setListsJson = migrateSetListsToV2(setListsJson);

    setLists = setListsWrapperSchema.parse(JSON.parse(setListsJson));
  } catch (e) {
    console.log(e);
    setLists = { version: 2, setLists: [] };
  }
  return setLists;
}

export const saveSetListsInputSchema = z.object({
  setListsWrapper: setListsWrapperSchema,
  basePath: z.string(),
});
export async function saveSetLists(
  opts: input<typeof saveSetListsInputSchema>
) {
  const {
    input: { setListsWrapper, basePath },
  } = opts;
  await fs.writeFile(
    path.join(basePath, ".set-lists.json"),
    JSON.stringify(setListsWrapper, null, 2)
  );
}
export const saveOverlayDataInputSchema = z.object({
  data: z.string(),
  path: z.string(),
});

export async function saveOverlayData(
  opts: input<typeof saveOverlayDataInputSchema>
) {
  const sheetPath = opts.input.path;
  const overlayData = opts.input.data;
  const overlayDataPath = getOverlayDataFilePathFromSheetPath(sheetPath);
  try {
    await fs.writeFile(overlayDataPath, overlayData);
  } catch (e) {
    console.log("Error while saving:");
    console.log(e);
  }
}
export async function loadOverlayData(opts: input<string>) {
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
}

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
function migrateSetListsToV2(setListsJson: string): string {
  const unsaveParsedSetLists = JSON.parse(setListsJson);

  if (Array.isArray(unsaveParsedSetLists)) {
    const setListsV1 = unsaveParsedSetLists as SetListV1[];
    const setListsV2: SetListsWrapper = {
      version: 2,
      setLists: setListsV1.map<SetList>((setList) => {
        return {
          ...setList,
          sheets: setList.sheets.map<SetListSheet>(
            (sheet) => {
              return {
                ...sheet,
                path: sheet.path.split(sheet.path.charAt(0)).filter((v) => !!v),
              };
            }
          ),
        };
      }),
    };
    return JSON.stringify(setListsV2);
  } else {
    return setListsJson;
  }
}
