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
        v-for="pageNumber in pageNumbers"
        :key="pageNumber"
        class="pageWrapper"
      >
        <div
          v-if="pageNumber !== 1"
          :class="isPageVisible(pageNumber - 0.5) ? 'pageVisible' : ''"
          :data-page-backdrop="pageNumber - 0.5"
          class="pageCanvas pageBackdrop"
          v-bind:style="{ zIndex: (pageNumber - 0.5) * 2 }"
        ></div>
        <canvas
          v-if="pageNumber !== 1"
          :class="isPageVisible(pageNumber - 0.5) ? 'pageVisible' : ''"
          :data-page="pageNumber - 0.5"
          class="pageCanvas"
          v-bind:style="{ zIndex: (pageNumber - 0.5) * 2 }"
        />
        <canvas
          :class="isPageVisible(pageNumber) ? 'pageVisible' : ''"
          :data-page="pageNumber"
          class="pageCanvas"
          v-bind:style="{ zIndex: pageNumber * 2 }"
        />
      </div>
    </div>

    <!--  Mode Selection  -->
    <v-speed-dial
      v-if="editMode"
      v-model="editFab"
      absolute
      bottom
      direction="left"
      right
      transition="slide-x-reverse-transition"
    >
      <template v-slot:activator>
        <v-btn v-model="editFab" color="blue darken-2" dark fab>
          <v-icon v-if="editFab"> mdi-close</v-icon>
          <v-icon v-else-if="editState.interactiveMode">
            mdi-hand-back-right-outline
          </v-icon>
          <v-icon v-else-if="editState.drawingMode"> mdi-pencil</v-icon>
        </v-btn>
      </template>
      <v-btn color="green" dark fab small @click="startDrawingMode">
        <v-icon>mdi-pencil</v-icon>
      </v-btn>
      <v-btn color="green" dark fab small @click="startInteractiveMode">
        <v-icon>mdi-hand-back-right-outline</v-icon>
      </v-btn>
    </v-speed-dial>

    <!--  Add Item Selection  -->
    <v-speed-dial
      v-if="editState.interactiveMode"
      v-model="objectFab"
      absolute
      bottom
      class="first-level-fab"
      direction="left"
      right
      transition="slide-x-reverse-transition"
    >
      <template v-slot:activator>
        <v-btn v-model="drawingFab" color="green darken-1" dark fab>
          <v-icon>mdi-plus</v-icon>
        </v-btn>
      </template>
      <v-btn color="green" dark fab small @click="addSquare">
        <v-icon>mdi-square</v-icon>
      </v-btn>
      <v-btn color="green" dark fab small @click="addBlackSquare">
        <v-icon color="black">mdi-square</v-icon>
      </v-btn>
      <v-btn color="green" dark fab small @click="openMusicIconPopover">
        <v-icon>mdi-music</v-icon>
      </v-btn>
      <v-btn color="green" dark fab small @click="addTextToCanvas">
        <v-icon>mdi-format-text</v-icon>
      </v-btn>
    </v-speed-dial>
    <!--  Drawing Mode Selection  -->
    <v-speed-dial
      v-if="editState.drawingMode"
      v-model="drawingFab"
      absolute
      bottom
      class="first-level-fab"
      direction="left"
      right
      transition="slide-x-reverse-transition"
    >
      <template v-slot:activator>
        <v-btn v-model="drawingFab" color="green darken-1" dark fab>
          <v-icon v-if="editState.pencilMode">mdi-pencil</v-icon>
          <v-icon v-else>mdi-marker</v-icon>
        </v-btn>
      </template>
      <v-btn color="green" dark fab small @click="setMarkerMode">
        <v-icon>mdi-marker</v-icon>
      </v-btn>
      <v-btn color="green" dark fab small @click="setPencilMode">
        <v-icon>mdi-pencil</v-icon>
      </v-btn>
    </v-speed-dial>

    <!--  Color Selection  -->
    <v-speed-dial
      v-if="editState.drawingMode"
      v-model="colorFab"
      absolute
      bottom
      class="second-level-fab"
      direction="left"
      right
      transition="slide-x-reverse-transition"
    >
      <template v-slot:activator>
        <v-btn v-model="colorFab" color="white" dark fab>
          <v-icon :class="getCurrentBrushClass()">mdi-square-rounded</v-icon>
        </v-btn>
      </template>
      <v-btn color="white" dark fab small @click="setRedColor">
        <v-icon class="square-red">mdi-square-rounded</v-icon>
      </v-btn>
      <v-btn color="white" dark fab small @click="setGreenColor">
        <v-icon class="square-green">mdi-square-rounded</v-icon>
      </v-btn>
      <v-btn color="white" dark fab small @click="setBlueColor">
        <v-icon class="square-blue">mdi-square-rounded</v-icon>
      </v-btn>
      <v-btn color="white" dark fab small @click="setBlackColor">
        <v-icon class="square-black">mdi-square-rounded</v-icon>
      </v-btn>
    </v-speed-dial>

    <v-dialog v-model="musicSymbolDialog" max-width="466px">
      <v-card>
        <v-card-title>
          <span>Add Symbol</span>
        </v-card-title>
        <div class="music-icons-wrapper">
          <div
            v-for="icon in allMusicIcons"
            v-bind:key="icon.name"
            :class="'icon-' + icon.name"
            :data-icon-code="icon.code"
            class="music-icon"
            @click="addMusicIcon(icon)"
          />

          <img
            v-for="icon in allMusicSVGs"
            v-bind:key="icon.name"
            class="music-icon"
            v-bind:src="getImgUrl(icon.file)"
            @click="addMusicSvg(icon)"
          />
        </div>
        <v-card-actions>
          <v-btn color="primary" text @click="musicSymbolDialog = false"
            >Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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
