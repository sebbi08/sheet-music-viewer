import { app, autoUpdater, dialog } from "electron";
import fs from "fs-extra";
import { glob } from "glob";
import path from "path";
import { z } from "zod";
import { absoluteFolderSchema, isInsideFolder } from "./migration/ipcInput";
import { pdfPathSchema } from "./models/markup";
import { MAX_DIVIDER, MIN_DIVIDER, type PageDividers } from "./pageDivider";
import { resolveListedEntry } from "./sheetFiles";
import {
  FolderConfigChangedError,
  FolderConfigUnreadableError,
  loadFolderConfig,
  sheetKey,
  updateFolderConfig,
} from "./folderConfig";
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
  /** `setLists` null: the file has none (missing file or field). */
  | { kind: "ok"; setLists: SetListsWrapper | null }
  /** `newerVersion`: written by a newer version of the app. */
  | { kind: "unreadable"; file: string; message: string; newerVersion?: true };

/**
 * The set lists of a sheet folder from its `.config.json` (spec 2026-11-22); `null` when the file has none.
 * An unreadable file or an unreachable folder is reported, never treated as empty. Never throws.
 */
export async function loadSetLists(folder: string): Promise<LoadSetListsResult> {
  const read = await loadFolderConfig(folder);
  if (read.kind === "unreadable") return read;
  return { kind: "ok", setLists: (read.kind === "ok" ? read.config.setLists : undefined) ?? null };
}

export const saveSetListsInputSchema = z.object({
  setListsWrapper: setListsWrapperSchema,
  /** The set lists the renderer last loaded or saved for this folder (`null`: the file had none). */
  base: setListsWrapperSchema.nullable(),
  basePath: absoluteFolderSchema,
});

export type SaveSetListsResult =
  | { ok: true }
  /** The set lists on disk are no longer `base` (another PC changed them); nothing was written. */
  | { ok: false; reason: "changed" }
  | { ok: false; reason: "failed"; message: string };

/**
 * Stores the set lists in the folder's `.config.json`; every other field stays. Writes only while the set
 * lists on disk are still `base`. An unreadable file is never overwritten. Never throws: a failure comes
 * back with its reason.
 */
export async function saveSetLists(input: {
  basePath: string;
  setListsWrapper: SetListsWrapper;
  base: SetListsWrapper | null;
}): Promise<SaveSetListsResult> {
  try {
    await updateFolderConfig(input.basePath, { setLists: input.setListsWrapper }, { expectedSetLists: input.base });
    return { ok: true };
  } catch (e) {
    if (e instanceof FolderConfigChangedError) return { ok: false, reason: "changed" };
    console.warn(`Could not save the set lists in ${input.basePath}:`, e);
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: "failed",
      message: e instanceof FolderConfigUnreadableError ? `„${e.file}“ kann nicht gelesen werden: ${message}` : message,
    };
  }
}

/** A sheet outside the folder is no input error: it has no dividers (`kind: "outside"`). */
export const pageDividersInputSchema = z.object({ folder: absoluteFolderSchema, pdfPath: pdfPathSchema });

export const savePageDividerInputSchema = z
  .object({
    folder: absoluteFolderSchema,
    pdfPath: pdfPathSchema,
    /** The page left of the turn (`page` -> `page + 1`). */
    page: z.number().int().min(1),
    /** `null` removes the divider. */
    ratio: z.number().min(MIN_DIVIDER).max(MAX_DIVIDER).nullable(),
  })
  .refine(({ folder, pdfPath }) => isInsideFolder(folder, pdfPath), { message: "outside the sheet folder" });

export type LoadPageDividersResult =
  | { kind: "ok"; dividers: PageDividers }
  | { kind: "unreadable"; file: string; message: string; newerVersion?: true }
  /** The sheet is not below the sheet folder: no dividers, no divider mode (the file is not read). */
  | { kind: "outside" };

/**
 * The page dividers of one sheet from the folder's `.config.json` (spec 2026-11-23); values as stored, only
 * keys that are whole pages >= 1 are taken. An unreadable file is reported, never treated as empty. Never throws.
 */
export async function loadPageDividers(input: z.infer<typeof pageDividersInputSchema>): Promise<LoadPageDividersResult> {
  try {
    const key = sheetKey(input.folder, input.pdfPath);
    if (key === null) return { kind: "outside" };
    const read = await loadFolderConfig(input.folder);
    if (read.kind === "unreadable") return read;
    const stored = (read.kind === "ok" ? read.config.sheets?.[key]?.pageDividers : undefined) ?? {};
    const dividers: PageDividers = {};
    for (const [page, ratio] of Object.entries(stored)) {
      if (/^[1-9]\d*$/.test(page)) dividers[Number(page)] = ratio;
    }
    return { kind: "ok", dividers };
  } catch (e) {
    return { kind: "unreadable", file: ".config.json", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Sets (`ratio` number) or removes (`ratio` null) one divider in the folder's `.config.json`. Never throws. */
export async function savePageDivider(
  input: z.infer<typeof savePageDividerInputSchema>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const sheet = sheetKey(input.folder, input.pdfPath);
    if (sheet === null) return { ok: false, message: "Das Blatt liegt nicht im Notenordner." };
    await updateFolderConfig(input.folder, { pageDivider: { sheet, page: input.page, ratio: input.ratio } });
    return { ok: true };
  } catch (e) {
    console.warn(`Could not save the page divider in ${input.folder}:`, e);
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: e instanceof FolderConfigUnreadableError ? `„${e.file}“ kann nicht gelesen werden: ${message}` : message,
    };
  }
}
