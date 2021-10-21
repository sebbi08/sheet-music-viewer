<template>
  <div id="sheetViewerWrapper" class="canvasWrapper">
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
      <div
        class="pageWrapper"
        v-for="pageNumber in pageNumbers"
        :key="pageNumber"
      >
        <canvas
          v-if="pageNumber !== 1"
          :class="isPageVisible(pageNumber - 0.5) ? 'pageVisible' : ''"
          :data-page="pageNumber - 0.5"
          class="pageCanvas"
        />
        <canvas
          v-if="pageNumber !== 1"
          :class="isPageVisible(pageNumber - 0.5) ? 'pageVisible' : ''"
          :data-page-overlay="pageNumber - 0.5"
          class="pageCanvas overlayCanvas"
        />
        <canvas
          :class="isPageVisible(pageNumber) ? 'pageVisible' : ''"
          :data-page="pageNumber"
          class="pageCanvas"
        />
        <canvas
          :class="isPageVisible(pageNumber) ? 'pageVisible' : ''"
          :data-page-overlay="pageNumber"
          class="pageCanvas overlayCanvas"
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
import { Watch } from "vue-property-decorator";
import { mapFields } from "vuex-map-fields";
import { fabric } from "fabric";
import { OverlayData } from "@/models/OverlayData";

