<template>
  <div id="sheetViewerWrapper" class="canvasWrapper">
    <v-progress-circular v-if="pagesLoaded !== pageNumbers" :size="70" :width="7" class="loader" color="primary"
      indeterminate>
      {{
        Number.isInteger((100 / pageNumbers) * pagesLoaded)
          ? (100 / pageNumbers) * pagesLoaded
          : ((100 / pageNumbers) * pagesLoaded).toFixed(0)
      }}%
    </v-progress-circular>
    <div v-if="pagesLoaded !== pageNumbers" class="overlay"></div>
    <div class="splitIndicator" v-if="currentPage !== pageNumbers" v-bind:style="{
      width: getCurrentWidth() + 'px',
      height: getCurrentHeight() + 'px',
    }">
      <div class="indicatorLeft"></div>
      <div class="indicatorRight"></div>
    </div>
    <div class="canvasWrapper">
      <div v-for="pageNumber in pageNumbers" :key="pageNumber" class="pageWrapper">
        <div v-if="pageNumber !== 1" :class="isPageVisible(pageNumber - 0.5) ? 'pageVisible' : ''"
          :data-page-backdrop="pageNumber - 0.5" class="pageCanvas pageBackdrop"
          v-bind:style="{ zIndex: (pageNumber - 0.5) * 2 }"></div>
        <canvas v-if="pageNumber !== 1" :class="isPageVisible(pageNumber - 0.5) ? 'pageVisible' : ''"
          :data-page="pageNumber - 0.5" class="pageCanvas" v-bind:style="{ zIndex: (pageNumber - 0.5) * 2 }" />
        <canvas :class="isPageVisible(pageNumber) ? 'pageVisible' : ''" :data-page="pageNumber" class="pageCanvas"
          v-bind:style="{ zIndex: pageNumber * 2 }" />
      </div>
    </div>


    <div v-if="editMode" class="fabContainer" :class="buttonGroupLeft ? 'fabButtonsLeft' : ''" absolute bottom right>
      <v-btn v-model="editFab" color="blue darken-2" dark fab @click="toggleDrawingAndInteractiveMode">
        <v-icon v-if="editFab"> mdi-close</v-icon>
        <v-icon v-else-if="editState.interactiveMode">
          mdi-hand-back-right-outline
        </v-icon>
        <v-icon v-else-if="editState.drawingMode"> mdi-pencil</v-icon>
      </v-btn>
      <v-btn v-if="editState.drawingMode" v-model="drawingFab" color="green darken-1" dark fab small
        @click="togglePencileAndMarkerMode">
        <v-icon v-if="editState.pencilMode">mdi-pencil</v-icon>
        <v-icon v-else>mdi-marker</v-icon>
      </v-btn>


      <v-speed-dial v-if="editState.drawingMode" v-model="colorFab" direction="left"
        transition="slide-x-reverse-transition">
        <template v-slot:activator>
          <v-btn v-model="colorFab" color="green" small dark fab>
            <v-icon :class="getCurrentBrushClass()">mdi-square-rounded</v-icon>
          </v-btn>
        </template>
        <v-btn color="gray" dark fab small @click="setRedColor">
          <v-icon class="square-red">mdi-square-rounded</v-icon>
        </v-btn>
        <v-btn color="gray" dark fab small @click="setGreenColor">
          <v-icon class="square-green">mdi-square-rounded</v-icon>
        </v-btn>
        <v-btn color="gray" dark fab small @click="setBlueColor">
          <v-icon class="square-blue">mdi-square-rounded</v-icon>
        </v-btn>
        <v-btn color="gray" dark fab small @click="setBlackColor">
          <v-icon class="square-black">mdi-square-rounded</v-icon>
        </v-btn>
        <v-btn v-if="editState.pencilMode" color="gray" dark fab small @click="setWhiteColor">
          <v-icon class="square-white">mdi-square-rounded</v-icon>
        </v-btn>
      </v-speed-dial>



      <v-speed-dial v-if="editState.pencilMode && editState.drawingMode" v-model="sizeFab" direction="left"
        transition="slide-x-reverse-transition">
        <template v-slot:activator>
          <v-btn v-model="colorFab" color="green" small dark fab>
            <v-icon :class="getCurrentBrushClass() + ' draw-size-' + editState.thickness">mdi-circle</v-icon>
          </v-btn>
        </template>
        <v-btn color="grey lighten-1" dark fab small @click="setThickness(2)">
          <v-icon :class="getCurrentBrushClass() + ' draw-size-2'">mdi-circle</v-icon>
        </v-btn>
        <v-btn color="grey lighten-1" dark fab small @click="setThickness(6)">
          <v-icon :class="getCurrentBrushClass() + ' draw-size-6'">mdi-circle</v-icon>
        </v-btn>
        <v-btn color="grey lighten-1" dark fab small @click="setThickness(10)">
          <v-icon :class="getCurrentBrushClass() + ' draw-size-10'">mdi-circle</v-icon>
        </v-btn>
        <v-btn color="grey lighten-1" dark fab small @click="setThickness(14)">
          <v-icon :class="getCurrentBrushClass() + ' draw-size-14'">mdi-circle</v-icon>
        </v-btn>
        <v-btn color="grey lighten-1" dark fab small @click="setThickness(18)">
          <v-icon :class="getCurrentBrushClass() + ' draw-size-18'">mdi-circle</v-icon>
        </v-btn>
      </v-speed-dial>

      <v-btn color="green" dark fab small @click="openMusicIconPopover">
        <v-icon>mdi-music</v-icon>
      </v-btn>
      <v-btn color="green" dark fab small @click="textDialog = !textDialog">
        <v-icon>mdi-format-text</v-icon>
      </v-btn>
    </div>
    <!--  Mode Selection  -->


    <v-dialog v-model="musicSymbolDialog" max-width="466px">
      <v-card>
        <v-card-title>
          <span>Add Symbol</span>
        </v-card-title>
        <div class="music-icons-wrapper">
          <div v-for="icon in allMusicIcons" v-bind:key="icon.name" :class="'icon-' + icon.name"
            :data-icon-code="icon.code" class="music-icon" @click="addMusicIcon(icon)" />

          <div v-for="icon in allMdiIcons" v-bind:key="icon.name" :class="'icon-' + icon.name"
            :data-icon-code="icon.code" class="mdi mdi-icon" @click="addMdiIcon(icon)" />

          <img v-for="icon in allMusicSVGs" v-bind:key="icon.name" :alt="icon.name" class="music-icon"
            v-bind:src="getImgUrl(icon.file)" @click="addMusicSvg(icon)" />

          <div v-for="icon in allNOTES" v-bind:key="icon.name" :class="'icon-' + icon.name" :data-icon-code="icon.code"
            class="music-icon note" @click="addMusicIcon(icon)" />
        </div>
        <v-card-actions>
          <v-btn color="primary" text @click="musicSymbolDialog = false">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>


    <v-dialog v-model="textDialog" max-width="466px">

      <v-card>
        <v-card-title>
          <span>Add Text</span>
        </v-card-title>
        <v-card-text>

          <v-text-field hide-details="auto" v-model="text"></v-text-field>
        </v-card-text>

        <v-card-actions>
          <v-btn color="primary" text @click="addTextToCanvas">
            Ok
          </v-btn>
          <v-btn color="primary" text @click="textDialog = false">
            Cancel
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script lang="ts">
import fabric, { FabricObject } from "fabric"
import * as fontfaceobserver from "fontfaceobserver"
import _, { set } from "lodash"
import * as pdfJs from "pdfjs-dist"
import Vue from "vue"
import Component from "vue-class-component"
import { Watch } from "vue-property-decorator"
import { mapFields } from "vuex-map-fields"
import {
  BRUSH_COLORS,
  EventNames,
  Icon,
  MDI_ICONS,
  MUSIC_ICONS,
  MUSIC_SVG,
  Svg,
} from "../Enums"
import { enhanceFabricPrototype, removeStretchControls, setDefaultPropsOnFabricObject } from "../fabricEnhancements"
import { EditState } from "../models/EditState"
import { OverlayData } from "../models/OverlayData"


