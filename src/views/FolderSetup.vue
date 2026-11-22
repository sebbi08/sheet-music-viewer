<template>
  <div class="container">
    <v-card data-testid="select-folder" @click="selectFolder">
      <v-icon x-large>mdi-folder</v-icon>
      <h2>Select a root folder</h2>
      <p v-if="store.sheetMusicFolder" data-testid="current-folder" class="current-folder">
        Current folder: {{ store.sheetMusicFolder }}
      </p>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import router from "../router";
import useStore from "../store";
import { client } from "../trcpClient";


const store = useStore();

async function selectFolder() {
  // The dialog opens at the current folder.
  const selectedFolder = await client.selectFolder.query(store.sheetMusicFolder || undefined)
  store.setSheetMusicFolder(selectedFolder ?? "");
  router.push({
    name: "SheetSelection",
    params: { path: window.path.sep },
  });
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

  .current-folder {
    margin-top: 8px;
    word-break: break-all;
    text-align: center;
    user-select: text;
  }
}
</style>
