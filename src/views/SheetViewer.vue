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
      <v-btn color="blue darken-2" dark @click="toggleDrawingAndInteractiveMode"
        :icon="editState.interactiveMode ? 'mdi-hand-back-right-outline' : 'mdi-pencil'"></v-btn>
      <v-btn v-if="editState.drawingMode" color="green darken-1" dark small @click="togglePencileAndMarkerMode"
        :icon="editState.pencilMode ? 'mdi-pencil' : 'mdi-marker'">
      </v-btn>


      <v-speed-dial v-if="editState.drawingMode" location="left center" transition="slide-x-reverse-transition">
        <template v-slot:activator="{ props: activatorProps }">
          <v-btn v-bind="activatorProps" :class="getCurrentBrushClass()" color="green" small dark
            icon="mdi-square-rounded">
          </v-btn>
        </template>
        <v-btn key="1" color="grey" dark small @click="setRedColor" icon="mdi-square-rounded" class="square-red">
        </v-btn>
        <v-btn key="2" color="grey" dark small @click="setGreenColor" icon="mdi-square-rounded" class="square-green">
        </v-btn>
        <v-btn key="3" color="grey" dark small @click="setBlueColor" icon="mdi-square-rounded" class="square-blue">
        </v-btn>
        <v-btn key="4" color="grey" dark small @click="setBlackColor" icon="mdi-square-rounded" class="square-black">
        </v-btn>
        <v-btn key="5" v-if="editState.pencilMode" color="grey" dark small @click="setWhiteColor"
          icon="mdi-square-rounded" class="square-white">
        </v-btn>
      </v-speed-dial>



      <v-speed-dial v-if="editState.pencilMode && editState.drawingMode" location="left center"
        transition="slide-x-reverse-transition">
        <template v-slot:activator="{ props: activatorProps }">
          <v-btn v-bind="activatorProps" color="green" small dark icon="mdi-circle"
            :class="getCurrentBrushClass() + ' draw-size-' + editState.thickness">
          </v-btn>
        </template>
        <v-btn key="1" icon="mdi-circle" color="grey lighten-1" dark small @click="setThickness(2)"
          :class="getCurrentBrushClass() + ' draw-size-2'">
        </v-btn>
        <v-btn key="2" icon="mdi-circle" color="grey lighten-1" dark small @click="setThickness(6)"
          :class="getCurrentBrushClass() + ' draw-size-6'">
        </v-btn>
        <v-btn key="3" icon="mdi-circle" color="grey lighten-1" dark small @click="setThickness(10)"
          :class="getCurrentBrushClass() + ' draw-size-10'">
        </v-btn>
        <v-btn key="4" icon="mdi-circle" color="grey lighten-1" dark small @click="setThickness(14)"
          :class="getCurrentBrushClass() + ' draw-size-14'">
        </v-btn>
        <v-btn key="5" icon="mdi-circle" color="grey lighten-1" dark small @click="setThickness(18)"
          :class="getCurrentBrushClass() + ' draw-size-18'">
        </v-btn>
      </v-speed-dial>

      <v-btn color="green" dark small @click="openMusicIconPopover" icon="mdi-music">
      </v-btn>
      <v-btn color="green" dark small @click="textDialog = !textDialog" icon="mdi-format-text">
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

<script setup lang="ts">
import * as fabric from 'fabric';
import { FabricObject } from "fabric";
import * as fontfaceobserver from "fontfaceobserver";
import _ from "lodash";
import * as pdfJs from "pdfjs-dist";
import { storeToRefs } from "pinia";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  BRUSH_COLORS,
  type Icon,
  MDI_ICONS,
  MUSIC_ICONS,
  MUSIC_SVG,
  type Svg,
} from "../Enums";
import { enhanceFabricPrototype, removeStretchControls, setDefaultPropsOnFabricObject } from "../fabricEnhancements";
import { type EditState, type OverlayData } from "../models/types";
import router from "../router";
import useStore from "../store";
import { client } from "../trcpClient";