@Component({
  computed: {
    ...mapFields(["editMode"]),
  },
})
export default class SheetViewer extends Vue {
  allMusicIcons = MUSIC_ICONS.ALL_ICONS;
  allMusicSVGs = MUSIC_SVG.ALL_SGVS;
  allNOTES = MUSIC_ICONS.NOTES;
  allMdiIcons = MDI_ICONS.ALL_ICONS;
  pageNumbers = 0;
  currentPage = 1;
  pagesLoaded = 0;
  debouncedResize?: any;
  pdfLoadingTask?: pdfJs.PDFDocumentLoadingTask;
  editFabric?: fabric.Canvas;
  sheetViewerWrapperId = "sheetViewerWrapper";
  editCanvasId = "";
  overlayData: OverlayData[] = [];
  editFab = false;
  drawingFab = false;
  colorFab = false;
  sizeFab = false;
  objectFab = false;
  musicSymbolDialog = false;
  overlayFabrics: fabric.StaticCanvas[] = [];
  pageSizes: Array<{ width: number; height: number }> = [];
  editState: EditState = {
    thickness: 0,
    drawingMode: false,
    interactiveMode: false,
    color: { r: 0, g: 0, b: 0 },
    pencilMode: false,
  };
  textDialog = false;
  text = "";
  buttonGroupLeft = false;
  editMode: boolean;
  private pdf?: pdfJs.PDFDocumentProxy;
  existingText: fabric.FabricObject

