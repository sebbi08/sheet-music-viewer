<template>
  <div class="wrapper">
    <h6 class="text-h6">Select PDF : {{ folderPath }}</h6>
    <!--    <div class="scroll-container">-->
    <div class="container">
      <v-card
        @click="selectItem(item)"
        v-for="item in pdfsAndFolders"
        :key="item.name"
      >
        <v-icon x-large>{{ item.isFile ? "mdi-file" : "mdi-folder" }}</v-icon>
        <h2>{{ item.name }}</h2>
      </v-card>
    </div>
    <!--    </div>-->
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import { EventNames, RouteNames } from "@/Enums";
import { SheetFile } from "@/models/SheetFile";
import { mapFields } from "vuex-map-fields";
import { Watch } from "vue-property-decorator";

declare global {
  interface Window {
    ipcRenderer: any;
  }
}

@Component
export default class SheetSelection extends Vue {
  filesAndFolder: SheetFile[] = [];
  pdfsAndFolders: SheetFile[] = [];
  loadedRelativ = "";

  @Watch("filesAndFolder", { immediate: true, deep: true })
  getFolderAndPDFs(newVal: SheetFile[]): void {
    this.pdfsAndFolders = newVal.filter((item) => {
      if (item.isFile) {
        return item.name.toLowerCase().endsWith(".pdf");
      }
      return true;
    });
  }

  get folderPath() {
    return this.$route?.params?.path ? this.$route.params.path : "/";
  }

  selectItem(item: SheetFile): void {
    if (item.isFile) {
      let basePath = this.$store.getters.getField("sheetMusicFolder");
      this.$router.push({
        name: RouteNames.SheetViewer,
        params: { path: basePath + this.folderPath + item.name },
      });
    } else {
      this.$router.push({
        name: "SheetSelection",
        params: { path: this.folderPath + item.name + "/" },
      });
    }
  }

  loadPath(): void {
    let relativePath = this.folderPath;
    let basePath = this.$store.getters.getField("sheetMusicFolder");
    if (this.loadedRelativ === relativePath) {
      return;
    }
    this.loadedRelativ = relativePath;
    window.ipcRenderer.send(EventNames.FOLDER_SELECTED, {
      basePath: basePath,
      relativePath,
    });
  }

  @Watch("$route")
  routeChange(): void {
    this.loadPath();
  }

  mounted() {
    window.ipcRenderer.on(
      EventNames.FOLDER_LOADED,
      (filesAndFolders: SheetFile[]) => {
        this.filesAndFolder = filesAndFolders;
      }
    );

    this.loadPath();
  }
}
</script>

<style scoped lang="less">
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
    max-height: 200px;
  }
}

.wrapper {
  height: 100%;
}
</style>