const allMusicIcons = ref(MUSIC_ICONS.ALL_ICONS);
const allMusicSVGs = ref(MUSIC_SVG.ALL_SGVS);
const allNOTES = ref(MUSIC_ICONS.NOTES);
const allMdiIcons = ref(MDI_ICONS.ALL_ICONS);
const pageNumbers = ref(0);
const currentPage = ref(1);
const pagesLoaded = ref(0);
let pdfLoadingTask: pdfJs.PDFDocumentLoadingTask | undefined;
let editFabric: fabric.Canvas | undefined;
const sheetViewerWrapperId = "sheetViewerWrapper";
const editCanvasId = "";
let overlayData: OverlayData[] = [];
const musicSymbolDialog = ref(false);
let overlayFabrics: fabric.StaticCanvas[] = [];
const pageSizes: Array<{ width: number; height: number }> = [];
const editState = ref<EditState>({
  thickness: 0,
  drawingMode: false,
  interactiveMode: false,
  color: { r: 0, g: 0, b: 0 },
  pencilMode: false,
});
const textDialog = ref(false);
const text = ref("");
const buttonGroupLeft = ref(false);
let pdf: pdfJs.PDFDocumentProxy;
let existingText: fabric.FabricObject | undefined;



const store = useStore();
const { editMode } = storeToRefs(store);
const debouncedResize = _.debounce(onResize, 500);






onMounted(async () => {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("click", onClick);

  enhanceFabricPrototype();

  window.addEventListener("resize", debouncedResize);


  const newOverlayData = await client.loadOverlayData.query(router.currentRoute.value.params.path as string);
  if (!newOverlayData) {
    overlayData = [];
    return;
  } else {
    overlayData = JSON.parse(newOverlayData);
  }

  currentPage.value = 1;
  pdfLoadingTask = pdfJs.getDocument({
    url: "local-resource://" + btoa(encodeURIComponent(router.currentRoute.value.params.path as string)),
  });
  await renderPdf();

});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("click", onClick);
  window.removeEventListener("resize", debouncedResize);
})

function onKeyDown(event: KeyboardEvent): void {
  if (store.editMode) {
    return;
  }
  if (event.key === "ArrowRight") {
    nextPage();
  }
  if (event.key === "ArrowLeft") {
    prevPage();
  }
}

function onClick(event: MouseEvent): void {
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
  if (store.editMode) {
    return;
  }
  if (pagesLoaded.value !== pageNumbers.value) {
    return;
  }
  if (event.clientX > window.innerWidth / 2) {
    nextPage();
  } else {
    prevPage();
  }
}

function onResize(): void {
  renderPdf();
}

watch(editMode, async (editMode) => {
  if (editMode && pagesLoaded.value !== pageNumbers.value) {
    store.editMode = false
    return;
  }
  if (editMode) {
    if (!Number.isInteger(currentPage.value)) {
      currentPage.value += 0.5;
    }
    clearOverlayCanvas();
    await createFabricCanvas();
  } else if (editFabric) {
    saveDrawnData();
    removeFabricCanvas();
    await populateOverlayCanvas();
  }
})



function getCurrentWidth(): number {
  return pageSizes[currentPage.value]?.width ?? 0;
}

function getCurrentHeight(): number {
  return pageSizes[currentPage.value + 1]?.height ?? 0;
}

function getImgUrl(icon: string): string {
  // let images = require.context("../assets/", false, /\.svg$/);
  // return images("./" + icon);
  return icon
}


// @Watch("pagesLoaded", { immediate: true })
// async enableEditModeDebug() {
//   if (this.pagesLoaded === this.pageNumbers && this.pageNumbers !== 0) {

//     await new Promise(resolve => setTimeout(resolve, 1000));
//     this.editMode = true;
//   }
// }


function setGreenColor(): void {
  setEditMode({
    color: BRUSH_COLORS.GREEN.getColor(),
  });
}

function setRedColor(): void {
  setEditMode({
    color: BRUSH_COLORS.RED.getColor(),
  });
}

function setBlueColor(): void {
  setEditMode({
    color: BRUSH_COLORS.BLUE.getColor(),
  });
}

function setBlackColor(): void {
  setEditMode({
    color: BRUSH_COLORS.BLACK.getColor(),
  });
}
function setWhiteColor(): void {
  setEditMode({
    color: BRUSH_COLORS.WHITE.getColor(),
  });
}

function togglePencileAndMarkerMode(): void {
  if (editState.value.pencilMode) {
    setMarkerMode();
  } else {
    setPencilMode();
  }
}

function setMarkerMode(): void {
  setEditMode({
    pencilMode: false,
    thickness: 20,
    color: BRUSH_COLORS.RED.getColor(),
  });
}

function setThickness(thickness: number): void {
  setEditMode({
    thickness,
  });
}

function setPencilMode(): void {
  setEditMode({
    pencilMode: true,
    thickness: 2,
    color: BRUSH_COLORS.BLACK.getColor(),
  });
}

