<template>
  <div class="container">
    <v-card @click="goToFolders()">
      <v-icon x-large>mdi-folder</v-icon>
      <h2 class="itemName">Folder Selection</h2>
    </v-card>
    <v-card @click="goToSetLists()">
      <v-icon x-large>mdi-bookmark-music</v-icon>
      <h2 class="itemName">Set Lists</h2>
    </v-card>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import { RouteNames } from "@/Enums";

@Component
export default class Overview extends Vue {
  goToSetLists(): void {
    this.$router.push({ name: RouteNames.SetListList });
  }

  goToFolders(): void {
    this.$router.push({ name: RouteNames.SheetSelection });
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
