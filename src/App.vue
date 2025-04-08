<template>

  <v-app>
    <v-app-bar density="compact" app dark v-bind:color="store.editMode ? 'red' : 'primary'">
      <v-btn v-if="showBackButton" icon @click="onNavBack">
        <v-icon>mdi-arrow-left</v-icon>
      </v-btn>
      <div>Sheet music viewer : {{ appVersion }}</div>
      <v-spacer></v-spacer>
      <div class="searchFieldWrapper">
        
        <v-text-field append-inner-icon="mdi-magnify" density="compact" ref="searchWrapper" v-model="store.searchTerm"
        hide-details="auto" label="" width="100%" variant="underlined"></v-text-field>
      </div>
      <v-btn v-if="router.currentRoute.value.name === sheetViewerRouterName" dark icon @click="onSwitchEditMode">
        <v-icon>{{ store.editMode ? "mdi-close" : "mdi-pencil" }}</v-icon>
      </v-btn>
      <v-btn v-if="router.currentRoute.value.name === setListRouteName" dark icon @click="toggleSetListSortMode">
        <v-icon>
          {{ store.sortSetListEnabled ? "mdi-close" : "mdi-hand-back-right" }}
        </v-icon>
      </v-btn>
      <v-btn v-if="router.currentRoute.value.name === setListRouteName && !store.setListEditMode" dark icon
        @click="startSetListEditMode">
        <v-icon>mdi-pencil</v-icon>
      </v-btn>
      <v-btn v-if="router.currentRoute.value.name === setListListRouteName" dark icon
        @click="toggleSetListDeletionMode">
        <v-icon>{{ store.setListDeletionMode ? "mdi-close" : "mdi-delete" }}</v-icon>
      </v-btn>
      <v-dialog v-if="showSettingsButton" v-model="dialog" max-width="320" persistent>
        <template v-slot:activator="{ props }">
          <v-btn dark icon v-bind="props">
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

<script setup lang="ts">
import { EventNames, RouteNames } from "./Enums";
import { type SheetFile } from "./models/SheetFile";
import { type SetList } from "./models/SetList";
import { computed, type Ref, ref, useTemplateRef } from "vue";
import useStore from "./store";
import router from "./router";
import { watch } from "vue";
import { storeToRefs } from "pinia";

const dialog = ref(false);
const appVersion = ref("");
const sheetViewerRouterName = ref(RouteNames.SheetViewer);
const sheetSelectionRouteName = ref(RouteNames.SheetSelection);
const setListRouteName = ref(RouteNames.SetList);
const setListListRouteName = ref(RouteNames.SetListList);
const searchWrapper = useTemplateRef("searchWrapper")



const store = useStore();


window.ipcRenderer.on(
  EventNames.SEND_VERSION,
  (event, newAppVersion: string) => {
    appVersion.value = newAppVersion;
  }
);
window.ipcRenderer.send(EventNames.GET_VERSION);

window.ipcRenderer.on(
  EventNames.FOLDER_SELECTED,
  (event, selectedFolder: string) => {

    store.sheetMusicFolder = selectedFolder;

    localStorage.setItem("sheetMusicFolder", selectedFolder);
    router.push({
      name: "SheetSelection",
      params: { path: window.path.sep },
    });
  }
);

window.ipcRenderer.on(
  EventNames.FOLDER_LOADED,
  (event: any, filesAndFolder: SheetFile[]): void => {
    store.filesAndFolder = filesAndFolder;

  }
);
window.ipcRenderer.on(
  EventNames.LOAD_SET_LISTS_RESULT,
  (event: any, setLists: SetList[]): void => {
    store.setLists = setLists;
  }
);

window.ipcRenderer.on(
  EventNames.SEARCH_RESULTS,
  (event, searchResults: SheetFile[]) => {
    store.searchResults = searchResults;
  }
);

const showBackButton = computed(() => {
  let currentRoute = router.currentRoute.value.name;
  switch (currentRoute) {
    case RouteNames.SheetSelection:
    case RouteNames.SheetViewer:
    case RouteNames.SetListList:
    case RouteNames.SetList:
      return true;
    case RouteNames.Overview:
    case RouteNames.FolderSetup:
      return false;
    default:
      console.log(`Unspecified route found ${String(currentRoute)}`);

      return true;
  }
})
const showSettingsButton = computed(() => {
  let currentRoute = router.currentRoute.value.name;
  return currentRoute !== RouteNames.FolderSetup;
})

function onNavBack() {
  let clearSearch = !!store.searchTerm;
  if (router.currentRoute.value.name === RouteNames.SheetSelection && clearSearch) {
    store.searchTerm = "";
    return;
  }
  if (store.editMode) {
    store.toggleEditMode();
  }

  if (history.length === 1) {
    router.push({ name: RouteNames.Overview });
  } else {
    router.go(-1);
  }
}

function navToSettings() {
  dialog.value = false;
  router.push({ name: RouteNames.FolderSetup });
}
function onSwitchEditMode() {
  store.toggleEditMode();
}
function startSetListEditMode() {
  store.showEditSetListDialog = true;
}
function toggleSetListDeletionMode() {
  store.toggleSetListDeletionMode();
}
function toggleSetListSortMode() {
  store.toggleSetListSortMode();
}
function showSearch() {
  (searchWrapper.value as HTMLInputElement)?.focus();
}

const { setLists } = storeToRefs(store);
watch(setLists, (newVal) => {
  let basePath = store.sheetMusicFolder;
  window.ipcRenderer.send(EventNames.SAVE_SET_LISTS, {
    basePath,
    setLists: JSON.parse(JSON.stringify(newVal)),
  });
}, { deep: true });

</script>

<style lang="less">
html {
  overflow: hidden !important;
  max-height: 100vh;
}

.searchFieldWrapper{
  max-width: 300px;
  min-width: 300px;
}
.v-card {
  user-select: none;
}
</style>
