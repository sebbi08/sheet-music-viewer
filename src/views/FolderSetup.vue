<template>
  <div class="container">
    <v-card @click="selectFolder">
      <v-icon x-large>mdi-folder</v-icon>
      <h2>Select a root folder</h2>
    </v-card>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { Component } from "vue-property-decorator";
import { mapFields } from "vuex-map-fields";
import { eventNames } from "@/eventNames";

declare global {
  interface Window {
    ipcRenderer: any;
  }
}

@Component({
  computed: {
    ...mapFields(["sheetMusicFolder"]),
  },
})
export default class FolderSetup extends Vue {
  public sheetMusicFolder!: string;

  mounted(): void {
    if (window.ipcRenderer) {
      window.ipcRenderer.on(
        eventNames.FOLDER_SELECTED,
        (selectedFolder: string) => {
          this.sheetMusicFolder = selectedFolder;
          this.$router.push({ name: "SheetSelection", params: { path: "/" } });
        }
      );
    }
  }

  selectFolder(): void {
    if (window.ipcRenderer) {
      window.ipcRenderer.send(eventNames.SELECT_FOLDER);
    }
  }
}
</script>

<style scoped lang="less">
.container {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  .v-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
}
</style>
