import { type SetList } from "../models/SetList";
import { type SheetFile } from "../models/SheetFile";
import { defineStore } from "pinia";

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
  },
});

export default useStore;
