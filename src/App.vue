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
import { RouteNames } from "./Enums";
import { computed, ref, useTemplateRef } from "vue";
import useStore from "./store";
import router from "./router";
import { watch } from "vue";
import { storeToRefs } from "pinia";
import { client } from "./trcpClient";
import { UpdateData } from "./models/types";


const dialog = ref(false);
const appVersion = ref("");
const searchWrapper = useTemplateRef("searchWrapper")



const store = useStore();


client.getVersion.query().then((version) => {
  appVersion.value = version;
})



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
watch(setLists, async () => {
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

.searchFieldWrapper {
  max-width: 300px;
  min-width: 300px;
}

.v-card {
  user-select: none;
}
</style>
