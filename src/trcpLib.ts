import { app, autoUpdater, dialog } from "electron";
import fs from "fs-extra";
import { glob } from "glob";
import path from "path";
import { z } from "zod";
import { resolveListedEntry } from "./sheetFiles";
import { FolderConfigUnreadableError, loadFolderConfig, updateFolderConfig } from "./folderConfig";
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
export type LoadSetListsResult =
  | { kind: "ok"; setLists: SetListsWrapper }
  | { kind: "unreadable"; file: string; message: string };

/**
 * The set lists of a sheet folder from its `.config.json` (spec 2026-11-22); a missing file or field gives
 * no set lists. An unreadable file is reported, never treated as empty. Never throws.
 */
export async function loadSetLists(folder: string): Promise<LoadSetListsResult> {
  const read = await loadFolderConfig(folder);
  if (read.kind === "unreadable") return read;
  const setLists = read.kind === "ok" ? read.config.setLists : undefined;
  return { kind: "ok", setLists: setLists ?? { version: 2, setLists: [] } };
}

export const saveSetListsInputSchema = z.object({
  setListsWrapper: setListsWrapperSchema,
  basePath: z.string(),
});

/**
 * Stores the set lists in the folder's `.config.json`; every other field stays. An unreadable file is never
 * overwritten. Never throws: a failure comes back with its message.
 */
export async function saveSetLists(input: {
  basePath: string;
  setListsWrapper: SetListsWrapper;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await updateFolderConfig(input.basePath, { setLists: input.setListsWrapper });
    return { ok: true };
  } catch (e) {
    console.warn(`Could not save the set lists in ${input.basePath}:`, e);
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: e instanceof FolderConfigUnreadableError ? `„${e.file}“ kann nicht gelesen werden: ${message}` : message,
    };
  }
}
