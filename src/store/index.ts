import { type SetList } from "../models/SetList";
import { type SheetFile } from "../models/SheetFile";
import { defineStore } from "pinia";
import { client } from "../trcpClient";

let sheetMusicFolder = localStorage.getItem("sheetMusicFolder");
sheetMusicFolder = sheetMusicFolder || "";

const useStore = defineStore("app", {
  state: () => ({
    sheetMusicFolder: sheetMusicFolder,
    searchTerm: "",
    editMode: false,
    setLists: new Array<SetList>(),
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
      const setLists = await client.loadSetLists.query(this.sheetMusicFolder);
      this.setLists = setLists;
    },
    async saveSetLists() {
      await client.saveSetLists.query({
        basePath: this.sheetMusicFolder,
        setLists: this.setLists,
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