  getCurrentWidth(): number {
    return this.pageSizes[this.currentPage]?.width ?? 0;
  }

  getCurrentHeight(): number {
    return this.pageSizes[this.currentPage + 1]?.height ?? 0;
  }

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
  // @Watch("pagesLoaded", { immediate: true })
  // async enableEditModeDebug() {
  //   if (this.pagesLoaded === this.pageNumbers && this.pageNumbers !== 0) {

  //     await new Promise(resolve => setTimeout(resolve, 1000));
  //     this.editMode = true;
  //   }
  // }


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
  setWhiteColor(): void {
    this.setEditMode({
      color: BRUSH_COLORS.WHITE.getColor(),
    });
  }

  togglePencileAndMarkerMode(): void {
    if (this.editState.pencilMode) {
      this.setMarkerMode();
    } else {
      this.setPencilMode();
    }
  }

  setMarkerMode(): void {
    this.setEditMode({
      pencilMode: false,
      thickness: 20,
      color: BRUSH_COLORS.RED.getColor(),
    });
  }

  setThickness(thickness: number): void {
    this.setEditMode({
      thickness,
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
    if (BRUSH_COLORS.WHITE.equals(this.editState.color)) {
      return "square-white";
    }
    return "";
  }

  // addSquare(): void {
  //   if (!this.editFabric) {
  //     return;
  //   }

  //   let rect = new fabric.Rect({
  //     fill: "rgba(255,0,0,0.25)",
  //     width: 50,
  //     height: 50,
  //     left: (this.editFabric.width || 0) / 2,
  //     top: (this.editFabric.height || 0) / 2,
  //   });
  //   this.editFabric.add(rect);
  //   this.editFabric.setActiveObject(rect);
  // }

  // addBlackSquare(): void {
  //   if (!this.editFabric) {
  //     return;
  //   }

  //   let rect = new fabric.Rect({
  //     fill: "rgba(0,0,0,1)",
  //     width: 50,
  //     height: 50,
  //     left: (this.editFabric.width || 0) / 2,
  //     top: (this.editFabric.height || 0) / 2,
  //   });
  //   this.editFabric.add(rect);
  //   this.editFabric.setActiveObject(rect);
  // }

  addTextToCanvas(): void {
    if (!this.editFabric) {
      return;
    }
    if (!this.editState.interactiveMode) {
      this.startInteractiveMode();
    }

    if (this.existingText) {
      if (this.editFabric.getObjects().some(o => o === this.existingText)) {
        this.existingText.set("text", this.text)
        this.existingText.dirty = true;
        this.editFabric.requestRenderAll();

        this.textDialog = false;
        this.text = ""
        this.existingText = undefined;
        return;
      } else {

        this.textDialog = false;
        this.text = ""
        this.existingText = undefined
        return
      }

    }

    this.textDialog = false;

    let textbox = new fabric.FabricText(this.text, {
      width: 100,
      height: 20,
      fontSize: 16,
      selectable: true,
      __isText: true
    });

    this.text = ""
    this.editFabric.add(textbox);

    textbox.set({
      left: (this.editFabric?.width || 0) / 2,
      top: (this.editFabric?.height || 0) / 2,
    });
    this.editFabric.setActiveObject(textbox);
  }

  addMdiIcon(icon: Icon) {
    this.addMusicIcon(icon, "Material Design Icons")
  }

  addMusicIcon(icon: Icon, fontFamily = "noto-icons"): void {
    if (!this.editFabric) return;

    let iconObject = new fabric.FabricText(icon.code, {
      fill: "red",
      fontSize: 1,
      fontWeight: 500,
      fontFamily: fontFamily,
      selectable: true,
      scaleX: 50,
      scaleY: 50,
    });

    removeStretchControls(iconObject);

    this.editFabric?.add(iconObject);
    iconObject.set({
      left: (this.editFabric?.width || 0) / 2,
      top: (this.editFabric?.height || 0) / 2,
    });
    if (!this.editState.interactiveMode) {
      this.startInteractiveMode();
    }
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
          width: svg.width,
          height: svg.height,
          scaleX: svg.scaleX,
          scaleY: svg.scaleY,
        });

        this.editFabric?.add(loadedObjects);

        this.musicSymbolDialog = false;

        if (!this.editState.interactiveMode) {
          this.startInteractiveMode();
        }

        this.editFabric?.setActiveObject(loadedObjects);
        this.editFabric?.renderAll();
      },
      // function (item: any, object: any) {
      //   object.set("id", item.getAttribute("id"));
      //   group.push(object);
      // }
    );
  }

  openMusicIconPopover(): void {
    this.musicSymbolDialog = true;
  }

  @Watch("editMode", { immediate: true })
  async onEditChange(editMode: boolean): Promise<void> {
    if (this.editMode && this.pagesLoaded !== this.pageNumbers) {
      this.editMode = false
      return;
    }
    if (editMode) {
      if (!Number.isInteger(this.currentPage)) {
        this.currentPage += 0.5;
      }
      this.clearOverlayCanvas();
      await this.createFabricCanvas();
      // this.saveDrawnData();
      // this.removeFabricCanvas();
      // await this.createFabricCanvas();
    } else if (this.editFabric) {
      this.saveDrawnData();
      this.removeFabricCanvas();
      await this.populateOverlayCanvas();
    }
  }

  toggleDrawingAndInteractiveMode(): void {
    if (this.editState.interactiveMode) {
      this.editFabric.discardActiveObject()
      this.editFabric.renderAll()
      this.startDrawingMode();
    } else {
      this.startInteractiveMode();
    }
  }

  startDrawingMode(): void {
    if (!this.editFabric) {
      return;
    }

    this.setEditMode({
      interactiveMode: false,
      drawingMode: true,
    });
    this.setPencilMode();
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
    let fabricJson = this.editFabric.toObject(["__isText"]) as any;
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
      delete currentPageData.dataUrl;
      currentPageData.data = fabricJson;
      currentPageData.drawWidth = width;
      currentPageData.drawHeight = height;
    } else {
      this.overlayData.push({
        page: this.currentPage,
        data: fabricJson,
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
    // this.editFabric.interactive = newEditState.interactiveMode;

    let cssColor: string;
    if (newEditState.color) {
      cssColor = `rgba(${newEditState.color.r},${newEditState.color.g},${newEditState.color.b
        },${newEditState.pencilMode ? 1 : 0.25})`;
    } else {
      cssColor = "rgba(0,0,0,0)";
    }
    this.editState.color = newEditState.color;
    this.editFabric.freeDrawingBrush = new fabric.PencilBrush(this.editFabric);
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
    this.startDrawingMode();
    let handleSelection = () => {
      if (this.editFabric.getActiveObjects().length > 1) {
        let groupSelector = this.editFabric.getActiveObject()
        setDefaultPropsOnFabricObject(groupSelector, () => { }, true)
        groupSelector.setCoords()
        this.editFabric.renderAll();
      }
      checkFabButtonLocation();
    };


    let checkFabButtonLocation = () => {
      const [tl, tr, br, bl] = this.editFabric.getActiveObject().getCoords();

      if (br.x > this.editFabric.width * 0.75 && br.y > this.editFabric.height * 0.75) {
        this.buttonGroupLeft = true
      } else {
        this.buttonGroupLeft = false
      }

    }
    this.editFabric.on("selection:created", handleSelection.bind(this));
    this.editFabric.on("selection:updated", handleSelection.bind(this));



    this.editFabric.on("object:moving", checkFabButtonLocation)
    this.editFabric.on("selection:cleared", (event) => {
      this.buttonGroupLeft = false
    });

    this.editFabric.on("object:added", (event) => {
      const target = event.target
      let text = target.get("text");
      setDefaultPropsOnFabricObject(event.target, () => {
        this.text = text;
        this.textDialog = true;
        this.existingText = target;
      })
    })

    if (!currentPageData) return;

    return new Promise(async (resolve) => {

      await new fontfaceobserver.default("notoIcons").load()
      await this.editFabric?.loadFromJSON(currentPageData?.data, (jsonObject, canvasObject) => {
        if (canvasObject instanceof FabricObject) {
          canvasObject.scaleX = (canvasObject.scaleX || 0) * widthScale;
          canvasObject.scaleY = (canvasObject.scaleY || 0) * heightScale;
          canvasObject.left = (canvasObject.left || 0) * widthScale;
          canvasObject.top = (canvasObject.top || 0) * heightScale;
          canvasObject.dirty = true;
          // setDefaultPropsOnFabricObject(canvasObject)
        }
      });

      this.editFabric?.renderAll();
      resolve();
    });
  }

  removeFabricCanvas(): void {
    this.editFabric?.dispose();
    this.editFabric = undefined;

    let sheetViewerWrapper = document.getElementById(this.sheetViewerWrapperId);
    sheetViewerWrapper?.querySelector(".canvasWrapper > canvas")?.remove();
    this.setEditMode({});
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

  async populateOverlayCanvas() {
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

      await this.createOverlay(canvas, overlayJsonData, false);
      if (halfPageCanvas) {
        await this.createOverlay(halfPageCanvas, overlayJsonData, true);
      }
      this.setOverlayVisible();
    }
  }

  async createOverlay(
    canvas: HTMLCanvasElement,
    overlayData: OverlayData,
    isHalfPage: boolean
  ): Promise<void> {
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
    await overlayFabric.loadFromJSON(overlayData.data, (a, canvasObject) => {
      if (canvasObject instanceof FabricObject) {
        canvasObject.scaleX = (canvasObject.scaleX || 0) * widthScale;
        canvasObject.scaleY = (canvasObject.scaleY || 0) * heightScale;
        canvasObject.left = (canvasObject.left || 0) * widthScale;
        canvasObject.top = (canvasObject.top || 0) * heightScale;
        canvasObject.dirty = true;
      }
    });


    overlayFabric.renderAll();
    if (isHalfPage) {
      let height = overlayFabric.getHeight() / 2;
      let width = overlayFabric.getWidth();
      overlayFabric.getContext().clearRect(0, height, width, height);
    }

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
    let scaling = 4;
    let page = await this.pdf.getPage(pageNumber);
    let scale1ViewPort = page.getViewport({
      scale: 1,
    });

    let scale = $wrapper.clientHeight / scale1ViewPort.height;

    let windowViewport = page.getViewport({ scale });

    if (windowViewport.width > $wrapper.clientWidth) {
      scale = $wrapper.clientWidth / scale1ViewPort.width;
      windowViewport = page.getViewport({ scale });
    }
    let viewport = scale1ViewPort;

    // Prepare canvas using PDF page dimensions

    $canvas.height = viewport.height * scaling;
    $canvas.width = viewport.width * scaling;
    $canvas.style.height = windowViewport.height + "px";
    $canvas.style.width = windowViewport.width + "px";

    this.pageSizes[pageNumber] = {
      width: windowViewport.width,
      height: windowViewport.height,
    };

    // Render PDF page into canvas context
    const canvasContext = $canvas.getContext("2d");
    canvasContext?.scale(scaling, scaling);
    const renderContext = {
      canvasContext,
      viewport,
      background: "#ffffff",
    };

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
.splitIndicator {
  pointer-events: none;
  position: absolute;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  align-content: center;
  transform: translateX(-50%);
  left: 50%;
  z-index: 99;

  >div {
    width: 10px;
    transform: translateY(2px);
    height: 5px;
    background-color: red;
  }

}

@font-face {
  font-family: notoIcons;
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(../assets/musicIcons/NotoMusic-Regular.ttf?some=true) format("truetype");
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
    font-family: notoIcons;
    font-style: normal;
    font-weight: 400;
    content: attr(data-icon-code);
  }

  &:not(:last-child) {
    margin-right: 16px;
  }
}

.mdi-icon {
  width: 25px;
  height: 40px;
  padding: 16px;
  box-sizing: content-box;
  border: 1px solid;
  font-size: 24px;
  line-height: 24px;
  position: relative;

  &:before {
    font-style: normal;
    font-weight: 400;
    content: attr(data-icon-code);
  }

  &:not(:last-child) {
    margin-right: 16px;
  }
}

.note {
  font-size: 13px;
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

.fabContainer {

  &.fabButtonsLeft {
    left: 16px;
    right: auto;
  }

  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 8px;
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

.draw-size-2 {
  font-size: 2px !important;
}

.draw-size-6 {
  font-size: 6px !important;
}

.draw-size-10 {
  font-size: 10px !important;
}

.draw-size-14 {
  font-size: 14px !important;
}

.draw-size-18 {
  font-size: 18px !important;
}

.pageBackdrop {
  background: black;
}
</style>