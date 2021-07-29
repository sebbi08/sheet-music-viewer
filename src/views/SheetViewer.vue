<template>
  <my-vue-pdf-component
    page-scale="page-fit"
    :pdf="'local-resource://' + this.$route.params.path"
    :config="pdfConfig"
  ></my-vue-pdf-component>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import "vue-pdf-app/dist/icons/main.css";
import MyVuePdfComponent from "@/components/my-vue-pdf-component.vue";

@Component({
  components: {
    MyVuePdfComponent,
  },
})
export default class SheetViewer extends Vue {
  public pdfConfig = {
    sidebar: {
      viewThumbnail: true,
      viewOutline: true,
      viewAttachments: true,
    },
    secondaryToolbar: {
      secondaryPresentationMode: true,
      secondaryOpenFile: true,
      secondaryPrint: true,
      secondaryDownload: true,
      secondaryViewBookmark: true,
      firstPage: true,
      lastPage: true,
      pageRotateCw: true,
      pageRotateCcw: true,
      cursorSelectTool: true,
      cursorHandTool: true,
      scrollVertical: true,
      scrollHorizontal: true,
      scrollWrapped: true,
      spreadNone: true,
      spreadOdd: true,
      spreadEven: true,
      documentProperties: true,
    },
    toolbar: {
      toolbarViewerLeft: {
        findbar: true,
        previous: true,
        next: true,
        pageNumber: true,
      },
      toolbarViewerRight: {
        presentationMode: true,
        openFile: true,
        print: true,
        download: true,
        viewBookmark: true,
      },
      toolbarViewerMiddle: {
        zoomOut: true,
        zoom: true,
        scaleSelectContainer: true,
      },
    },
    errorWrapper: true,
  };
}
</script>

<style scoped></style>
