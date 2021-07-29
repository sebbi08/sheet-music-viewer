<template>
  <vue-pdf-app
    :pdf="'local-resource://' + this.$route.params.path"
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
