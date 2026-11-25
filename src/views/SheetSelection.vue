<template>
  <div class="wrapper">
    <div class="container">
      <h6 class="text-h6">Path : {{ folderPath }}</h6>
    </div>
    <div class="container">
      <v-card v-for="item in searchOrFolder" :key="item.name + item.path" @click="selectItem(item)">
        <!-- Favorite (spec 2026-11-25): toggles without opening the sheet; none while the marks are unknown. -->
        <v-btn v-if="item.isFile && showHearts" class="favoriteToggle" data-testid="favorite-toggle" icon
          variant="text" size="small" :color="isFavorite(item) ? 'red' : undefined" @click.stop="toggleFavorite(item)">
          <v-icon>{{ isFavorite(item) ? "mdi-heart" : "mdi-heart-outline" }}</v-icon>
        </v-btn>
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
import { useFavorites } from '../store/favorites';
import { fileNameWithoutExtension, sortAndFilterFile } from "../utils";

const store = useStore();
const favorites = useFavorites();
const loadedRelative = ref<string | null>("");
/** Hearts show once the marks were read for this view and could be read. */
const keysLoaded = ref(false);
const showHearts = computed(() => keysLoaded.value && favorites.keysError === null);



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





watch(router.currentRoute, (route) => {
  loadPath();
  if (route.name === RouteNames.SheetSelection) void loadKeys();
})

// Search results may show sheets of other folders: read the marks again (only `.config.json`, no PDF).
watch(() => store.searchResults, () => {
  void loadKeys();
})

async function loadKeys(): Promise<void> {
  await favorites.loadKeys();
  keysLoaded.value = true;
}

/** The absolute path of a PDF card, as the viewer gets it. */
function pdfPathOf(item: SheetFile): string {
  const path = item.isSearch
    ? item.path + window.path.sep + item.name
    : store.sheetMusicFolder + folderPath.value + window.path.sep + item.name;
  return path.replace(window.path.sep + window.path.sep, window.path.sep);
}

const isFavorite = (item: SheetFile) => favorites.isFavorite(pdfPathOf(item));

function toggleFavorite(item: SheetFile): void {
  if (!showHearts.value) return;
  const pdfPath = pdfPathOf(item);
  void favorites.set(pdfPath, !favorites.isFavorite(pdfPath));
}





function selectItem(item: SheetFile): void {
  if (item.isFile) {
    router.push({ name: RouteNames.SheetViewer, params: { path: pdfPathOf(item) } });
  } else {
    const path = folderPath.value + item.name + window.path.sep
    router.push({
      name: RouteNames.SheetSelection,
      params: { path: path.replace(window.path.sep + window.path.sep, window.path.sep) },
    });
  }
}

async function loadPath() {
  const basePath = store.sheetMusicFolder;
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
  void loadKeys();
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
    position: relative;
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

.favoriteToggle {
  position: absolute;
  top: 4px;
  right: 4px;
}

.itemName {
  word-break: break-word;
  text-align: center;
}

.wrapper {
  height: 100%;
}
</style>
