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
      <div v-for="pageNumber in pageNumbers" :key="pageNumber">
        <canvas
          v-if="pageNumber !== 1"
          class="pageCanvas"
          :class="isPageVisible(pageNumber - 0.5) ? 'pageVisible' : ''"
          :data-page="pageNumber - 0.5"
        />
        <canvas
          class="pageCanvas"
          :class="isPageVisible(pageNumber) ? 'pageVisible' : ''"
          :data-page="pageNumber"
        />
      </div>
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
        this.currentPage < this.pageNumbers ? (this.currentPage += 0.5) : null;
      }
      if (event.key === "ArrowLeft") {
        this.currentPage > 1 ? (this.currentPage -= 0.5) : null;
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
        let $wrapper = this.$refs["wrapper"] as HTMLDivElement;
        let $canvas = $wrapper?.querySelector(
          'canvas[data-page="' + i + '"]'
        ) as HTMLCanvasElement;
        this.renderPage(i, $canvas, $wrapper).then(() => {
          this.pagesLoaded++;
        });
      }
    }, 0);
  }

  isPageVisible(page: number): boolean {
    if (Number.isInteger(this.currentPage)) {
      return page === this.currentPage;
    }
    if (page === this.currentPage) {
      return true;
    }
    if (page + 0.5 === this.currentPage) {
      return true;
    }
    return false;
  }

  async renderPage(
    pageNumber: number,
    $canvas: HTMLCanvasElement,
    $wrapper: HTMLDivElement
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

    $canvas.height = viewport.height * scaling;
    $canvas.width = viewport.width * scaling;
    $canvas.style.height = viewport.height + "px";
    $canvas.style.width = viewport.width + "px";

    // Render PDF page into canvas context
    const canvasContext = $canvas.getContext("2d");
    canvasContext?.scale(scaling, scaling);
    const renderContext = {
      canvasContext,
      viewport,
      background: "#ffffff",
    } as PDFRenderParams;

    await page.render(renderContext).promise.then(() => {
      if (pageNumber === 1) {
        return;
      }
      let originalCanvas = $wrapper?.querySelector(
        'canvas[data-page="' + pageNumber + '"]'
      ) as HTMLCanvasElement;
      let copyCanvas = $wrapper?.querySelector(
        'canvas[data-page="' + (pageNumber - 0.5) + '"]'
      ) as HTMLCanvasElement;
      copyCanvas.height = originalCanvas.height;
      copyCanvas.width = originalCanvas.width;
      copyCanvas.style.height = originalCanvas.style.height;
      copyCanvas.style.width = originalCanvas.style.width;

      let destCtx = copyCanvas.getContext("2d") as CanvasRenderingContext2D;
      destCtx.drawImage(originalCanvas, 0, 0);
      setTimeout(() => {
        let height = parseFloat(originalCanvas.style.height) / 2;
        let width = parseFloat(originalCanvas.style.width);
        destCtx.scale(scaling, scaling);
        destCtx.clearRect(0, height, width, height);
        destCtx.fillStyle = "#000";
        destCtx.fillRect(0, height - 25, width, 50);
      }, 500);
    });
  }
}
</script>

<style lang="less" scoped>
.loader {
  z-index: 99;
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
  z-index: 98;
  opacity: 0.9;
}

.canvasWrapper {
  height: 100%;
  position: relative;
  background: black;
}

.pageCanvas {
  &.pageVisible {
    display: block;
  }

  background: transparent;
  position: absolute;
  transform: translateX(-50%);
  left: 50%;
  right: 0;
  top: 0;
  bottom: 0;
  display: none;
}
</style>
