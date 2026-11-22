import { app, autoUpdater, dialog } from "electron";
import fs from "fs-extra";
import { glob } from "glob";
import path from "path";
import { z } from "zod";
import { resolveListedEntry } from "./sheetFiles";
import { migrateSetListsToV2 } from "./folderConfig";
import {
    type SetListsWrapper,
    setListsWrapperSchema,
    type SheetFile,
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

/** Folder picker; opens at `defaultPath` (the current sheet folder) when one is given. */
export async function openFolderDialog(defaultPath?: string) {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    ...(defaultPath ? { defaultPath } : {}),
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
  const matches = await glob("**/*" + searchTerm + "*.pdf", {
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
  opts: input<typeof loadFilesAndFolderInputSchema>,
) {
  const {
    input: { basePath, relativePath },
  } = opts;

  const folderPath = path.join(basePath, relativePath);
  const folderContent = await fs.readdir(folderPath, { withFileTypes: true });

  const filesAndFolders: SheetFile[] = [];
  for (const item of folderContent) {
    const resolved = await resolveListedEntry(folderPath, item);
    if (!resolved) continue;
    filesAndFolders.push({
      path: basePath,
      name: item.name,
      isFile: !resolved.isDirectory,
      isSearch: false,
    });
  }

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
  opts: input<typeof saveSetListsInputSchema>,
) {
  const {
    input: { setListsWrapper, basePath },
  } = opts;
  await fs.writeFile(
    path.join(basePath, ".set-lists.json"),
    JSON.stringify(setListsWrapper, null, 2),
  );
}
