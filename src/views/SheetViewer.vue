<template>
  <div ref="wrapper" class="canvasWrapper">
    <v-progress-circular
      v-if="pagesLoaded !== pageNumbers"
      :size="70"
      :width="7"
      class="loader"
      color="primary"
      indeterminate
    >
      {{
        Number.isInteger((100 / pageNumbers) * pagesLoaded)
          ? (100 / pageNumbers) * pagesLoaded
          : ((100 / pageNumbers) * pagesLoaded).toFixed(0)
      }}%
    </v-progress-circular>
    <div v-if="pagesLoaded !== pageNumbers" class="overlay"></div>
    <div class="canvasWrapper">
      <div v-for="pageNumber in pageNumbers" :key="pageNumber">
        <canvas
          v-if="pageNumber !== 1"
          :class="isPageVisible(pageNumber - 0.5) ? 'pageVisible' : ''"
          :data-page="pageNumber - 0.5"
          class="pageCanvas"
        />
        <canvas
          :class="isPageVisible(pageNumber) ? 'pageVisible' : ''"
          :data-page="pageNumber"
          class="pageCanvas"
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
  PDFLoadingTask,
  PDFRenderParams,
  ViewportParameters,
} from "pdfjs-dist/webpack";
import _ from "lodash";

@Component({})
export default class SheetViewer extends Vue {
  pageNumbers = 0;
  currentPage = 1;
  pagesLoaded = 0;
  debouncedResize?: any;
  pdfLoadingTask?: PDFLoadingTask<any>;
  private pdf?: PDFDocumentProxy;

  unmounted(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("click", this.onClick);
    window.addEventListener("resize", this.debouncedResize);
  }

  async mounted(): Promise<void> {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("click", this.onClick);
    this.debouncedResize = _.debounce(this.onResize, 200);
    window.addEventListener("resize", this.debouncedResize);
    this.currentPage = 1;
    this.pdfLoadingTask = pdfJs.getDocument({
      url: "local-resource://" + this.$route.params.path,
    });
    this.renderPdf();
  }

  async renderPdf(): Promise<void> {
    if (!this.pdfLoadingTask) {
      return;
    }
    this.pdf = await this.pdfLoadingTask.promise;
    this.pageNumbers = this.pdf?.numPages || 0;
    this.pagesLoaded = 0;

    setTimeout(() => {
      let $wrapper = this.$refs["wrapper"] as HTMLDivElement;
      for (let i = 1; i <= this.pageNumbers; i++) {
        let $canvas = $wrapper?.querySelector(
          'canvas[data-page="' + i + '"]'
        ) as HTMLCanvasElement;
        this.renderPage(i, $canvas, $wrapper).then(() => {
          this.pagesLoaded++;
        });
      }
    }, 0);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === "ArrowRight") {
      this.nextPage();
    }
    if (event.key === "ArrowLeft") {
      this.prevPage();
    }
  }

  onClick(event: MouseEvent): void {
    if (this.pagesLoaded !== this.pageNumbers) {
      return;
    }
    if (event.clientX > window.innerWidth / 2) {
      this.nextPage();
    } else {
      this.prevPage();
    }
  }

  onResize(): void {
    this.renderPdf();
  }

  nextPage(): void {
    this.currentPage < this.pageNumbers ? (this.currentPage += 0.5) : null;
  }

  prevPage(): void {
    this.currentPage > 1 ? (this.currentPage -= 0.5) : null;
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
  ): Promise<any> {
    if (!this.pdf) {
      return;
    }
    let scaling = window.devicePixelRatio;
    let page = await this.pdf.getPage(pageNumber);
    let scale1ViewPort = page.getViewport({
      scale: 1,
    } as ViewportParameters);

    let scale = $wrapper.clientHeight / scale1ViewPort.height;

    let windowViewport = page.getViewport({ scale } as ViewportParameters);

    if (windowViewport.width > $wrapper.clientWidth) {
      scale = $wrapper.clientWidth / scale1ViewPort.width;
      windowViewport = page.getViewport({ scale } as ViewportParameters);
    }
    let viewport = scale1ViewPort;

    // Prepare canvas using PDF page dimensions

    $canvas.height = viewport.height * scaling;
    $canvas.width = viewport.width * scaling;
    $canvas.style.height = windowViewport.height + "px";
    $canvas.style.width = windowViewport.width + "px";

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

      return new Promise((resolve) => {
        setTimeout(() => {
          let height = originalCanvas.height / scaling / 2;
          let width = originalCanvas.width / scaling;
          destCtx.scale(scaling, scaling);
          destCtx.clearRect(0, height, width, height);
          destCtx.fillStyle = "#000";
          destCtx.fillRect(0, height - 5, width, 10);
          resolve(null);
        }, 500);
      });
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
