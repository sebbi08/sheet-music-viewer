import { defineStore } from "pinia";
import type { SetListsWrapper, SheetFile } from "../models/types";
import { client } from "../trcpClient";
import { useNotices } from "./notices";
import {
  setListsChangedText,
  setListsNewerVersionText,
  setListsSaveFailedText,
  setListsUnreadableText,
} from "./setListTexts";

const noSetLists = (): SetListsWrapper => ({ version: 2, setLists: [] });

/**
 * The set lists as last loaded from or saved to `setListsFolder` (JSON), so that only real changes are
 * saved; `null` when none are loaded.
 */
let setListsSnapshot: string | null = null;

/**
 * The set lists the file in `setListsFolder` held at the last load or save (JSON; `"null"`: none), sent as
 * the base of a save, so a save never overwrites set lists another PC wrote in the meantime.
 */
let setListsBase = "null";

/** Loads and saves of the set lists run one after another, so a load never overtakes an earlier save. */
let setListsQueue: Promise<unknown> = Promise.resolve();
function queuedSetListsTask(task: () => Promise<void>): Promise<void> {
  const next = setListsQueue.then(task);
  setListsQueue = next.catch(() => undefined);
  return next;
}

type SaveSetListsResult = Awaited<ReturnType<typeof client.saveSetLists.mutate>>;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

let sheetMusicFolder = localStorage.getItem("sheetMusicFolder");
sheetMusicFolder = sheetMusicFolder || "";

const useStore = defineStore("app", {
  state: () => ({
    sheetMusicFolder: sheetMusicFolder,
    searchTerm: "",
    editMode: false,
    /**
     * The open sheet's markup could not be loaded (editing would overwrite it) or cannot be saved into its
     * PDF. Set by the mounted SheetViewer only.
     */
    markupEditDisabled: false,
    /** The divider mode of the open sheet (spec 2026-11-23): drag the divider of a page turn. */
    dividerMode: false,
    /** Set by the mounted SheetViewer: all pages rendered and at least 2 pages. */
    dividerModeAvailable: false,
    setListsWrapper: noSetLists(),
    /**
     * The folder the set lists in `setListsWrapper` were loaded from ("" = none loaded). Set lists are saved
     * only into this folder and only while it is the current sheet folder.
     */
    setListsFolder: "",
    /** The notice when the current folder's set lists could not be loaded; nothing is saved meanwhile. */
    setListsError: null as string | null,
    setListEditMode: false,
    filesAndFolder: new Array<SheetFile>(),
    searchResults: new Array<SheetFile>(),
    sortSetListEnabled: false,
    setListDeletionMode: false,
    showEditSetListDialog: false,
  }),
  getters: {},
  actions: {
    /**
     * A sheet folder was chosen: remember it and load its set lists. Empty (selection cancelled): nothing.
     * The set lists of the previous folder are dropped, never saved into the new one.
     */
    setSheetMusicFolder(folder: string) {
      if (!folder) return;
      this.sheetMusicFolder = folder;
      localStorage.setItem("sheetMusicFolder", folder);
      setListsSnapshot = null;
      setListsBase = "null";
      this.setListsFolder = "";
      this.setListsError = null;
      this.setListsWrapper = noSetLists();
      void this.loadSetLists();
    },
    toggleEditMode: function () {
      this.editMode = !this.editMode;
    },
    toggleDividerMode: function () {
      this.dividerMode = !this.dividerMode;
    },
    toggleSetListDeletionMode: function () {
      this.setListDeletionMode = !this.setListDeletionMode;
    },
    toggleSetListSortMode: function () {
      this.sortSetListEnabled = !this.sortSetListEnabled;
    },
    async loadFiles(basePath: string, relativePath: string) {
      const filesAndFolder = await client.loadFilesForFolder.query({
        basePath,
        relativePath,
      });
      this.filesAndFolder = filesAndFolder;
    },
    /**
     * Loads the current folder's set lists from its `.config.json`. An unreadable file empties the set lists
     * in memory, shows the notice and blocks saving until a load succeeds. A result for a folder that is no
     * longer the current one is dropped.
     */
    async loadSetLists() {
      if (!this.sheetMusicFolder) return;
      await queuedSetListsTask(() => this.loadSetListsNow());
    },
    /** The body of `loadSetLists`, for use inside a queued set list task. */
    async loadSetListsNow() {
      const folder = this.sheetMusicFolder;
      if (!folder) return;
      let result;
      try {
        result = await client.loadSetLists.query(folder);
      } catch (error) {
        console.error("Error loading set lists:", error);
        return;
      }
      if (this.sheetMusicFolder !== folder) return;
      if (result.kind === "ok") {
        const setLists = result.setLists ?? noSetLists();
        setListsSnapshot = JSON.stringify(setLists);
        setListsBase = JSON.stringify(result.setLists);
        this.setListsFolder = folder;
        this.setListsError = null;
        this.setListsWrapper = setLists;
      } else {
        setListsSnapshot = null;
        setListsBase = "null";
        this.setListsFolder = "";
        this.setListsError = result.newerVersion
          ? setListsNewerVersionText
          : setListsUnreadableText(result.file, result.message);
        this.setListsWrapper = noSetLists();
        useNotices().show(this.setListsError);
      }
    },
    /**
     * Saves the set lists into the folder they were loaded from, only if that is the current folder, the
     * load succeeded and they differ from what was last loaded or saved. A failure shows a notice. If the
     * file holds other set lists than the last load or save (another PC changed them), nothing is written:
     * the set lists are loaded again and a notice asks to repeat the last change.
     */
    async saveSetLists() {
      await queuedSetListsTask(async () => {
        const folder = this.sheetMusicFolder;
        if (!folder || this.setListsFolder !== folder || this.setListsError !== null) return;
        const text = JSON.stringify(this.setListsWrapper);
        if (text === setListsSnapshot) return;
        let result: SaveSetListsResult;
        try {
          result = await client.saveSetLists.mutate({
            basePath: folder,
            setListsWrapper: JSON.parse(text),
            base: JSON.parse(setListsBase),
          });
        } catch (error) {
          console.error("Error saving set lists:", error);
          result = { ok: false, reason: "failed", message: errorMessage(error) };
        }
        if (!result.ok) {
          if (result.reason === "changed") {
            useNotices().show(setListsChangedText);
            await this.loadSetListsNow();
          } else {
            useNotices().show(setListsSaveFailedText(result.message));
          }
          return;
        }
        if (this.setListsFolder === folder) {
          setListsSnapshot = text;
          setListsBase = text;
        }
      });
    },
    async searchForFiles(searchTerm: string) {
      const searchResults = await client.search.query({
        basePath: this.sheetMusicFolder,
        searchTerm: searchTerm,
      });
      this.searchResults = searchResults;
    },
  },
});

export default useStore;