import {
  BRUSH_COLORS,
  EventNames,
  Icon,
  MUSIC_ICONS,
  MUSIC_SVG,
  Svg,
} from "@/Enums";
import { EditState } from "@/models/EditState";
import { enhanceFabricPrototype } from "@/utils";

@Component({
  computed: {
    ...mapFields(["editMode"]),
  },
})
export default class SheetViewer extends Vue {
  allMusicIcons = MUSIC_ICONS.ALL_ICONS;
  allMusicSVGs = MUSIC_SVG.ALL_SGVS;
  pageNumbers = 0;
  currentPage = 1;
  pagesLoaded = 0;
  debouncedResize?: any;
  pdfLoadingTask?: PDFLoadingTask<any>;
  editFabric?: fabric.Canvas;
  sheetViewerWrapperId = "sheetViewerWrapper";
  editCanvasId = "";
  overlayData: OverlayData[] = [];
  editFab = false;
  drawingFab = false;
  colorFab = false;
  objectFab = false;
  musicSymbolDialog = false;
  overlayFabrics: fabric.StaticCanvas[] = [];
  editState: EditState = {
    thickness: 0,
    drawingMode: false,
    interactiveMode: false,
    color: { r: 0, g: 0, b: 0 },
    pencilMode: false,
  };
  currentSelection: any[] = [];
  private pdf?: PDFDocumentProxy;

  getImgUrl(icon: string): string {
    let images = require.context("../assets/", false, /\.svg$/);
    return images("./" + icon);
  }

  beforeDestroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("click", this.onClick);
    window.removeEventListener("resize", this.debouncedResize);
  }

  async mounted(): Promise<void> {
    enhanceFabricPrototype();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("click", this.onClick);
    this.debouncedResize = _.debounce(this.onResize, 500);
    window.addEventListener("resize", this.debouncedResize);

    await new Promise((resolve) => {
      window.ipcRenderer.once(
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
      window.ipcRenderer.send(EventNames.START_LOAD_OVERLAY_DATA, {
        path: this.$route.params.path,
      });
    });

    this.currentPage = 1;
    this.pdfLoadingTask = pdfJs.getDocument({
      url: "local-resource://" + this.$route.params.path,
    });
    await this.renderPdf();
  }

  setGreenColor(): void {
    this.setEditMode({
      color: BRUSH_COLORS.GREEN.getColor(),
    });
  }

  setRedColor(): void {
    this.setEditMode({
      color: BRUSH_COLORS.RED.getColor(),
    });
  }

  setBlueColor(): void {
    this.setEditMode({
      color: BRUSH_COLORS.BLUE.getColor(),
    });
  }

  setBlackColor(): void {
    this.setEditMode({
      color: BRUSH_COLORS.BLACK.getColor(),
    });
  }

  setMarkerMode(): void {
    this.setEditMode({
      pencilMode: false,
      thickness: 20,
      color: BRUSH_COLORS.RED.getColor(),
    });
  }

  setPencilMode(): void {
    this.setEditMode({
      pencilMode: true,
      thickness: 2,
      color: BRUSH_COLORS.BLACK.getColor(),
    });
  }

  getCurrentBrushClass(): string {
    if (!this.editState.color) return "";
    if (BRUSH_COLORS.RED.equals(this.editState.color)) {
      return "square-red";
    }
    if (BRUSH_COLORS.BLUE.equals(this.editState.color)) {
      return "square-blue";
    }
    if (BRUSH_COLORS.GREEN.equals(this.editState.color)) {
      return "square-green";
    }
    if (BRUSH_COLORS.BLACK.equals(this.editState.color)) {
      return "square-black";
    }
    return "";
  }

  addSquare(): void {
    if (!this.editFabric) {
      return;
    }

    let rect = new fabric.Rect({
      fill: "rgba(255,0,0,0.25)",
      width: 50,
      height: 50,
      left: (this.editFabric.width || 0) / 2,
      top: (this.editFabric.height || 0) / 2,
    });
    this.editFabric.add(rect);
    this.editFabric.setActiveObject(rect);
  }

  addBlackSquare(): void {
    if (!this.editFabric) {
      return;
    }

    let rect = new fabric.Rect({
      fill: "rgba(0,0,0,1)",
      width: 50,
      height: 50,
      left: (this.editFabric.width || 0) / 2,
      top: (this.editFabric.height || 0) / 2,
    });
    this.editFabric.add(rect);
    this.editFabric.setActiveObject(rect);
  }

  addTextToCanvas(): void {
    if (!this.editFabric) {
      return;
    }

    let textbox = new fabric.Textbox("edit here", {
      width: 100,
      height: 20,
      fontSize: 16,
      selectable: true,
    });
    this.editFabric.add(textbox);

    textbox.set({
      left: (this.editFabric?.width || 0) / 2,
      top: (this.editFabric?.height || 0) / 2,
    });
    this.editFabric.setActiveObject(textbox);
  }

  addMusicIcon(icon: Icon): void {
    if (!this.editFabric) return;

    let iconObject = new fabric.Text(icon.code, {
      fill: "black",
      fontSize: 1,
      fontFamily: "noto-icons",
      selectable: true,
      scaleX: 50,
      scaleY: 50,
    });

    this.editFabric?.add(iconObject);
    iconObject.set({
      left: (this.editFabric?.width || 0) / 2,
      top: (this.editFabric?.height || 0) / 2,
    });
    this.editFabric.setActiveObject(iconObject);

    this.musicSymbolDialog = false;
  }

  addMusicSvg(svg: Svg): void {
    if (!this.editFabric) return;
    let group: any[] = [];

    fabric.loadSVGFromURL(
      this.getImgUrl(svg.file),
      () => {
        let loadedObjects = new fabric.Group(group);

        loadedObjects.set({
          left: (this.editFabric?.width || 0) / 2,
          top: (this.editFabric?.height || 0) / 2,
          width: 250,
          height: 70,
          scaleX: 0.75,
          scaleY: 0.75,
        });
        if (svg.file === MUSIC_SVG.CRESCENDO) {
          loadedObjects.controls.ml = new fabric.Control({
            x: -0.5,
            y: 0,
            cursorStyleHandler: (fabric as any).controlsUtils
              .scaleSkewCursorStyleHandler,
            actionHandler: (fabric as any).controlsUtils.scalingXOrSkewingY,
            getActionName: (fabric as any).controlsUtils.scaleOrSkewActionName,
          });

          loadedObjects.controls.mr = new fabric.Control({
            x: 0.5,
            y: 0,
            cursorStyleHandler: (fabric as any).controlsUtils
              .scaleSkewCursorStyleHandler,
            actionHandler: (fabric as any).controlsUtils.scalingXOrSkewingY,
            getActionName: (fabric as any).controlsUtils.scaleOrSkewActionName,
          });

          loadedObjects.controls.mb = new fabric.Control({
            x: 0,
            y: 0.5,
            cursorStyleHandler: (fabric as any).controlsUtils
              .scaleSkewCursorStyleHandler,
            actionHandler: (fabric as any).controlsUtils.scalingYOrSkewingX,
            getActionName: (fabric as any).controlsUtils.scaleOrSkewActionName,
          });

          loadedObjects.controls.mt = new fabric.Control({
            x: 0,
            y: -0.5,
            cursorStyleHandler: (fabric as any).controlsUtils
              .scaleSkewCursorStyleHandler,
            actionHandler: (fabric as any).controlsUtils.scalingYOrSkewingX,
            getActionName: (fabric as any).controlsUtils.scaleOrSkewActionName,
          });
        }

        this.editFabric?.add(loadedObjects);

        this.musicSymbolDialog = false;
        this.editFabric?.setActiveObject(loadedObjects);
        this.editFabric?.renderAll();
      },
      function (item: any, object: any) {
        object.set("id", item.getAttribute("id"));
        group.push(object);
      }
    );
  }

  openMusicIconPopover(): void {
    this.musicSymbolDialog = true;
  }

  @Watch("editMode", { immediate: true })
  async onEditChange(editMode: boolean): Promise<void> {
    if (editMode) {
      if (!Number.isInteger(this.currentPage)) {
        this.currentPage += 0.5;
      }
      this.clearOverlayCanvas();
      await this.createFabricCanvas();
      this.saveDrawnData();
      this.removeFabricCanvas();
      await this.createFabricCanvas();
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
    this.setEditMode({
      interactiveMode: false,
      drawingMode: true,
      pencilMode: false,
    });
    this.setMarkerMode();
  }

  startInteractiveMode(): void {
    if (!this.editFabric) {
      return;
    }
    this.setEditMode({
      interactiveMode: true,
      drawingMode: false,
    });
  }

  saveDrawnData(): void {
    if (!this.editFabric) return;
    let fabricJson = this.editFabric.toJSON() as any;
    let fabricDataUrl = this.editFabric.toDataURL();
    if (fabricJson.objects.length === 0) {
      fabricDataUrl = "";
    }

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

  setEditMode(editState: EditState): void {
    let currentEditState = this.getEditMode();
    let newEditState = Object.assign(currentEditState, editState);

    if (!this.editFabric) {
      this.editState.drawingMode = false;
      this.editState.interactiveMode = false;
      this.editState.pencilMode = false;
      this.editState.color = { r: 0, g: 0, b: 0 };
      this.editState.thickness = 0;
      return;
    }
    this.editState.drawingMode = newEditState.drawingMode;
    this.editFabric.isDrawingMode = newEditState.drawingMode;
    this.editState.interactiveMode = newEditState.interactiveMode;
    this.editFabric.interactive = newEditState.interactiveMode;

    let cssColor: string;
    if (newEditState.color) {
      cssColor = `rgba(${newEditState.color.r},${newEditState.color.g},${
        newEditState.color.b
      },${newEditState.pencilMode ? 1 : 0.25})`;
    } else {
      cssColor = "rgba(0,0,0,0)";
    }
    this.editState.color = newEditState.color;
    this.editFabric.freeDrawingBrush.color = cssColor;
    this.editState.thickness = newEditState.thickness;
    this.editFabric.freeDrawingBrush.width = newEditState.thickness || 0;
  }

  getEditMode(): EditState {
    return this.editState;
  }

  async createFabricCanvas(): Promise<void> {
    let sheetViewerWrapper = document.getElementById(this.sheetViewerWrapperId);

    let currentPageCanvas =
      sheetViewerWrapper?.querySelector<HTMLCanvasElement>(
        `canvas[data-page="${this.currentPage}"]`
      );

    let editCanvas = document.createElement("canvas") as HTMLCanvasElement;
    editCanvas.className = this.editCanvasId;

    editCanvas.height = parseFloat(currentPageCanvas?.style.height || "") || 0;
    editCanvas.width = parseFloat(currentPageCanvas?.style.width || "") || 0;
    editCanvas.style.height = currentPageCanvas?.style.height || "0px";
    editCanvas.style.width = currentPageCanvas?.style.width || "0px";

    let canvasWrapper = document.querySelector<HTMLDivElement>(
      `#${this.sheetViewerWrapperId} > .canvasWrapper`
    );
    canvasWrapper?.appendChild(editCanvas);

    let currentPageData = this.overlayData.find((a: OverlayData): boolean => {
      return a.page === this.currentPage;
    });

    let heightScale = 1;
    let widthScale = 1;
    if (currentPageData) {
      heightScale = editCanvas.height / currentPageData.drawHeight;
      widthScale = editCanvas.width / currentPageData.drawWidth;
    }

    this.editFabric = new fabric.Canvas(editCanvas, {
      isDrawingMode: false,
    });
    this.startInteractiveMode();
    let handleSelection = (event: any) => {
      this.currentSelection = event.selected;
      if (event.selected.length > 1) {
        event.target.controls.clone = new fabric.Control({ visible: false });
      }
    };
    this.editFabric.on("selection:created", handleSelection);
    this.editFabric.on("selection:updated", handleSelection);
    this.editFabric.on("selection:cleared", () => {
      this.currentSelection = [];
    });

    if (!currentPageData) return;

    return new Promise((resolve) => {
      this.editFabric?.loadFromJSON(currentPageData?.data, () => {
        this.editFabric?.getObjects().forEach((canvasObject) => {
          canvasObject.scaleX = (canvasObject.scaleX || 0) * widthScale;
          canvasObject.scaleY = (canvasObject.scaleY || 0) * heightScale;
          canvasObject.left = (canvasObject.left || 0) * widthScale;
          canvasObject.top = (canvasObject.top || 0) * heightScale;
          canvasObject.dirty = true;
        });
        this.editFabric?.renderAll();
        resolve();
      });
    });
  }

  removeFabricCanvas(): void {
    this.editFabric?.dispose();
    this.editFabric = undefined;

    let sheetViewerWrapper = document.getElementById(this.sheetViewerWrapperId);
    sheetViewerWrapper?.querySelector(".canvasWrapper > canvas")?.remove();
    this.setEditMode({});
    this.currentSelection = [];
  }

  clearOverlayCanvas(): void {
    this.overlayFabrics.forEach((fabric) => {
      fabric.dispose();
    });
    this.overlayFabrics = [];
    document
      .querySelectorAll<HTMLCanvasElement>(".overlayCanvas")
      .forEach((canvas) => canvas.remove());
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

      let canvas = $wrapper?.querySelector(
        'canvas[data-page="' + pageNumber + '"]'
      ) as HTMLCanvasElement;
      let halfPageCanvas = $wrapper?.querySelector(
        'canvas[data-page="' + (pageNumber - 0.5) + '"]'
      ) as HTMLCanvasElement;

      this.createOverlay(canvas, overlayJsonData, false);
      if (halfPageCanvas) {
        this.createOverlay(halfPageCanvas, overlayJsonData, true);
      }
      this.setOverlayVisible();
    }
  }

  createOverlay(
    canvas: HTMLCanvasElement,
    overlayData: OverlayData,
    isHalfPage: boolean
  ): void {
    let zIndex = canvas.style.zIndex;
    let width = parseFloat(canvas.style.width);
    let height = parseFloat(canvas.style.height);
    let pageNumber = canvas.getAttribute("data-page");

    let overlayCanvas = document.createElement("canvas");

    overlayCanvas.style.zIndex = zIndex;
    overlayCanvas.style.width = width + "px";
    overlayCanvas.style.height = height + "px";
    overlayCanvas.height = height;
    overlayCanvas.width = width;

    overlayCanvas.setAttribute("data-page-overlay", pageNumber || "");

    overlayCanvas.classList.add("pageCanvas", "overlayCanvas");

    canvas.insertAdjacentElement("afterend", overlayCanvas);

    let widthScale = width / overlayData.drawWidth;
    let heightScale = height / overlayData.drawHeight;
    widthScale = parseFloat(widthScale.toFixed(2));
    heightScale = parseFloat(heightScale.toFixed(2));

    let overlayFabric = new fabric.StaticCanvas(overlayCanvas);
    overlayFabric.loadFromJSON(overlayData.data, () => {
      overlayFabric.getObjects().forEach((canvasObject) => {
        canvasObject.scaleX = (canvasObject.scaleX || 0) * widthScale;
        canvasObject.scaleY = (canvasObject.scaleY || 0) * heightScale;
        canvasObject.left = (canvasObject.left || 0) * widthScale;
        canvasObject.top = (canvasObject.top || 0) * heightScale;
        canvasObject.dirty = true;
      });
      overlayFabric.renderAll();
      if (isHalfPage) {
        let height = overlayFabric.getHeight() / 2;
        let width = overlayFabric.getWidth();
        overlayFabric.getContext().clearRect(0, height, width, height);
      }
    });

    this.overlayFabrics.push(overlayFabric);
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
    this.setOverlayVisible();
  }

  prevPage(): void {
    this.currentPage > 1 ? (this.currentPage -= 0.5) : null;
    this.setOverlayVisible();
  }

  setOverlayVisible(): void {
    document
      .querySelectorAll<HTMLCanvasElement>("canvas.overlayCanvas")
      .forEach((canvas) => {
        let pageNumber = parseFloat(
          canvas.getAttribute("data-page-overlay") || ""
        );
        if (
          this.currentPage === pageNumber ||
          this.currentPage - 0.5 === pageNumber
        ) {
          canvas.classList.add("pageVisible");
        } else {
          canvas.classList.remove("pageVisible");
        }
      });
  }

  isPageVisible(page: number): boolean {
    if (Number.isInteger(this.currentPage)) {
      return page === this.currentPage;
    }
    if (page === this.currentPage) {
      return true;
    }
    return page + 0.5 === this.currentPage;
  }

  async renderPage(
    pageNumber: number,
    $canvas: HTMLCanvasElement,
    $wrapper: HTMLDivElement
  ): Promise<any> {
    if (!this.pdf) {
      return;
    }
    let scaling = 1;
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
      return this.copyPageToHalfPageAndBackdrop(pageNumber, $canvas, $wrapper);
    });
  }

  copyPageToHalfPageAndBackdrop(
    pageNumber: number,
    $canvas: HTMLCanvasElement,
    $wrapper: HTMLDivElement
  ): Promise<number> {
    let originalCanvas = $wrapper?.querySelector(
      'canvas[data-page="' + pageNumber + '"]'
    ) as HTMLCanvasElement;
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

    let halfPageContext = halfPageCanvas.getContext("2d");
    halfPageContext?.drawImage(originalCanvas, 0, 0);

    let backdrop = $wrapper?.querySelector(
      'div[data-page-backdrop="' + (pageNumber - 0.5) + '"]'
    ) as HTMLDivElement;
    if (backdrop) {
      let width = parseFloat(halfPageCanvas.style.width) + 100;
      if (width > window.outerWidth) {
        width = window.outerWidth;
      }
      backdrop.style.width = width + "px";
      backdrop.style.height =
        parseFloat(halfPageCanvas.style.height) / 2 + 5 + "px";
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        if (!halfPageContext) {
          resolve(pageNumber);
          return;
        }
        let height = originalCanvas.height / 2;
        let width = originalCanvas.width;
        halfPageContext.clearRect(0, height, width, height);
        resolve(pageNumber);
      }, 500);
    });
  }
}
</script>