@Component({
  computed: {
    ...mapFields(["editMode"]),
  },
})
export default class SheetViewer extends Vue {
  pageNumbers = 0;
  currentPage = 1;
  pagesLoaded = 0;
  debouncedResize?: any;
  pdfLoadingTask?: PDFLoadingTask<any>;
  private pdf?: PDFDocumentProxy;
  editFabric?: fabric.Canvas;
  sheetViewerWrapperId = "sheetViewerWrapper";
  editCanvasId = "";
  overlayJsons: OverlayData[] = [];

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
    await this.renderPdf();
  }

  @Watch("editMode", { immediate: true })
  onEditChange(editMode: boolean): void {
    if (editMode) {
      if (!Number.isInteger(this.currentPage)) {
        this.currentPage += 0.5;
      }
      this.clearOverlayCanvas();
      this.createFabricCanvas();
    } else if (this.editFabric) {
      this.saveDrawnData();
      this.populateOverlayCanvas();
      this.removeFabricCanvas();
    }
  }

  saveDrawnData(): void {
    let fabricJson = this.editFabric?.toJSON();
    let fabricDataUrl = this.editFabric?.toDataURL();

    let currentPageData = this.overlayJsons.find((a: OverlayData): boolean => {
      return a.page === this.currentPage;
    });
    if (currentPageData) {
      currentPageData.data = fabricJson;
      currentPageData.dataUrl = fabricDataUrl;
    } else {
      this.overlayJsons.push({
        page: this.currentPage,
        data: fabricJson,
        dataUrl: fabricDataUrl,
      });
    }
  }

  createFabricCanvas(): void {
    let sheetViewerWrapper = document.getElementById(this.sheetViewerWrapperId);

    let currentPageCanvas =
      sheetViewerWrapper?.querySelector<HTMLCanvasElement>(
        `canvas[data-page="${this.currentPage}"]`
      );

    let editCanvas = document.createElement("canvas") as HTMLCanvasElement;
    editCanvas.className = this.editCanvasId;

    editCanvas.height = parseFloat(currentPageCanvas?.style.height || "") || 0;
    editCanvas.width = parseFloat(currentPageCanvas?.style.width || "") || 0;
    editCanvas.style.height = currentPageCanvas?.style.height || "";
    editCanvas.style.width = currentPageCanvas?.style.width || "";

    let canvasWrapper = document.querySelector<HTMLDivElement>(
      `#${this.sheetViewerWrapperId} > .canvasWrapper`
    );
    canvasWrapper?.appendChild(editCanvas);
    this.editFabric = new fabric.Canvas(editCanvas, {
      isDrawingMode: true,
    });

    let currentPageData = this.overlayJsons.find((a: OverlayData): boolean => {
      return a.page === this.currentPage;
    });
    if (!currentPageData) {
      return;
    }

    this.editFabric.loadFromJSON(currentPageData.data, () => {
      console.log("fabricLoaded");
    });
  }

  removeFabricCanvas(): void {
    this.editFabric?.dispose();

    let sheetViewerWrapper = document.getElementById(this.sheetViewerWrapperId);
    sheetViewerWrapper?.querySelector(".canvasWrapper > canvas")?.remove();
  }

  clearOverlayCanvas(): void {
    let $wrapper = document.getElementById(
      "sheetViewerWrapper"
    ) as HTMLDivElement;
    for (let i = 0; i < this.overlayJsons.length; i++) {
      let overlayJsonData = this.overlayJsons[i];
      if (!overlayJsonData) continue;
      let pageNumber = overlayJsonData.page;

      let overlayCanvas = $wrapper?.querySelector(
        'canvas[data-page-overlay="' + pageNumber + '"]'
      ) as HTMLCanvasElement;
      let overlayContext = overlayCanvas.getContext(
        "2d"
      ) as CanvasRenderingContext2D;
      overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
  }

  populateOverlayCanvas(): void {
    this.clearOverlayCanvas();
    let $wrapper = document.getElementById(
      "sheetViewerWrapper"
    ) as HTMLDivElement;
    for (let i = 0; i < this.overlayJsons.length; i++) {
      let overlayJsonData = this.overlayJsons[i];
      if (!overlayJsonData) continue;
      let pageNumber = overlayJsonData.page;

      let overlayCanvas = $wrapper?.querySelector(
        'canvas[data-page-overlay="' + pageNumber + '"]'
      ) as HTMLCanvasElement;
      let img = new Image();
      img.src = overlayJsonData.dataUrl || "";
      img.onload = function () {
        let overlayContext = overlayCanvas.getContext(
          "2d"
        ) as CanvasRenderingContext2D;
        overlayContext.drawImage(img, 0, 0);
      };
    }
  }

  async renderPdf(): Promise<void> {
    if (!this.pdfLoadingTask) {
      return;
    }
    this.pdf = await this.pdfLoadingTask.promise;
    this.pageNumbers = this.pdf?.numPages || 0;
    this.pagesLoaded = 0;

    setTimeout(() => {
      let $wrapper = document.getElementById(
        "sheetViewerWrapper"
      ) as HTMLDivElement;
      let renderingPromises = [];
      for (let i = 1; i <= this.pageNumbers; i++) {
        let $canvas = $wrapper?.querySelector(
          'canvas[data-page="' + i + '"]'
        ) as HTMLCanvasElement;
        renderingPromises.push(
          this.renderPage(i, $canvas, $wrapper).then(() => {
            this.pagesLoaded++;
          })
        );
      }
      Promise.all(renderingPromises).then(this.populateOverlayCanvas);
    }, 0);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (this.$store.getters.getField("editMode")) {
      return;
    }
    if (event.key === "ArrowRight") {
      this.nextPage();
    }
    if (event.key === "ArrowLeft") {
      this.prevPage();
    }
  }

  onClick(event: MouseEvent): void {
    if (!event.target) {
      return;
    }
    let sheetViewerWrapper = document.getElementById("sheetViewerWrapper");
    if (!sheetViewerWrapper) {
      return;
    }
    if (!sheetViewerWrapper.contains(event.target as HTMLElement)) {
      return;
    }
    if (this.$store.getters.getField("editMode")) {
      return;
    }
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
      return this.copyPageToHalfPage(pageNumber, $canvas, $wrapper, scaling);
    });
  }

  copyPageToHalfPage(
    pageNumber: number,
    $canvas: HTMLCanvasElement,
    $wrapper: HTMLDivElement,
    scaling: number
  ): Promise<number> {
    let originalCanvas = $wrapper?.querySelector(
      'canvas[data-page="' + pageNumber + '"]'
    ) as HTMLCanvasElement;
    let overlayCanvas = $wrapper?.querySelector(
      'canvas[data-page-overlay="' + pageNumber + '"]'
    ) as HTMLCanvasElement;
    overlayCanvas.height = parseFloat(originalCanvas.style.height);
    overlayCanvas.width = parseFloat(originalCanvas.style.width);
    overlayCanvas.style.height = originalCanvas.style.height;
    overlayCanvas.style.width = originalCanvas.style.width;
    if (pageNumber === 1) {
      return Promise.resolve(pageNumber);
    }
    let halfPageCanvas = $wrapper?.querySelector(
      'canvas[data-page="' + (pageNumber - 0.5) + '"]'
    ) as HTMLCanvasElement;
    halfPageCanvas.height = originalCanvas.height;
    halfPageCanvas.width = originalCanvas.width;
    halfPageCanvas.style.height = originalCanvas.style.height;
    halfPageCanvas.style.width = originalCanvas.style.width;

    let overlayHalfPageCanvas = $wrapper?.querySelector(
      'canvas[data-page-overlay="' + (pageNumber - 0.5) + '"]'
    ) as HTMLCanvasElement;

    overlayHalfPageCanvas.height = parseFloat(originalCanvas.style.height);
    overlayHalfPageCanvas.width = parseFloat(originalCanvas.style.width);
    overlayHalfPageCanvas.style.height = originalCanvas.style.height;
    overlayHalfPageCanvas.style.width = originalCanvas.style.width;

    let destCtx = halfPageCanvas.getContext("2d") as CanvasRenderingContext2D;
    destCtx.drawImage(originalCanvas, 0, 0);

    return new Promise((resolve) => {
      setTimeout(() => {
        let height = originalCanvas.height / scaling / 2;
        let width = originalCanvas.width / scaling;
        destCtx.scale(scaling, scaling);
        destCtx.clearRect(0, height, width, height);
        destCtx.fillStyle = "#000";
        destCtx.fillRect(0, height - 5, width, 10);
        resolve(pageNumber);
      }, 500);
    });
  }
}
</script>

<style lang="less">
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

.canvas-container {
  left: 50%;
  transform: translateX(-50%);
}
</style>