function getCurrentBrushClass(): string {
  if (!editState.value.color) return "";
  if (BRUSH_COLORS.RED.equals(editState.value.color)) {
    return "square-red";
  }
  if (BRUSH_COLORS.BLUE.equals(editState.value.color)) {
    return "square-blue";
  }
  if (BRUSH_COLORS.GREEN.equals(editState.value.color)) {
    return "square-green";
  }
  if (BRUSH_COLORS.BLACK.equals(editState.value.color)) {
    return "square-black";
  }
  if (BRUSH_COLORS.WHITE.equals(editState.value.color)) {
    return "square-white";
  }
  return "";
}

// function addSquare(): void {
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

function addTextToCanvas(): void {
  if (!editFabric) {
    return;
  }
  if (!editState.value.interactiveMode) {
    startInteractiveMode();
  }

  if (existingText) {
    if (editFabric.getObjects().some(o => o === existingText)) {
      existingText.set("text", text.value)
      existingText.dirty = true;
      editFabric.requestRenderAll();

      textDialog.value = false;
      text.value = ""
      existingText = undefined;
      return;
    } else {

      textDialog.value = false;
      text.value = ""
      existingText = undefined
      return
    }

  }

  textDialog.value = false;

  let textbox = new fabric.FabricText(text.value, {
    width: 100,
    height: 20,
    fontSize: 16,
    selectable: true,
    __isText: true
  });

  text.value = ""
  editFabric.add(textbox);

  textbox.set({
    left: (editFabric?.width || 0) / 2,
    top: (editFabric?.height || 0) / 2,
  });
  editFabric.setActiveObject(textbox);
}

function addMdiIcon(icon: Icon) {
  addMusicIcon(icon, "Material Design Icons")
}

function addMusicIcon(icon: Icon, fontFamily = "noto-icons"): void {
  if (!editFabric) return;

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

  editFabric?.add(iconObject);
  iconObject.set({
    left: (editFabric?.width || 0) / 2,
    top: (editFabric?.height || 0) / 2,
  });
  if (!editState.value.interactiveMode) {
    startInteractiveMode();
  }
  editFabric.setActiveObject(iconObject);

  musicSymbolDialog.value = false;
}

function addMusicSvg(svg: Svg): void {
  if (!editFabric) return;
  let group: any[] = [];

  fabric.loadSVGFromURL(
    getImgUrl(svg.file),
    () => {
      let loadedObjects = new fabric.Group(group);

      loadedObjects.set({
        left: (editFabric?.width || 0) / 2,
        top: (editFabric?.height || 0) / 2,
        width: svg.width,
        height: svg.height,
        scaleX: svg.scaleX,
        scaleY: svg.scaleY,
      });

      editFabric?.add(loadedObjects);

      musicSymbolDialog.value = false;

      if (!editState.value.interactiveMode) {
        startInteractiveMode();
      }

      editFabric?.setActiveObject(loadedObjects);
      editFabric?.renderAll();
    },
    // function (item: any, object: any) {
    //   object.set("id", item.getAttribute("id"));
    //   group.push(object);
    // }
  );
}

function openMusicIconPopover(): void {
  musicSymbolDialog.value = true;
}


function toggleDrawingAndInteractiveMode(): void {
  if (!editFabric) return;
  if (editState.value.interactiveMode) {
    editFabric.discardActiveObject()
    editFabric.renderAll()
    startDrawingMode();
  } else {
    startInteractiveMode();
  }
}

function startDrawingMode(): void {
  if (!editFabric) {
    return;
  }

  setEditMode({
    interactiveMode: false,
    drawingMode: true,
  });
  setPencilMode();
}

function startInteractiveMode(): void {
  if (!editFabric) {
    return;
  }
  setEditMode({
    interactiveMode: true,
    drawingMode: false,
  });
}

function saveDrawnData(): void {
  if (!editFabric) return;
  let fabricJson = editFabric.toObject(["__isText"]) as any;
  let fabricDataUrl = editFabric.toDataURL();
  if (fabricJson.objects.length === 0) {
    fabricDataUrl = "";
  }

  let currentPageData = overlayData.find((a: OverlayData): boolean => {
    return a.page === currentPage.value;
  });
  let width = editFabric.width || 0;
  let height = editFabric.height || 0;
  if (currentPageData) {
    delete currentPageData.dataUrl;
    currentPageData.data = fabricJson;
    currentPageData.drawWidth = width;
    currentPageData.drawHeight = height;
  } else {
    overlayData.push({
      page: currentPage.value,
      data: fabricJson,
      drawWidth: width,
      drawHeight: height,
    });
  }
  client.saveOverlayData.query({
    data: JSON.stringify(overlayData),
    path: router.currentRoute.value.params.path as string,
  })

}

