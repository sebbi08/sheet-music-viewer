<template>
  <vue-pdf-app
    pdf="local-resource:///Users/sebastian.mahr/Downloads/Bob-Omb Battlefield 8BBB/Bob-Omb Battlefield 8BBB - Trombone 3.pdf"
  ></vue-pdf-app>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import VuePdfApp from "vue-pdf-app";
import "vue-pdf-app/dist/icons/main.css";

@Component({
  components: {
    VuePdfApp,
  },
})
export default class SheetViewer extends Vue {}
</script>

<style scoped></style>