<style lang="less">
@font-face {
  font-family: noto-icons;
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(../assets/musicIcons/NotoMusic-Regular.ttf) format("truetype");
}

.music-icon {
  width: 25px;
  height: 40px;
  padding: 16px;
  box-sizing: content-box;
  border: 1px solid;
  font-size: 24px;
  line-height: 24px;
  position: relative;

  &:before {
    font-family: noto-icons;
    font-style: normal;
    font-weight: 400;
    content: attr(data-icon-code);
  }

  &:not(:last-child) {
    margin-right: 16px;
  }
}

.music-icons-wrapper {
  padding-left: 16px;
  display: flex;
  flex-wrap: wrap;
}

.loader {
  z-index: 99;
  position: absolute;
  left: calc(50% - 35px);
  top: calc(50% - 35px);
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
  z-index: 96;
}

.v-btn--fab,
.v-speed-dial {
  z-index: 97 !important;
}

.first-level-fab {
  position: absolute;
  right: 16px;

  bottom: calc(1 * (56px + 16px) + 16px) !important;
}

.second-level-fab {
  position: absolute;
  right: 16px;
  bottom: calc(2 * (56px + 16px) + 16px) !important;
}

.third-level-fab {
  position: absolute;
  right: 16px;
  bottom: calc(3 * (56px + 16px) + 16px) !important;
}

.square-red {
  color: #ff0000 !important;
}

.square-green {
  color: #00ff00 !important;
}

.square-blue {
  color: #0000ff !important;
}

.square-black {
  color: #000000 !important;
}

.pageBackdrop {
  background: black;
}
</style>