function setEditMode(newEditState: Partial<EditState>): void {
  let currentEditState = getEditMode();
  const combinedEditState = Object.assign(currentEditState, newEditState);

  if (!editFabric) {
    editState.value.drawingMode = false;
    editState.value.interactiveMode = false;
    editState.value.pencilMode = false;
    editState.value.color = { r: 0, g: 0, b: 0 };
    editState.value.thickness = 0;
    return;
  }
  editState.value.drawingMode = combinedEditState.drawingMode;
  editFabric.isDrawingMode = combinedEditState.drawingMode;
  editState.value.interactiveMode = combinedEditState.interactiveMode;
  // this.editFabric.interactive = newEditState.interactiveMode;

  let cssColor: string;
  if (combinedEditState.color) {
    cssColor = `rgba(${combinedEditState.color.r},${combinedEditState.color.g},${combinedEditState.color.b
      },${combinedEditState.pencilMode ? 1 : 0.25})`;
  } else {
    cssColor = "rgba(0,0,0,0)";
  }
  editState.value.color = combinedEditState.color;
  editFabric.freeDrawingBrush = new fabric.PencilBrush(editFabric);
  editFabric.freeDrawingBrush.color = cssColor;
  editState.value.thickness = combinedEditState.thickness;
  editFabric.freeDrawingBrush.width = combinedEditState.thickness || 0;
}

function getEditMode(): EditState {
  return editState.value;
}

async function createFabricCanvas(): Promise<void> {
  let sheetViewerWrapper = document.getElementById(sheetViewerWrapperId);

  let currentPageCanvas =
    sheetViewerWrapper?.querySelector<HTMLCanvasElement>(
      `canvas[data-page="${currentPage.value}"]`
    );

  let editCanvas = document.createElement("canvas") as HTMLCanvasElement;
  editCanvas.className = editCanvasId;

  editCanvas.height = parseFloat(currentPageCanvas?.style.height || "") || 0;
  editCanvas.width = parseFloat(currentPageCanvas?.style.width || "") || 0;
  editCanvas.style.height = currentPageCanvas?.style.height || "0px";
  editCanvas.style.width = currentPageCanvas?.style.width || "0px";

  let canvasWrapper = document.querySelector<HTMLDivElement>(
    `#${sheetViewerWrapperId} > .canvasWrapper`
  );
  canvasWrapper?.appendChild(editCanvas);

  let currentPageData = overlayData.find((a: OverlayData): boolean => {
    return a.page === currentPage.value;
  });

  let heightScale = 1;
  let widthScale = 1;
  if (currentPageData) {
    heightScale = editCanvas.height / currentPageData.drawHeight;
    widthScale = editCanvas.width / currentPageData.drawWidth;
  }

  editFabric = new fabric.Canvas(editCanvas, {
    isDrawingMode: false,
  });
  startDrawingMode();
  let handleSelection = () => {
    if (!editFabric) return;
    if (editFabric.getActiveObjects().length > 1) {
      let groupSelector = editFabric.getActiveObject()
      if (groupSelector) {
        setDefaultPropsOnFabricObject(groupSelector, () => { }, true)
        groupSelector.setCoords()
        editFabric.renderAll();
      }
    }
    checkFabButtonLocation();
  };


  let checkFabButtonLocation = () => {
    if (!editFabric) return;
    const activeObject = editFabric.getActiveObject()
    if (!activeObject) return;
    const [tl, tr, br, bl] = activeObject.getCoords();

    if (br.x > editFabric.width * 0.75 && br.y > editFabric.height * 0.75) {
      buttonGroupLeft.value = true
    } else {
      buttonGroupLeft.value = false
    }

  }
  editFabric.on("selection:created", handleSelection);
  editFabric.on("selection:updated", handleSelection);



  editFabric.on("object:moving", checkFabButtonLocation)
  editFabric.on("selection:cleared", () => {
    buttonGroupLeft.value = false
  });

  editFabric.on("object:added", (event) => {
    setDefaultPropsOnFabricObject(event.target, (event, transform) => {
      text.value = transform.target.get("text");
      textDialog.value = true;
      existingText = transform.target;
    })
  })

  if (!currentPageData) return;

  return new Promise(async (resolve) => {

    await new fontfaceobserver.default("notoIcons").load()
    await editFabric?.loadFromJSON(currentPageData?.data, (jsonObject, canvasObject) => {
      if (canvasObject instanceof FabricObject) {
        canvasObject.scaleX = (canvasObject.scaleX || 0) * widthScale;
        canvasObject.scaleY = (canvasObject.scaleY || 0) * heightScale;
        canvasObject.left = (canvasObject.left || 0) * widthScale;
        canvasObject.top = (canvasObject.top || 0) * heightScale;
        canvasObject.dirty = true;
        // setDefaultPropsOnFabricObject(canvasObject)
      }
    });

    editFabric?.renderAll();
    resolve();
  });
}

