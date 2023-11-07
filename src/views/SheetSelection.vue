<template>
  <div class="wrapper">
    <div class="container">
      <h6 class="text-h6">Path : {{ folderPath }}</h6>
    </div>
    <!--    <div class="scroll-container">-->
    <div class="container">
      <v-card
        v-for="item in searchOrFolder"
        :key="item.name + item.path"
        @click="selectItem(item)"
      >
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
    <!--    </div>-->
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import { EventNames, RouteNames } from "../Enums";
import { SheetFile } from "../models/SheetFile";
import { Watch } from "vue-property-decorator";
import { mapFields } from "vuex-map-fields";

@Component({
  computed: {
    ...mapFields(["searchTerm", "filesAndFolder", "searchResults"]),
  },
})
export default class SheetSelection extends Vue {
  filesAndFolder!: SheetFile[];
  pdfsAndFolders: SheetFile[] = [];
  searchResults!: SheetFile[];
  loadedRelative: string | null = "";

  get searchOrFolder(): SheetFile[] {
    return this.searchResults.length > 0
      ? this.searchResults
      : this.pdfsAndFolders;
  }

  get folderPath(): string {
    return this.$route?.params?.path
      ? this.$route.params.path
      : window.path.sep;
  }

  @Watch("filesAndFolder", { immediate: false, deep: true })
  getFolderAndPDFs(newVal: SheetFile[]): void {
    this.pdfsAndFolders =
      newVal
        ?.filter((item) => {
          if (item.isFile) {
            return item.name.toLowerCase().endsWith(".pdf");
          }
          return true;
        })
        .sort((a, b) => {
          if (a.isFile && !b.isFile) {
            return 1;
          }
          if (!a.isFile && b.isFile) {
            return -1;
          }
          return a.name.localeCompare(b.name);
        }) || [];
  }

  @Watch("searchTerm")
  searchInFolder(newSearchTerm: string): void {
    if (newSearchTerm === "") {
      this.searchResults = [];
      return;
    }
    this.searchFiles(newSearchTerm);
  }

  searchFiles(searchTerm: string): void {
    let basePath = this.$store.getters.getField("sheetMusicFolder");
    window.ipcRenderer.send(EventNames.SEARCH_FILES, {
      searchTerm,
      basePath,
    });
  }

  fileNameWithoutExtension(fileName: string): string {
    let indexOfExtension = fileName.lastIndexOf(".");
    if (indexOfExtension === -1) return fileName;
    return fileName.slice(0, indexOfExtension);
  }

  selectItem(item: SheetFile): void {
    if (item.isFile) {
      let basePath = this.$store.getters.getField("sheetMusicFolder");
      let path = basePath + this.folderPath + window.path.sep + item.name;
      if (item.isSearch) {
        path = item.path + window.path.sep + item.name;
      }
      this.$router.push({
        name: RouteNames.SheetViewer,
        params: { path: path },
      });
    } else {
      this.$router.push({
        name: RouteNames.SheetSelection,
        params: { path: this.folderPath + item.name + window.path.sep },
      });
    }
  }

  loadPath(): void {
    let relativePath = this.folderPath;
    let basePath = this.$store.getters.getField("sheetMusicFolder");
    if (this.loadedRelative === relativePath) {
      return;
    }
    this.loadedRelative = relativePath;
    window.ipcRenderer.send(EventNames.FOLDER_SELECTED, {
      basePath,
      relativePath,
    });
  }

  @Watch("$route", { deep: true, immediate: true })
  routeChange(): void {
    this.loadPath();
  }

  mounted(): void {
    this.loadedRelative = null;
    let searchTerm = this.$store.getters.getField("searchTerm");
    if (searchTerm) {
      this.searchFiles(searchTerm);
    }
    this.loadPath();
  }
}
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
