<template>
  <v-app>
    <v-app-bar app color="primary" dark>
      <v-btn @click="navBack" icon v-if="showBackButton">
        <v-icon>mdi-arrow-left</v-icon>
      </v-btn>
      <div>Sheet music viewer</div>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script lang="ts">
import Vue from "vue";
import { RouteNames } from "@/Enums";

export default Vue.extend({
  name: "App",

  computed: {
    showBackButton: function () {
      let currentRoute = this.$route.name;
      if (currentRoute === RouteNames.FolderSetup) {
        return false;
      }
      if (currentRoute === RouteNames.SheetViewer) {
        return true;
      }
      if (currentRoute === RouteNames.SheetSelection) {
        return this.$route.params.path !== "/";
      }
      return false;
    },
  },

  methods: {
    navBack: function () {
      this.$router.back();
    },
  },

  data: () => ({
    //
  }),
});
</script>

<style lang="less">
html {
  overflow: hidden !important;
}
</style>