function removeFabricCanvas(): void {
  editFabric?.dispose();
  editFabric = undefined;

  let sheetViewerWrapper = document.getElementById(sheetViewerWrapperId);
  sheetViewerWrapper?.querySelector(".canvasWrapper > canvas")?.remove();
  setEditMode({});
}

function clearOverlayCanvas(): void {
  overlayFabrics.forEach((fabric) => {
    fabric.dispose();
  });
  overlayFabrics = [];
  document
    .querySelectorAll<HTMLCanvasElement>(".overlayCanvas")
    .forEach((canvas) => canvas.remove());
}

async function populateOverlayCanvas() {
  clearOverlayCanvas();

  let $wrapper = document.getElementById(
    "sheetViewerWrapper"
  ) as HTMLDivElement;

  for (let i = 0; i < overlayData.length; i++) {
    let overlayJsonData = overlayData[i];
    if (!overlayJsonData) continue;
    let pageNumber = overlayJsonData.page;

    let canvas = $wrapper?.querySelector(
      'canvas[data-page="' + pageNumber + '"]'
    ) as HTMLCanvasElement;
    let halfPageCanvas = $wrapper?.querySelector(
      'canvas[data-page="' + (pageNumber - 0.5) + '"]'
    ) as HTMLCanvasElement;

    await createOverlay(canvas, overlayJsonData, false);
    if (halfPageCanvas) {
      await createOverlay(halfPageCanvas, overlayJsonData, true);
    }
    setOverlayVisible();
  }
}

async function createOverlay(
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

  overlayFabrics.push(overlayFabric);
}

async function renderPdf(): Promise<void> {
  if (!pdfLoadingTask) {
    return;
  }
  pdf = await pdfLoadingTask.promise;
  pageNumbers.value = pdf?.numPages || 0;
  pagesLoaded.value = 0;

  setTimeout(() => {
    let $wrapper = document.getElementById(
      "sheetViewerWrapper"
    ) as HTMLDivElement;
    let renderingPromises = [];
    for (let i = 1; i <= pageNumbers.value; i++) {
      let $canvas = $wrapper?.querySelector(
        'canvas[data-page="' + i + '"]'
      ) as HTMLCanvasElement;
      renderingPromises.push(
        renderPage(i, $canvas, $wrapper).then(() => {
          pagesLoaded.value++;
        })
      );
    }
    Promise.all(renderingPromises).then(populateOverlayCanvas);
  }, 0);
}


function nextPage(): void {
  currentPage.value += currentPage.value < pageNumbers.value ? 0.5 : 0
  setOverlayVisible();
}

function prevPage(): void {
  currentPage.value -= currentPage.value > 1 ? 0.5 : 0
  setOverlayVisible();
}

function setOverlayVisible(): void {
  document
    .querySelectorAll<HTMLCanvasElement>("canvas.overlayCanvas")
    .forEach((canvas) => {
      let pageNumber = parseFloat(
        canvas.getAttribute("data-page-overlay") || ""
      );
      if (
        currentPage.value === pageNumber ||
        currentPage.value - 0.5 === pageNumber
      ) {
        canvas.classList.add("pageVisible");
      } else {
        canvas.classList.remove("pageVisible");
      }
    });
}

function isPageVisible(page: number): boolean {
  if (Number.isInteger(currentPage.value)) {
    return page === currentPage.value;
  }
  if (page === currentPage.value) {
    return true;
  }
  return page + 0.5 === currentPage.value;
}

async function renderPage(
  pageNumber: number,
  $canvas: HTMLCanvasElement,
  $wrapper: HTMLDivElement
): Promise<any> {
  if (!pdf) {
    return;
  }
  let scaling = 4;
  let page = await pdf.getPage(pageNumber);
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

  pageSizes[pageNumber] = {
    width: windowViewport.width,
    height: windowViewport.height,
  };

  // Render PDF page into canvas context
  const canvasContext = $canvas.getContext("2d");
  if (!canvasContext) return;
  canvasContext?.scale(scaling, scaling);
  const renderContext = {
    canvasContext,
    viewport,
    background: "#ffffff",
  };

  await page.render(renderContext).promise.then(() => {
    return copyPageToHalfPageAndBackdrop(pageNumber, $canvas, $wrapper);
  });
}

function copyPageToHalfPageAndBackdrop(
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

.square-white {
  color: #ffffff !important;
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