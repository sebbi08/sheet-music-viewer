<template>
  <v-app>
    <v-app-bar app dark dense v-bind:color="editMode ? 'red' : 'primary'">
      <v-btn v-if="showBackButton" icon @click="onNavBack">
        <v-icon>mdi-arrow-left</v-icon>
      </v-btn>
      <div>Sheet music viewer : {{ appVersion }}</div>
      <v-spacer></v-spacer>
      <div :class="searchVisible ? 'searchVisible' : ''" class="searchWrapper">
        <v-text-field
          ref="searchWrapper"
          v-model="searchTerm"
          hide-details="auto"
          label=""
        ></v-text-field>
      </div>
      <v-btn
        v-if="$route.name === sheetSelectionRouteName"
        dark
        icon
        @click="showSearch"
      >
        <v-icon>mdi-magnify</v-icon>
      </v-btn>
      <v-btn
        v-if="$route.name === sheetViewerRouterName"
        dark
        icon
        @click="onSwitchEditMode"
      >
        <v-icon>{{ editMode ? "mdi-close" : "mdi-pencil" }}</v-icon>
      </v-btn>
      <v-btn
        v-if="$route.name === setListRouteName && !setListEditMode"
        dark
        icon
        @click="startSetListEditMode"
      >
        <v-icon>mdi-pencil</v-icon>
      </v-btn>
      <v-dialog
        v-if="showSettingsButton"
        v-model="dialog"
        max-width="320"
        persistent
      >
        <template v-slot:activator="{ on, attrs }">
          <v-btn dark icon v-bind="attrs" v-on="on">
            <v-icon>mdi-cog</v-icon>
          </v-btn>
        </template>
        <v-card>
          <v-card-title class="text-h5">Choose new root folder?</v-card-title>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn color="green darken-1" text @click="dialog = false">
              Disagree
            </v-btn>
            <v-btn color="green darken-1" text @click="navToSettings">
              Agree
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script lang="ts">
import Vue from "vue";
import { EventNames, RouteNames } from "@/Enums";
import { mapFields } from "vuex-map-fields";
import { SheetFile } from "@/models/SheetFile";
import { SetList } from "@/models/SetList";

// noinspection JSVoidFunctionReturnValueUsed
export default Vue.extend({
  name: "App",

  mounted() {
    window.ipcRenderer.on(
      EventNames.SEND_VERSION,
      (event, appVersion: string) => {
        this.appVersion = appVersion;
      }
    );
    window.ipcRenderer.send(EventNames.GET_VERSION);

    window.ipcRenderer.on(
      EventNames.FOLDER_SELECTED,
      (event, selectedFolder: string) => {
        this.$store.commit("updateField", {
          path: "sheetMusicFolder",
          value: selectedFolder,
        });
        localStorage.setItem("sheetMusicFolder", selectedFolder);
        this.$router.push({
          name: "SheetSelection",
          params: { path: window.path.sep },
        });
      }
    );

    window.ipcRenderer.on(
      EventNames.FOLDER_LOADED,
      (event: any, filesAndFolder: SheetFile[]): void => {
        this.$store.commit("updateField", {
          path: "filesAndFolder",
          value: filesAndFolder,
        });
      }
    );
    window.ipcRenderer.on(
      EventNames.LOAD_SET_LISTS_RESULT,
      (event: any, setLists: SetList[]): void => {
        this.$store.commit("updateField", {
          path: "setLists",
          value: setLists,
        });
      }
    );

    window.ipcRenderer.on(
      EventNames.SEARCH_RESULTS,
      (event, searchResults: SheetFile[]) => {
        this.$store.commit("updateField", {
          path: "searchResults",
          value: searchResults,
        });
      }
    );
  },
  computed: {
    ...mapFields([
      "searchTerm",
      "searchVisible",
      "editMode",
      "setLists",
      "setListEditMode",
    ]),
    showBackButton: function () {
      let currentRoute = this.$route.name;
      switch (currentRoute) {
        case RouteNames.SheetSelection:
        case RouteNames.SheetViewer:
        case RouteNames.SetListList:
        case RouteNames.SetList:
          return true;
        case RouteNames.Root:
        case RouteNames.Overview:
        case RouteNames.FolderSetup:
          return false;
        default:
          console.log("Unspecified route found");
          return true;
      }
    },
    showSettingsButton: function () {
      let currentRoute = this.$route.name;
      return currentRoute !== RouteNames.FolderSetup;
    },
  },

  watch: {
    setLists: {
      deep: true,
      handler: function (newValue) {
        let basePath = this.$store.getters.getField("sheetMusicFolder");
        console.log("save new set lists", newValue);
        window.ipcRenderer.send(EventNames.SAVE_SET_LISTS, {
          basePath,
          setLists: newValue,
        });
      },
    },
  },

  methods: {
    onNavBack: function () {
      let clearSearch = !!this.$store.getters.getField("searchTerm");
      if (this.$route.name === RouteNames.SheetSelection && clearSearch) {
        this.$store.commit("clearSearch");
        return;
      }
      if (this.$store.getters.getField("editMode")) {
        this.$store.commit("toggleEditMode");
      }

      if (history.length === 1) {
        this.$router.push({ name: RouteNames.Root });
      } else {
        this.$router.go(-1);
      }
    },

    clearSearch(): void {
      this.$store.commit("clearSearch");
    },
    navToSettings: function () {
      this.dialog = false;
      this.$router.push({ name: RouteNames.FolderSetup });
    },
    onSwitchEditMode: function () {
      this.$store.commit("toggleEditMode");
    },
    startSetListEditMode: function () {
      this.$store.commit("startSetListEditMode");
    },
    showSearch: function () {
      let searchVisible = this.$store.getters.getField("searchVisible");
      searchVisible = !searchVisible;
      this.$store.commit("setVisible", searchVisible);
      if (searchVisible) {
        (this.$refs["searchWrapper"] as HTMLInputElement)?.focus();
      } else {
        (this.$refs["searchWrapper"] as HTMLInputElement)?.blur();
        this.$store.commit("clearSearch");
      }
    },
  },

  data: () => ({
    dialog: false,
    appVersion: (window as any).appVersion,
    sheetViewerRouterName: RouteNames.SheetViewer,
    sheetSelectionRouteName: RouteNames.SheetSelection,
    setListRouteName: RouteNames.SetList,
  }),
});
</script>

<style lang="less">
html {
  overflow: hidden !important;
  max-height: 100vh;
}

.searchWrapper {
  overflow: hidden;
  padding-bottom: 1px;

  > div {
    transform: translateX(100%);
    transition: transform 200ms ease-in-out;
  }

  &.searchVisible > div {
    transform: translateX(0);
  }
}
</style>
