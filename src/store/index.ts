import { defineStore } from "pinia";
import { SetListsWrapper, SheetFile } from "../models/types";
import { client } from "../trcpClient";

let sheetMusicFolder = localStorage.getItem("sheetMusicFolder");
sheetMusicFolder = sheetMusicFolder || "";

const useStore = defineStore("app", {
  state: () => ({
    sheetMusicFolder: sheetMusicFolder,
    searchTerm: "",
    editMode: false,
    setListsWrapper: {} as SetListsWrapper,
    setListEditMode: false,
    filesAndFolder: new Array<SheetFile>(),
    searchResults: new Array<SheetFile>(),
    sortSetListEnabled: false,
    setListDeletionMode: false,
    showEditSetListDialog: false,
  }),
  getters: {},
  actions: {
    toggleEditMode: function () {
      this.editMode = !this.editMode;
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
    async loadSetLists() {
      if (!this.sheetMusicFolder) {
        return;
      }
      const setListsWrapper = await client.loadSetLists.query(
        this.sheetMusicFolder
      );
      this.setListsWrapper = setListsWrapper;
    },
    async saveSetLists() {
      if (!this.sheetMusicFolder) {
        return;
      }
      try {
        await client.saveSetLists.query({
          basePath: this.sheetMusicFolder,
          setListsWrapper: this.setListsWrapper,
        });
      } catch (error) {
        console.error("Error saving set lists:", error);
      }
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
