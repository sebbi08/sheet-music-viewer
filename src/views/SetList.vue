<template>
  <div>
    <div class="container">
      <draggable v-model="setList.sheets" item-key="name" :disabled="!store.sortSetListEnabled">
        <template #item="{ element }">
          <v-card @click="openSheet(element)">
            <v-icon x-large>mdi-file</v-icon>
            <div>
              <h4 class="itemName">
                {{ fileNameWithoutExtension(element.name) }}
              </h4>
              <h5 class="itemName">
                {{ element.path }}
              </h5>
            </div>
          </v-card>
        </template>
      </draggable>
    </div>

    <v-dialog v-model="showEditSetListDialog" class="setListEditDialog" max-width="466px" scrollable
      transition="dialog-bottom-transition">
      <v-card>
        <v-card-title>
          <span>Edit Set List</span>
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text>
          <div class="folderView">
            <v-list-item @click="moveFolderUp()">
              <v-list-item-title class="listRow">
                <div class="text">..</div>
              </v-list-item-title>
            </v-list-item>
            <v-list-item v-for="item in pdfsAndFolders" :key="item.path + item.name" @click="selectItem(item)">
              <v-list-item-title class="listRow">
                <v-icon v-if="!item.isFile" x-large>mdi-folder</v-icon>
                <v-icon v-if="item.isFile" :class="isFileInSetList(item)
                  ? 'fileIndicator fileIndicatorGreen'
                  : 'fileIndicator'
                  ">{{ isFileInSetList(item) ? "mdi-check" : "mdi-close" }}
                </v-icon>
                <div class="text">
                  {{ fileNameWithoutExtension(item.name) }}
                </div>
              </v-list-item-title>
            </v-list-item>
          </div>
        </v-card-text>
        <v-divider></v-divider>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="secondary" text @click="showEditSetListDialog = false">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { SetList } from '../models/SetList';
import type { SheetFile } from '../models/SheetFile';
import useStore from '../store';
import { fileNameWithoutExtension, sortAndFilterFile } from "../utils"
import { EventNames, RouteNames } from '../Enums';
import router from '../router';
import { storeToRefs } from 'pinia';
import draggable from 'vuedraggable'

const store = useStore();

const setList = ref<SetList>({ name: "", sheets: [], id: -1 });
const currentPath = ref("");
const pdfsAndFolders = ref<SheetFile[]>([]);
const loadedRelative = ref<string | null>(null);
const { filesAndFolder, showEditSetListDialog, setLists } = storeToRefs(store);

const folderPath = computed(() => {
  return currentPath.value ? currentPath.value : window.path.sep;
});




function openSheet(item: SheetFile): void {
  let basePath = store.sheetMusicFolder;
  let path = basePath + item.path
  if (!path.endsWith(window.path.sep) && !item.name.startsWith(window.path.sep)) {
    path = path + window.path.sep + item.name
  } else {
    path = path + item.name
  }

  router.push({
    name: RouteNames.SheetViewer,
    params: { path: path.replace(window.path.sep+window.path.sep,window.path.sep) },
  });
}

function moveFolderUp(): void {
  if (currentPath.value === "" || currentPath.value === "/") {
    return;
  }
  let split = currentPath.value.split(window.path.sep);
  split.pop();
  currentPath.value = split.join(window.path.sep);
}

function selectItem(item: SheetFile): void {
  if (item.isFile) {
    if (!isFileInSetList(item)) {
      setList.value.sheets.push({
        name: item.name,
        path: currentPath.value,
        isFile: true,
        isSearch: false,
      });
    } else if (setList.value) {
      setList.value.sheets = setList.value.sheets.filter((sheet) => {
        return !(sheet.path === currentPath.value && sheet.name === item.name);
      });
    }
  } else {
    if (currentPath.value) {
      currentPath.value = currentPath.value + window.path.sep + item.name;
    } else {
      currentPath.value = window.path.sep + item.name;
    }
  }
}

function isFileInSetList(sheet: SheetFile): boolean {
  return (
    setList.value.sheets.some((sheetInSet) => {
      return (
        sheetInSet.name === sheet.name && sheetInSet.path === currentPath.value
      );
    }) || false
  );
}

watch(filesAndFolder, (newVal) => {
  pdfsAndFolders.value = sortAndFilterFile(newVal);
})

function loadPath(): void {
  let relativePath = folderPath;
  let basePath = store.sheetMusicFolder;
  if (loadedRelative.value === relativePath.value) {
    return;
  }
  loadedRelative.value = relativePath.value;
  window.ipcRenderer.send(EventNames.FOLDER_SELECTED, {
    basePath,
    relativePath: relativePath.value,
  });
}


watch(showEditSetListDialog, () => {
  if (showEditSetListDialog.value) {
    if (currentPath.value === "") {
      loadPath();
    }
    currentPath.value = "";
  } else {
    store.filesAndFolder = [];
  }
})

watch(currentPath, () => {
  loadPath();
}, { deep: true });

watch(setLists, (newVal) => {
  setList.value = store.setLists.find(
    (setList: SetList) => setList.id === parseInt(router.currentRoute.value.params.id as string, 10)
  ) || { name: "", sheets: [], id: -1 };
}, { deep: true });

onMounted(() => {
  store.sortSetListEnabled = false;
  loadedRelative.value = null;
  let basePath = store.sheetMusicFolder;
  window.ipcRenderer.send(EventNames.LOAD_SET_LISTS, {
    basePath,
  });
})
</script>
<style lang="less" scoped>
.setListEditDialog {
  margin-top: 48px;
}

.folderView {
  flex-grow: 2;

  .listRow {
    display: flex;
    flex-direction: row;
    align-items: center;

    .text {
      margin-left: 16px;
    }

    .fileIndicator {
      background: rgba(0, 0, 0, 0.54);
      width: 40px;
      height: 40px;
      border-radius: 40px;
      color: red;
    }

    .fileIndicatorGreen {
      color: lime;
    }
  }
}

.container {
  >div {
    max-height: calc(100vh - 32px - 64px);
    width: auto;
    overflow: auto;
    display: flex;
    flex-wrap: wrap;
  }

  .v-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    margin: 16px;
    width: calc(25% - 32px);

    @media (max-width: 960px) {
      width: calc(33% - 32px);
    }

    @media (max-width: 700px) {
      width: calc(50% - 32px);
    }

    @media (max-width: 400px) {
      width: calc(100% - 32px);
    }
  }
}
</style>
