import Vue from "vue";
import Vuex from "vuex";
import { getField, updateField } from "vuex-map-fields";
import { SetList } from "@/models/SetList";
import { SheetFile } from "@/models/SheetFile";

Vue.use(Vuex);

let sheetMusicFolder = localStorage.getItem("sheetMusicFolder");
sheetMusicFolder = sheetMusicFolder || "";

export default new Vuex.Store({
  state: {
    sheetMusicFolder: sheetMusicFolder,
    searchTerm: "",
    searchVisible: false,
    editMode: false,
    setLists: new Array<SetList>(),
    showEditSetListDialog: false,
    filesAndFolder: new Array<SheetFile>(),
    searchResults: new Array<SheetFile>(),
    sortSetListEnabled: false,
    setListDeletionMode: false,
  },
  getters: {
    // Add the `getField` getter to the
    // `getters` of your Vuex store instance.
    getField,
  },
  mutations: {
    // Add the `updateField` mutation to the
    // `mutations` of your Vuex store instance.
    updateField,
    clearSearch: function (state) {
      state.searchTerm = "";
      state.searchVisible = false;
    },
    setVisible: function (state, payload) {
      state.searchVisible = payload;
    },
    toggleEditMode: function (state) {
      state.editMode = !state.editMode;
    },
    startSetListEditMode: function (state) {
      state.showEditSetListDialog = true;
    },
    toggleSetListDeletionMode: function (state) {
      state.setListDeletionMode = !state.setListDeletionMode;
    },
    toggleSetListSortMode: function (state) {
      state.sortSetListEnabled = !state.sortSetListEnabled;
    },
  },
  actions: {},
  modules: {},
});
