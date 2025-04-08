<template>
  <div class="container">
    <v-card @click="selectFolder">
      <v-icon x-large>mdi-folder</v-icon>
      <h2>Select a root folder</h2>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import router from "../router";
import useStore from "../store";
import { client } from "../trcpClient";


const store = useStore();

async function selectFolder() {
  const selectedFolder = await client.selectFolder.query()
  store.sheetMusicFolder = selectedFolder;

    localStorage.setItem("sheetMusicFolder", selectedFolder);
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
}
</style>
