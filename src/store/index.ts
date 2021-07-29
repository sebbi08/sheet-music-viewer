import Vue from "vue";
import Vuex from "vuex";
import { getField, updateField } from "vuex-map-fields";
Vue.use(Vuex);

let sheetMusicFolder = localStorage.getItem("sheetMusicFolder");
sheetMusicFolder = sheetMusicFolder || "";

export default new Vuex.Store({
  state: {
    sheetMusicFolder: sheetMusicFolder,
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
  },
  actions: {},
  modules: {},
});
