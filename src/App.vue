<template>
  <v-app>
    <v-app-bar dense app color="primary" dark>
      <v-btn @click="navBack" icon v-if="showBackButton">
        <v-icon>mdi-arrow-left</v-icon>
      </v-btn>
      <div>Sheet music viewer : {{ appVersion }}</div>
      <v-spacer></v-spacer>
      <v-dialog
        v-model="dialog"
        persistent
        max-width="320"
        v-if="showSettingsButton"
      >
        <template v-slot:activator="{ on, attrs }">
          <v-btn icon dark v-bind="attrs" v-on="on">
            <v-icon>mdi-cog</v-icon>
          </v-btn>
        </template>
        <v-card>
          <v-card-title class="text-h5">Choose new root folder?</v-card-title>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn color="green darken-1" text @click="dialog = false">
              Disagree
            </v-btn>
            <v-btn color="green darken-1" text @click="navToSettings">
              Agree
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script lang="ts">
import Vue from "vue";
import { EventNames, RouteNames } from "@/Enums";

export default Vue.extend({
  name: "App",

  mounted() {
    window.ipcRenderer.on(EventNames.SEND_VERSION, (appVersion: string) => {
      this.appVersion = appVersion;
    });
    window.ipcRenderer.send(EventNames.GET_VERSION);
  },
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
        return this.$route.params.path !== window.path.sep;
      }
      return false;
    },
    showSettingsButton: function () {
      let currentRoute = this.$route.name;
      if (currentRoute === RouteNames.FolderSetup) {
        return false;
      }
      return true;
    },
  },

  methods: {
    navBack: function () {
      if (history.length === 1) {
        this.$router.push({ name: RouteNames.SheetSelection });
      } else {
        this.$router.go(-1);
      }
    },
    navToSettings: function () {
      this.dialog = false;
      this.$router.push({ name: RouteNames.FolderSetup });
    },
  },

  data: () => ({
    dialog: false,
    appVersion: (window as any).appVersion,
  }),
});
</script>

<style lang="less">
html {
  overflow: hidden !important;
}
</style>
