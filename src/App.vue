<template>

  <v-app>
    <v-app-bar density="compact" app dark v-bind:color="store.editMode ? 'red' : 'primary'">
      <template v-slot:prepend>
        <v-btn v-if="showBackButton" icon @click="onNavBack">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </template>



      <v-app-bar-title>Sheet music viewer : {{ appVersion }}</v-app-bar-title>
      <template v-slot:append>

        <div v-if="router.currentRoute.value.name === RouteNames.SheetSelection" class="searchFieldWrapper">

          <v-text-field append-inner-icon="mdi-magnify" density="compact" ref="searchWrapper" v-model="store.searchTerm"
            hide-details="auto" label="" width="100%" variant="underlined"></v-text-field>
        </div>

        <v-btn v-if="router.currentRoute.value.name === RouteNames.SheetViewer" dark icon @click="onSwitchEditMode">
          <v-icon>{{ store.editMode ? "mdi-close" : "mdi-pencil" }}</v-icon>
        </v-btn>

        <v-btn v-if="router.currentRoute.value.name === RouteNames.SetList" dark icon @click="toggleSetListSortMode">
          <v-icon>
            {{ store.sortSetListEnabled ? "mdi-close" : "mdi-hand-back-right" }}
          </v-icon>
        </v-btn>

        <v-btn v-if="router.currentRoute.value.name === RouteNames.SetList && !store.setListEditMode" dark icon
          @click="startSetListEditMode">
          <v-icon>mdi-pencil</v-icon>
        </v-btn>

        <v-btn v-if="router.currentRoute.value.name === RouteNames.SetListList" dark icon
          @click="toggleSetListDeletionMode">
          <v-icon>{{ store.setListDeletionMode ? "mdi-close" : "mdi-delete" }}</v-icon>
        </v-btn>

        <v-dialog class="setListDialog" v-if="router.currentRoute.value.name === RouteNames.SheetViewer" v-model="addToSetListDialog"
          max-width="320" persistent>
          <template v-slot:activator="{ props }">
            <v-btn dark icon v-bind="props">
              <v-icon>mdi-plus</v-icon>
            </v-btn>
          </template>
          <v-card>
            <v-card-title class="text-h5">Change containing set lists?</v-card-title>
            <v-list-item v-for="item in setListsWrapper.setLists" :key="item.id">
              <v-checkbox density="compact" :label="item.name" v-model="selectedSetLists[item.id]"></v-checkbox>
            </v-list-item>
            <v-card-actions>
              <v-spacer></v-spacer>
              <v-btn color="green darken-1" text @click="addToSetListDialog = false">
                Cancel
              </v-btn>
              <v-btn color="green darken-1" text @click="addCurrentSheetToSetlist">
                Add/Remove
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

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
      </template>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
  <dialog>
    <v-dialog persistent v-model="showUpdateDialog" max-width="300">
      <v-card>
        <v-card-title class="text-h5">New version available</v-card-title>
        <v-card-text v-if="!updateDownloaded">
          <v-progress-circular color="primary" indeterminate></v-progress-circular> Downloading the update
        </v-card-text>
        <v-card-text v-if="updateDownloaded">
          <p>Version {{ updateData.releaseName }} is ready to be installed.</p>
          <p>Release notes:</p>
          <p>{{ updateData.releaseNotes }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>

          <v-btn color="primary" v-if="updateDownloaded" text @click="restartForUpdate">
            Restart for update
          </v-btn>
          <v-btn color="secondary" text @click="showUpdateDialog = false">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </dialog>
</template>

<script setup lang="ts">
import _ from "lodash";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { RouteNames } from "./Enums";
import { UpdateData } from "./models/types";
import router from "./router";
import useStore from "./store";
import { client } from "./trcpClient";


const dialog = ref(false);
const addToSetListDialog = ref(false);
const appVersion = ref("");



const store = useStore();


client.getVersion.query().then((version) => {
  appVersion.value = version;
})



const showBackButton = computed(() => {
  const currentRoute = router.currentRoute.value.name;
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
  const currentRoute = router.currentRoute.value.name;
  return currentRoute === RouteNames.Overview;
})

function onNavBack() {
  const clearSearch = !!store.searchTerm;
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

function addCurrentSheetToSetlist() {
  const { path } = router.currentRoute.value.params
  const relativePath = window.path.relative(store.sheetMusicFolder, path as string);
  const fileName = window.path.basename(relativePath);
  const folderName = relativePath.includes(window.path.sep) ? window.path.dirname(relativePath) : ""
  const folderPath = folderName.split(window.path.sep).filter((part) => part !== "")

  const setListsToAdd = store.setListsWrapper.setLists.filter((setList) => selectedSetLists.value[setList.id]);
  const setListsToRemove = store.setListsWrapper.setLists.filter((setList) => !selectedSetLists.value[setList.id]);

  

  setListsToAdd.forEach(list => {
    if( list.sheets.some(sheet => sheet.name === fileName && _.isEqual(sheet.path, folderPath))) {
      return; // Sheet already exists in the SetList
    }
    return list.sheets.push({
      isFile: true,
      name: fileName,
      path: folderPath,
      isSearch: false
    });
  })

  setListsToRemove.forEach(list => {
    const index = list.sheets.findIndex(sheet => sheet.name === fileName && _.isEqual(sheet.path, folderPath));
    if (index !== -1) {
      list.sheets.splice(index, 1);
    }
  });
  store.saveSetLists();

  addToSetListDialog.value = false;
}

const selectedSetLists = ref<Record<string, boolean>>({});
watch(addToSetListDialog, (newValue) => {
  if (newValue) {
    store.setListsWrapper.setLists.forEach(setList => {
      selectedSetLists.value[setList.id] = setList.sheets.some(sheet => {
        const { path } = router.currentRoute.value.params;
        const relativePath = window.path.relative(store.sheetMusicFolder, path as string);
        const fileName = window.path.basename(relativePath);
        const folderPath = relativePath.includes(window.path.sep) ? window.path.dirname(relativePath).split(window.path.sep) : []
        return sheet.name === fileName && _.isEqual(sheet.path, folderPath);
      });
    });
  }
}, { immediate: true });

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

const { setListsWrapper } = storeToRefs(store);
store.loadSetLists();
watch(setListsWrapper, async () => {
  await store.saveSetLists();
}, { deep: true });

const showUpdateDialog = ref(false);
const updateDownloaded = ref(false);
const updateData = ref<Partial<UpdateData>>({});

function restartForUpdate() {
  client.restartForUpdate.mutate();
}

client.onNewVersion.subscribe(undefined, {
  onData: () => {
    showUpdateDialog.value = true
  }
})

client.onNewVersionDownloaded.subscribe(undefined, {
  onData: (args) => {
    updateData.value = args
    updateDownloaded.value = true;
  }
})

client.checkForUpdates.query()

</script>

<style lang="less">
html {
  overflow: hidden !important;
  max-height: 100vh;
}

.setListDialog {
  .v-input__details{
    display: none;
  }
  .v-list-item{
    padding-top: 0;
    padding-bottom: 0;
  }
}

.searchFieldWrapper {
  max-width: 300px;
  min-width: 300px;
}

.v-card {
  user-select: none;
}
</style>
