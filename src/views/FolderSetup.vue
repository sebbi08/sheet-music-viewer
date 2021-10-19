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
import { EventNames } from "@/Enums";

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
        EventNames.FOLDER_SELECTED,
        (selectedFolder: string) => {
          this.sheetMusicFolder = selectedFolder;
          localStorage.setItem("sheetMusicFolder", selectedFolder);
          this.$router.push({
            name: "SheetSelection",
            params: { path: window.path.sep },
          });
        }
      );
    }
  }

  selectFolder(): void {
    if (window.ipcRenderer) {
      window.ipcRenderer.send(EventNames.SELECT_FOLDER);
    }
  }
}
</script>

<style lang="less" scoped>
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
