import Vue from "vue";
import Vuex from "vuex";
import { getField, updateField } from "vuex-map-fields";

Vue.use(Vuex);

let sheetMusicFolder = localStorage.getItem("sheetMusicFolder");
sheetMusicFolder = sheetMusicFolder || "";

export default new Vuex.Store({
  state: {
    sheetMusicFolder: sheetMusicFolder,
    searchTerm: "",
    searchVisible: false,
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
  },
  actions: {},
  modules: {},
});
