<template>
  <my-vue-pdf-component
    page-scale="page-fit"
    :pdf="'local-resource://' + this.$route.params.path"
    :config="pdfConfig"
    @pages-rendered="pageRendered"
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
    secondaryToolbar: {
      secondaryPresentationMode: false,
      secondaryOpenFile: false,
      secondaryPrint: false,
      secondaryDownload: false,
      secondaryViewBookmark: false,
      firstPage: false,
      lastPage: false,
      pageRotateCw: true,
      pageRotateCcw: true,
      cursorSelectTool: false,
      cursorHandTool: false,
      scrollVertical: false,
      scrollHorizontal: false,
      scrollWrapped: false,
      spreadNone: false,
      spreadOdd: false,
      spreadEven: false,
      documentProperties: false,
    },
    sidebar: false,
    toolbar: {
      sidebar: false,
      toolbarViewerLeft: false,
      toolbarViewerRight: {
        presentationMode: false,
        openFile: false,
        print: false,
        download: false,
        viewBookmark: false,
      },
      toolbarViewerMiddle: {
        zoomOut: true,
        zoom: true,
        scaleSelectContainer: true,
      },
    },
    errorWrapper: true,
  };

  public pageRendered(): void {
    setTimeout(() => {
      let allPages = document.querySelectorAll(".page[data-loaded='true']");
    });
  }
}
</script>

<style scoped></style>
