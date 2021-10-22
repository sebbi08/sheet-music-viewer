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

    <v-speed-dial
      absolute
      v-if="editMode"
      v-model="editFab"
      bottom
      right
      direction="left"
      transition="slide-x-reverse-transition"
    >
      <template v-slot:activator>
        <v-btn v-model="editFab" color="blue darken-2" dark fab>
          <v-icon v-if="editFab"> mdi-close</v-icon>
          <v-icon v-else-if="interactiveMode">
            mdi-hand-back-right-outline
          </v-icon>
          <v-icon v-else-if="drawingMode"> mdi-pencil</v-icon>
        </v-btn>
      </template>
      <v-btn @click="startDrawingMode" fab dark small color="green">
        <v-icon>mdi-pencil</v-icon>
      </v-btn>
      <v-btn @click="startInteractiveMode" fab dark small color="green">
        <v-icon>mdi-hand-back-right-outline</v-icon>
      </v-btn>
    </v-speed-dial>
    <v-btn
      class="deletion-fab"
      v-if="currentSelection.length > 0"
      color="red darken-2"
      @click="deleteCurrentSelection"
      dark
      fab
    >
      <v-icon>mdi-delete</v-icon>
    </v-btn>
    <v-speed-dial
      class="deletion-fab"
      absolute
      v-if="drawingMode"
      v-model="drawingFab"
      bottom
      right
      direction="left"
      transition="slide-x-reverse-transition"
    >
      <template v-slot:activator>
        <v-btn v-model="drawingFab" color="blue darken-2" dark fab>
          <v-icon>mdi-gesture</v-icon>
        </v-btn>
      </template>
      <v-btn fab dark small color="green">
        <v-icon>mdi-marker</v-icon>
      </v-btn>
      <v-btn fab dark small color="green">
        <v-icon>mdi-pencil</v-icon>
      </v-btn>
    </v-speed-dial>
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
import { EventNames } from "@/Enums";

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
  overlayData: OverlayData[] = [];
  editFab = false;
  drawingFab = false;
  interactiveMode = false;
  drawingMode = false;
  currentSelection: any[] = [];

  unmounted(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("click", this.onClick);
    window.addEventListener("resize", this.debouncedResize);
  }

  async mounted(): Promise<void> {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("click", this.onClick);
    this.debouncedResize = _.debounce(this.onResize, 500);
    window.addEventListener("resize", this.debouncedResize);

    window.ipcRenderer.send(EventNames.START_LOAD_OVERLAY_DATA, {
      path: this.$route.params.path,
    });

    await new Promise((resolve) => {
      window.ipcRenderer.on(
        EventNames.LOAD_OVERLAY_DATA,
        (event, overlayData: string): void => {
          if (!overlayData) {
            this.overlayData = [];
            resolve(undefined);
            return;
          }
          this.overlayData = JSON.parse(overlayData);
          resolve(undefined);
        }
      );
    });

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

  startDrawingMode(): void {
    if (!this.editFabric) {
      return;
    }
    this.interactiveMode = false;
    this.drawingMode = true;

    this.editFabric.isDrawingMode = true;
  }

  startInteractiveMode(): void {
    if (!this.editFabric) {
      return;
    }
    this.interactiveMode = true;
    this.drawingMode = false;
    this.editFabric.isDrawingMode = false;
  }

  deleteCurrentSelection(): void {
    if (!this.editFabric) {
      return;
    }
    this.editFabric.remove(...this.currentSelection);
    this.currentSelection = [];
    this.editFabric.selection = false;
    this.editFabric.selection = true;
    this.editFabric.interactive = false;
    this.editFabric.interactive = true;
  }

  saveDrawnData(): void {
    if (!this.editFabric) return;
    let fabricJson = this.editFabric.toJSON();
    let fabricDataUrl = this.editFabric.toSVG();

    let currentPageData = this.overlayData.find((a: OverlayData): boolean => {
      return a.page === this.currentPage;
    });
    let width = this.editFabric.width || 0;
    let height = this.editFabric.height || 0;
    if (currentPageData) {
      currentPageData.data = fabricJson;
      currentPageData.dataUrl = fabricDataUrl;
      currentPageData.drawWidth = width;
      currentPageData.drawHeight = height;
    } else {
      this.overlayData.push({
        page: this.currentPage,
        data: fabricJson,
        dataUrl: fabricDataUrl,
        drawWidth: width,
        drawHeight: height,
      });
    }
    window.ipcRenderer.send(EventNames.SAVE_OVERLAY_DATA, {
      data: JSON.stringify(this.overlayData),
      path: this.$route.params.path,
    });
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

    let currentPageData = this.overlayData.find((a: OverlayData): boolean => {
      return a.page === this.currentPage;
    });

    this.editFabric = new fabric.Canvas(editCanvas, {
      isDrawingMode: false,
    });
    this.drawingMode = false;
    this.interactiveMode = true;
    this.editFabric.on("selection:created", (event: any) => {
      this.currentSelection = event.selected;
    });
    this.editFabric.on("selection:updated", (event: any) => {
      this.currentSelection = event.selected;
    });
    this.editFabric.on("selection:cleared", () => {
      this.currentSelection = [];
    });

    if (!currentPageData) return;

    this.editFabric.loadFromJSON(currentPageData.data, () => {
      console.log("fabricLoaded");
    });
  }

  removeFabricCanvas(): void {
    this.drawingMode = false;
    this.interactiveMode = false;
    this.editFabric?.dispose();

    let sheetViewerWrapper = document.getElementById(this.sheetViewerWrapperId);
    sheetViewerWrapper?.querySelector(".canvasWrapper > canvas")?.remove();
  }

  clearOverlayCanvas(): void {
    let $wrapper = document.getElementById(
      "sheetViewerWrapper"
    ) as HTMLDivElement;
    for (let i = 0; i < this.overlayData.length; i++) {
      let overlayJsonData = this.overlayData[i];
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
    for (let i = 0; i < this.overlayData.length; i++) {
      let overlayJsonData = this.overlayData[i];
      if (!overlayJsonData) continue;
      let pageNumber = overlayJsonData.page;

      let overlayCanvas = $wrapper?.querySelector(
        'canvas[data-page-overlay="' + pageNumber + '"]'
      ) as HTMLCanvasElement;
      let img = new Image();
      let svg64 = window.btoa(overlayJsonData.dataUrl || "");
      let b64Start = "data:image/svg+xml;base64,";
      img.src = b64Start + svg64;

      let overlayContext = overlayCanvas.getContext(
        "2d"
      ) as CanvasRenderingContext2D;
      let heightScale = overlayCanvas.height / overlayJsonData.drawHeight;
      let widthScale = overlayCanvas.width / overlayJsonData.drawWidth;
      overlayContext.setTransform(1, 0, 0, 1, 0, 0);
      overlayContext.scale(heightScale, widthScale);

      img.onload = () => {
        overlayContext.drawImage(img, 0, 0);
        overlayContext.setTransform(1, 0, 0, 1, 0, 0);
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
    halfPageCanvas.getContext("2d")?.scale(scaling, scaling);

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

.deletion-fab {
  position: absolute;
  right: 16px;
  bottom: 88px !important;
}
</style>
