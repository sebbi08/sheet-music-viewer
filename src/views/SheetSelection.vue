<template>
  <div class="wrapper">
    <h6 class="text-h6">Select PDF : {{ folderPath }}</h6>

    <div class="container">
      <v-card
        @click="selectItem(item)"
        v-for="item in filesAndFolder"
        :key="item.name"
      >
        <v-icon x-large>{{ item.isFile ? "mdi-file" : "mdi-folder" }}</v-icon>
        <h2>{{ item.name }}</h2>
      </v-card>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import { eventNames } from "@/eventNames";
import { SheetFile } from "@/models/SheetFile";
import { mapFields } from "vuex-map-fields";

declare global {
  interface Window {
    ipcRenderer: any;
  }
}

@Component({
  computed: {
    ...mapFields(["filesAndFolder"]),
  },
})
export default class SheetSelection extends Vue {
  filesAndFolder?: SheetFile[];
  loadedBasePath = "";

  get folderPath() {
    return this.$route?.params?.path ? this.$route.params.path : "/";
  }

  selectItem(item: SheetFile): void {
    this.$router.push({
      name: "SheetSelection",
      params: { path: "/" + item.name + "/" },
    });
  }

  loadPath(): void {
    let relativePath = this.folderPath;
    let basePath = this.$store.getters.getField("sheetMusicFolder");
    if (this.loadedBasePath === basePath) {
      return;
    }
    this.loadedBasePath = basePath;
    window.ipcRenderer.send(eventNames.FOLDER_SELECTED, {
      basePath: basePath,
      relativePath,
    });
  }

  updated(): void {
    this.$nextTick(function () {
      this.loadPath();
    });
  }

  mounted() {
    window.ipcRenderer.on(
      eventNames.FOLDER_LOADED,
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
  overflow: auto;
  height: calc(100% - 32px);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;

  .v-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    margin: 16px;
  }
}

.wrapper {
  height: 100%;
}
</style>
