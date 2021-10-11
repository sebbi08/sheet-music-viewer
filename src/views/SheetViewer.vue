<template>
  <div class="canvasWrapper">
    <v-progress-circular
      :size="70"
      :width="7"
      indeterminate
      color="primary"
      class="loader"
      v-if="pagesLoaded !== pageNumbers"
      >{{ (100 / pageNumbers) * pagesLoaded }}%
    </v-progress-circular>
    <div class="overlay" v-if="pagesLoaded !== pageNumbers"></div>
    <div class="canvasWrapper" ref="wrapper">
      <canvas
        v-for="pageNumber in pageNumbers"
        :key="pageNumber"
        class="pageCanvas"
        :class="pageNumber === currentPage ? 'pageVisible' : ''"
        :data-page="pageNumber"
      ></canvas>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import * as pdfJs from "pdfjs-dist/webpack";
import {
  PDFDocumentProxy,
  PDFRenderParams,
  ViewportParameters,
} from "pdfjs-dist/webpack";

@Component({})
export default class SheetViewer extends Vue {
  private pdf?: PDFDocumentProxy;
  pageNumbers = 0;
  currentPage = 1;
  pagesLoaded = 0;

  async mounted(): Promise<void> {
    window.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        this.currentPage < this.pageNumbers ? this.currentPage++ : null;
      }
      if (event.key === "ArrowLeft") {
        this.currentPage > 1 ? this.currentPage-- : null;
      }
    });
    this.currentPage = 1;
    let pdfLoadingTask = pdfJs.getDocument({
      url: "local-resource://" + this.$route.params.path,
    });

    this.pdf = await pdfLoadingTask.promise;
    this.pageNumbers = this.pdf.numPages;

    setTimeout(() => {
      for (let i = 1; i <= this.pageNumbers; i++) {
        this.renderPage(
          i,
          (this.$refs["wrapper"] as HTMLDivElement).children[
            i - 1
          ] as HTMLCanvasElement
        ).then(() => {
          this.pagesLoaded++;
        });
      }
    }, 0);
  }

  async renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement
  ): Promise<void> {
    if (!this.pdf) {
      return;
    }
    let scaling = 0.75;
    let page = await this.pdf.getPage(pageNumber);
    let scale1ViewPort = page.getViewport({
      scale: 1,
    } as ViewportParameters);
    let wrapper = this.$refs.wrapper as HTMLDivElement;
    let scale: number;
    if (scale1ViewPort.height > scale1ViewPort.width) {
      scale = wrapper.clientHeight / scale1ViewPort.height;
    } else {
      scale = wrapper.clientWidth / scale1ViewPort.width;
    }
    const viewport = page.getViewport({ scale } as ViewportParameters);

    // Prepare canvas using PDF page dimensions

    canvas.height = viewport.height * scaling;
    canvas.width = viewport.width * scaling;
    canvas.style.height = viewport.height + "px";
    canvas.style.width = viewport.width + "px";

    // Render PDF page into canvas context
    const canvasContext = canvas.getContext("2d");
    canvasContext?.scale(scaling, scaling);
    const renderContext = {
      canvasContext,
      viewport,
      background: "#ffffff",
    } as PDFRenderParams;

    await page
      .render(renderContext)
      .promise.then(() => console.log("Page rendered"));
  }
}
</script>

<style lang="less" scoped>
.loader {
  z-index: 2;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translateX(-50%) translateY(-50%);
}

.overlay {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: white;
  z-index: 1;
  opacity: 0.9;
}

.canvasWrapper {
  height: 100%;
  position: relative;
}

.pageCanvas {
  &.pageVisible {
    display: block;
  }

  position: absolute;
  transform: translateX(-50%);
  left: 50%;
  right: 0;
  top: 0;
  bottom: 0;
  display: none;
}
</style>
