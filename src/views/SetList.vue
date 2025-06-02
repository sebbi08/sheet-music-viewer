<template>
  <div>
    <div class="container">
      <draggable v-model="setList.sheets" item-key="name" :disabled="!store.sortSetListEnabled">
        <template #item="{ element } : { element: SetListSheet }">
          <v-card @click="openSheet(element)">
            <v-icon x-large>mdi-file</v-icon>
            <div>
              <h4 class="itemName">
                {{ fileNameWithoutExtension(element.name) }}
              </h4>
              <h5 class="itemName">
                {{ sep + element.path.join(sep) }}
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
import _ from "lodash";
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import { RouteNames } from '../Enums';
import { SetList, SetListSheet, SheetFile } from '../models/types';
import router from '../router';
import useStore from '../store';
import { fileNameWithoutExtension, sortAndFilterFile } from "../utils";



const store = useStore();

const sep = ref(window.path.sep);
const setList = ref<SetList>({ name: "", sheets: [], id: -1 });
const currentPath = ref("");
const pdfsAndFolders = ref<SheetFile[]>([]);
const loadedRelative = ref<string | null>(null);
const { filesAndFolder, showEditSetListDialog, setListsWrapper } = storeToRefs(store);

const folderPath = computed(() => {
  return currentPath.value ? currentPath.value : window.path.sep;
});




function openSheet(item: SetListSheet): void {
  const basePath = store.sheetMusicFolder;
  let path = basePath + window.path.sep + item.path.join(window.path.sep);
  if (!path.endsWith(window.path.sep) && !item.name.startsWith(window.path.sep)) {
    path = path + window.path.sep + item.name
  } else {
    path = path + item.name
  }

  router.push({
    name: RouteNames.SheetViewer,
    params: { path: path.replace(window.path.sep + window.path.sep, window.path.sep) },
  });
}

function moveFolderUp(): void {
  if (currentPath.value === "" || currentPath.value === "/") {
    return;
  }
  const split = currentPath.value.split(window.path.sep);
  split.pop();
  currentPath.value = split.join(window.path.sep);
}

function selectItem(item: SheetFile): void {
  if (item.isFile) {
    const pathParts = currentPath.value.split(window.path.sep).filter((part) => part !== "");
    if (!isFileInSetList(item)) {
      setList.value.sheets.push({
        name: item.name,
        path: pathParts,
        isFile: true,
        isSearch: false,
      });
    } else if (setList.value) {
      setList.value.sheets = setList.value.sheets.filter((sheet) => {
        return !(_.isEqual(sheet.path, pathParts) && sheet.name === item.name);
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
  // const sheetPathRelativeToRoot = window.path.relative(
  //   store.sheetMusicFolder,
  //   sheet.path
  // );
  return (
    setList.value.sheets.some((sheetInSet) => {
      return (
        sheetInSet.name === sheet.name && _.isEqual(sheetInSet.path, currentPath.value.split(window.path.sep).filter((part) => part !== ""))
      );
    }) || false
  );
}

watch(filesAndFolder, (newVal) => {
  pdfsAndFolders.value = sortAndFilterFile(newVal);
})

async function loadPath() {
  const relativePath = folderPath;
  const basePath = store.sheetMusicFolder;
  // if (loadedRelative.value === relativePath.value) {
  // return;
  // }
  loadedRelative.value = relativePath.value;
  await store.loadFiles(basePath, relativePath.value);
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

watch(setListsWrapper, (newVal) => {
  setList.value = store.setListsWrapper.setLists.find(
    (setList: SetList) => setList.id === parseInt(router.currentRoute.value.params.id as string, 10)
  ) || { name: "", sheets: [], id: -1 };
}, { deep: true });

onMounted(() => {
  store.sortSetListEnabled = false;
  loadedRelative.value = null;
  store.loadSetLists();
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
