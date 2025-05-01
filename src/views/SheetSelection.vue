<template>
  <div class="wrapper">
    <div class="container">
      <h6 class="text-h6">Path : {{ folderPath }}</h6>
    </div>
    <div class="container">
      <v-card v-for="item in searchOrFolder" :key="item.name + item.path" @click="selectItem(item)">
        <v-icon x-large>{{ item.isFile ? "mdi-file" : "mdi-folder" }}</v-icon>
        <h2 v-if="!item.isSearch" class="itemName">
          {{ fileNameWithoutExtension(item.name) }}
        </h2>
        <div v-if="item.isSearch">
          <h4 class="itemName">
            {{ fileNameWithoutExtension(item.name) }}
          </h4>
          <h5 class="itemName">
            {{ item.path }}
          </h5>
        </div>
      </v-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { isArray } from 'lodash';
import { storeToRefs } from "pinia";
import { computed, onMounted, ref, watch } from 'vue';
import { RouteNames } from '../Enums';
import type { SheetFile } from '../models/types';
import router from '../router';
import useStore from '../store';
import { fileNameWithoutExtension, sortAndFilterFile } from "../utils";

const store = useStore();
const loadedRelative = ref<string | null>("");



const folderPath = computed(() => {
  const param = router.currentRoute.value.params?.path
  if (isArray(param)) {
    return param[0]
  }

  return param
    ? param
    : window.path.sep;
})

const pdfsAndFolders = ref<SheetFile[]>([])

const searchOrFolder = computed(() => {
  return store.searchResults.length > 0
    ? sortAndFilterFile(store.searchResults)
    : pdfsAndFolders.value;
})


async function searchFiles(searchTerm: string) {
  await store.searchForFiles(searchTerm);
}

const { searchTerm, filesAndFolder } = storeToRefs(store);

watch(searchTerm, (newSearchTerm: string) => {
  if (newSearchTerm === "") {
    store.searchResults = [];
  } else {

    searchFiles(newSearchTerm);
  }
})

watch(filesAndFolder, (newVal) => {
  pdfsAndFolders.value = sortAndFilterFile(newVal);
})





watch(router.currentRoute, () => {
  loadPath();
})





function selectItem(item: SheetFile): void {
  if (item.isFile) {
    let basePath = store.sheetMusicFolder;
    let path = basePath + folderPath.value + window.path.sep + item.name;
    if (item.isSearch) {
      path = item.path + window.path.sep + item.name;
    }
    router.push({
      name: RouteNames.SheetViewer,
      params: { path: path.replace(window.path.sep + window.path.sep, window.path.sep) },
    });
  } else {
    const path = folderPath.value + item.name + window.path.sep
    router.push({
      name: RouteNames.SheetSelection,
      params: { path: path.replace(window.path.sep + window.path.sep, window.path.sep) },
    });
  }
}

async function loadPath() {
  let basePath = store.sheetMusicFolder;
  if (loadedRelative.value === folderPath.value) {
    return;
  }
  loadedRelative.value = folderPath.value;

  await store.loadFiles(basePath, folderPath.value);
}



onMounted(() => {
  loadedRelative.value = null;
  if (searchTerm.value) {
    searchFiles(searchTerm.value);
  }
  loadPath();
})

</script>

<style lang="less" scoped>
.container {
  max-height: calc(100vh - 32px - 64px);
  width: auto;
  overflow: auto;
  display: flex;
  flex-wrap: wrap;

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

.itemName {
  word-break: break-word;
  text-align: center;
}

.wrapper {
  height: 100%;
}
</style>
