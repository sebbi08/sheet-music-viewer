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
      <v-btn v-if="editState.drawingMode" color="green darken-1" dark small @click="togglePencilAndMarkerMode"
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

    <WriteBlockDialog v-model="writeBlockDialog" :file-name="sheetFileName" :block="writeBlock" />
  </div>
</template>

<script setup lang="ts">
import * as fabric from 'fabric';
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
import WriteBlockDialog from "../components/WriteBlockDialog.vue";
import { enhanceFabricPrototype, removeStretchControls, setDefaultPropsOnFabricObject } from "../fabricEnhancements";
import { displayTransform, payloadFromCanvas, rotatePayload, transformFabricJson } from "../markup/fabricTransform";
import { loadMarkupFonts } from "../markup/renderPng";
import { writeBlockText } from "../markup/writeBlockTexts";
import { type LoadMarkupResult, type MarkupPayload, type Rect, type WriteBlock } from "../models/markup";
import { OCG_NAME } from "../models/markupConstants";
import { type EditState } from "../models/types";
import router from "../router";
import useStore from "../store";
import { useMarkupSaves } from "../store/markupSaves";
import { useNotices } from "../store/notices";
import { client } from "../trcpClient";

type MarkupEntry = { rect: Rect | null; payload: MarkupPayload };
type OptionalContentConfig = Awaited<ReturnType<pdfJs.PDFDocumentProxy["getOptionalContentConfig"]>>;

const LOAD_FAILED =
  "Die Markierungen dieser PDF konnten nicht geladen werden. Bearbeiten ist deaktiviert, damit sie nicht überschrieben werden.";
const PAGE_LOAD_FAILED =
  "Die Markierungen dieser Seite konnten nicht geladen werden. Änderungen an dieser Seite werden nicht gespeichert.";




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
// In dev, Vite serves the copied pdf.js assets; in the packaged app they are
// served from the asar via the custom "app" protocol.
const pdfJsAssetBaseUrl = window.location.protocol.startsWith("http")
  ? new URL("./pdfjs/", window.location.href).toString()
  : "app://bundle/pdfjs/";
// The route changes before this component unmounts, so the path is read once.
const sheetPath = router.currentRoute.value.params.path as string;
const sheetFileName = sheetPath.split(/[\\/]/).pop() ?? sheetPath;
/** Why markup cannot be saved into this PDF, found anew on every open (null: it can). */
const writeBlock = ref<WriteBlock | null>(null);
const writeBlockDialog = ref(false);
/** Set when the sheet is left: a load still running for it must not change the app any more. */
let unmounted = false;
/**
 * Markup per 1-based page as shown; `rect` (PDF user space) null = drawn against the whole visible page.
 * Unsaved changes live in the markupSaves store (outside this component), keyed by the PDF path.
 */
const markupPages = new Map<number, MarkupEntry>();
/** The edit canvas finished loading the page's markup; before that, leaving edit mode saves nothing. */
let editLoaded = false;
/** fabric JSON of the edit canvas right after loading: leaving edit mode without changes saves nothing. */
let editSnapshot: string | null = null;
let optionalContentConfig: OptionalContentConfig | undefined;
/** pdf.js viewport at scale 1 (displayed page size in points) per page. */
const pageViewports = new Map<number, pdfJs.PageViewport>();
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
const notices = useNotices();
const markupSaves = useMarkupSaves();
const { editMode } = storeToRefs(store);
const debouncedResize = _.debounce(onResize, 500);






onMounted(async () => {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("click", onClick);

  enhanceFabricPrototype();

  window.addEventListener("resize", debouncedResize);
  store.markupEditDisabled = false;
  // Closing the window while editing saves the open edit canvas first.
  markupSaves.setEditCapture(() => saveDrawnData());

  const loaded: LoadMarkupResult | null = await client.loadMarkup.query(sheetPath).catch((e: unknown) => {
    console.warn("Could not load the markup", e);
    return null;
  });
  if (unmounted) return;
  if (!loaded || loaded.writeBlock) {
    // The sheet is still shown; editing stays off, so markup that could not be read is never overwritten
    // and markup that cannot be saved is never drawn in vain.
    store.markupEditDisabled = true;
    store.editMode = false;
  }
  if (!loaded) {
    notices.show(LOAD_FAILED);
  } else if (loaded.writeBlock) {
    // On every open: the reason may have gone (or come) since the last one.
    writeBlock.value = loaded.writeBlock;
    writeBlockDialog.value = true;
  }

  currentPage.value = 1;
  pdfLoadingTask = pdfJs.getDocument({
    url: "local-resource://file.html?url=" + btoa(encodeURIComponent(sheetPath)),
    wasmUrl: new URL("wasm/", pdfJsAssetBaseUrl).toString(),
    cMapUrl: new URL("cmaps/", pdfJsAssetBaseUrl).toString(),
    standardFontDataUrl: new URL("standard_fonts/", pdfJsAssetBaseUrl).toString(),
    // Saving replaces the file, so pdf.js must hold all of it in memory instead of reading ranges later.
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
  });
  pdf = await pdfLoadingTask.promise;
  if (unmounted) return;

  // Our stamps duplicate the fabric overlay: hide their optional content group (spec section 4), but only
  // if the markup data could be read; otherwise the stamps are all there is to see of it.
  const blockReason = loaded?.writeBlock?.reason;
  const markupRead = loaded !== null && blockReason !== "encrypted" && blockReason !== "unparseable";
  if (markupRead) {
    const config = await pdf.getOptionalContentConfig();
    if (unmounted) return;
    for (const [id, group] of config) {
      if (group?.name === OCG_NAME) {
        config.setVisibility(id, false);
      }
    }
    optionalContentConfig = config;
  }

  if (loaded) applyLoadedMarkup(loaded);

  await renderPdf();

});

onBeforeUnmount(() => {
  unmounted = true;
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("click", onClick);
  window.removeEventListener("resize", debouncedResize);
  // Unsaved changes stay in the markupSaves store and are retried there; an open edit canvas is queued.
  saveDrawnData();
  markupSaves.setEditCapture(null);
  store.markupEditDisabled = false;
})

/**
 * Shows the markup saved in the PDF (a `.data` file next to it is ignored: the migration gate moved it
 * before any sheet opens). Unsaved changes of an earlier visit take precedence and are retried.
 */
function applyLoadedMarkup(loaded: LoadMarkupResult): void {
  if (loaded.source === "pdf") {
    for (const { page, rect, payload } of loaded.pages) {
      markupPages.set(page, { rect, payload });
    }
  }
  const pending = markupSaves.queue.pendingPages(sheetPath);
  for (const [page, state] of pending) {
    if (state) markupPages.set(page, state);
    else markupPages.delete(page);
  }
  if (pending.size > 0) void markupSaves.queue.save(sheetPath);
}

/** Rect (PDF user space) -> normalized viewport rectangle at scale 1; null stays null. */
function viewRectOf(rect: Rect | null, viewport: pdfJs.PageViewport): Rect | null {
  if (!rect) return null;
  // pdf.js 6 has no convertToViewportRectangle; rotations are multiples of 90°, so two corners suffice.
  const [x0, y0] = viewport.convertToViewportPoint(rect[0], rect[1]) as [number, number];
  const [x1, y1] = viewport.convertToViewportPoint(rect[2], rect[3]) as [number, number];
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

/**
 * fabric JSON of `entry` in the pixels of a canvas covering the whole page. `canvasWidth`/`canvasHeight`
 * are its real integer size (the canvas attributes set from the truncated CSS size of the page; fabric's
 * logical size, unaffected by retina scaling).
 */
function fabricJsonForDisplay(
  entry: MarkupEntry,
  viewport: pdfJs.PageViewport,
  canvasWidth: number,
  canvasHeight: number,
) {
  // Turned along if another program rotated the page after the markup was saved.
  const payload = rotatePayload(entry.payload, viewport.rotation);
  return transformFabricJson(
    payload.fabric,
    displayTransform(viewRectOf(entry.rect, viewport), payload, viewport, canvasWidth, canvasHeight),
  );
}

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
  const sheetViewerWrapper = document.getElementById("sheetViewerWrapper");
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
  // Not while the sheet is still loading, and not if its markup could not be loaded (it would be overwritten)
  // or cannot be saved into the PDF (the hint says why).
  if (editMode && (pageNumbers.value === 0 || pagesLoaded.value !== pageNumbers.value || store.markupEditDisabled)) {
    store.editMode = false
    if (store.markupEditDisabled) notices.show(writeBlock.value ? writeBlockText(writeBlock.value) : LOAD_FAILED);
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

function togglePencilAndMarkerMode(): void {
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

  const textbox = new fabric.FabricText(text.value, {
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

  const iconObject = new fabric.FabricText(icon.code, {
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
  const group: any[] = [];

  fabric.loadSVGFromURL(
    getImgUrl(svg.file),
    () => {
      const loadedObjects = new fabric.Group(group);

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
    }
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

/** Edit canvas JSON as saved (the custom `__isText` flag included). */
const editCanvasJson = (canvas: fabric.Canvas) => canvas.toObject(["__isText"]) as { objects: unknown[] };

/**
 * Queues the edit canvas of the current page for saving. Nothing happens before the canvas has loaded
 * the page's markup (an empty canvas would delete it) or when nothing changed since loading.
 */
function saveDrawnData(): void {
  if (!editFabric || !editLoaded) return;
  const page = currentPage.value;
  const viewport = pageViewports.get(page);
  if (!viewport || !editFabric.width || !editFabric.height) return;
  // A multi-selection holds its objects relative to itself; serialize them in canvas coordinates.
  editFabric.discardActiveObject();
  const fabricJson = editCanvasJson(editFabric);
  const snapshot = JSON.stringify(fabricJson);
  if (snapshot === editSnapshot) return;
  editSnapshot = snapshot;

  if (fabricJson.objects.length === 0) {
    markupPages.delete(page);
    markupSaves.queue.setPage(sheetPath, page, null);
  } else {
    const entry = { rect: null, payload: payloadFromCanvas(fabricJson, editFabric.width, editFabric.height, viewport) };
    markupPages.set(page, entry);
    markupSaves.queue.setPage(sheetPath, page, entry);
  }
}

function setEditMode(newEditState: Partial<EditState>): void {
  const currentEditState = getEditMode();
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
  editLoaded = false;
  editSnapshot = null;
  const sheetViewerWrapper = document.getElementById(sheetViewerWrapperId);

  const currentPageCanvas =
    sheetViewerWrapper?.querySelector<HTMLCanvasElement>(
      `canvas[data-page="${currentPage.value}"]`
    );

  const editCanvas = document.createElement("canvas") as HTMLCanvasElement;
  editCanvas.className = editCanvasId;

  editCanvas.height = parseFloat(currentPageCanvas?.style.height || "") || 0;
  editCanvas.width = parseFloat(currentPageCanvas?.style.width || "") || 0;
  editCanvas.style.height = currentPageCanvas?.style.height || "0px";
  editCanvas.style.width = currentPageCanvas?.style.width || "0px";

  const canvasWrapper = document.querySelector<HTMLDivElement>(
    `#${sheetViewerWrapperId} > .canvasWrapper`
  );
  canvasWrapper?.appendChild(editCanvas);

  const currentPageData = markupPages.get(currentPage.value);
  const viewport = pageViewports.get(currentPage.value);

  editFabric = new fabric.Canvas(editCanvas, {
    isDrawingMode: false,
  });
  startInteractiveMode();
  const handleSelection = () => {
    if (!editFabric) return;
    if (editFabric.getActiveObjects().length > 1) {
      const groupSelector = editFabric.getActiveObject()
      if (groupSelector) {
        setDefaultPropsOnFabricObject(groupSelector, () => { }, true)
        groupSelector.setCoords()
        editFabric.renderAll();
      }
    }
    checkFabButtonLocation();
  };


  const checkFabButtonLocation = () => {
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

  const canvas = editFabric;
  if (currentPageData && viewport) {
    const fabricJson = fabricJsonForDisplay(currentPageData, viewport, canvas.width, canvas.height);
    await loadMarkupFonts();
    // Edit mode may have been left (or re-entered with a new canvas) meanwhile.
    if (editFabric !== canvas) return;
    try {
      await canvas.loadFromJSON(fabricJson);
    } catch (e) {
      if (editFabric !== canvas) return;
      // Not marked as loaded: leaving edit mode will not overwrite the page's markup.
      console.warn("Could not load the page's markup into the edit canvas", e);
      notices.show(PAGE_LOAD_FAILED);
      return;
    }
    if (editFabric !== canvas) return;
    canvas.renderAll();
  }
  editSnapshot = JSON.stringify(editCanvasJson(canvas));
  editLoaded = true;
}

function removeFabricCanvas(): void {
  editFabric?.dispose();
  editFabric = undefined;
  editLoaded = false;
  editSnapshot = null;

  const sheetViewerWrapper = document.getElementById(sheetViewerWrapperId);
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

  const $wrapper = document.getElementById(
    "sheetViewerWrapper"
  ) as HTMLDivElement;

  const entries = [...markupPages.entries()].sort(([a], [b]) => a - b);
  for (const [pageNumber, entry] of entries) {
    const viewport = pageViewports.get(pageNumber);
    const canvas = $wrapper?.querySelector(
      'canvas[data-page="' + pageNumber + '"]'
    ) as HTMLCanvasElement | null;
    if (!viewport || !canvas) continue;
    const halfPageCanvas = $wrapper?.querySelector(
      'canvas[data-page="' + (pageNumber - 0.5) + '"]'
    ) as HTMLCanvasElement;

    await createOverlay(canvas, entry, viewport, false);
    if (halfPageCanvas) {
      await createOverlay(halfPageCanvas, entry, viewport, true);
    }
    setOverlayVisible();
  }
}

async function createOverlay(
  canvas: HTMLCanvasElement,
  entry: MarkupEntry,
  viewport: pdfJs.PageViewport,
  isHalfPage: boolean
): Promise<void> {
  const zIndex = canvas.style.zIndex;
  const width = parseFloat(canvas.style.width);
  const height = parseFloat(canvas.style.height);
  const pageNumber = canvas.getAttribute("data-page");

  const overlayCanvas = document.createElement("canvas");

  overlayCanvas.style.zIndex = zIndex;
  overlayCanvas.style.width = width + "px";
  overlayCanvas.style.height = height + "px";
  overlayCanvas.height = height;
  overlayCanvas.width = width;

  overlayCanvas.setAttribute("data-page-overlay", pageNumber || "");

  overlayCanvas.classList.add("pageCanvas", "overlayCanvas");

  canvas.insertAdjacentElement("afterend", overlayCanvas);

  const overlayFabric = new fabric.StaticCanvas(overlayCanvas);
  await overlayFabric.loadFromJSON(fabricJsonForDisplay(entry, viewport, overlayFabric.width, overlayFabric.height));


  overlayFabric.renderAll();
  if (isHalfPage) {
    const height = overlayFabric.getHeight() / 2;
    const width = overlayFabric.getWidth();
    overlayFabric.getContext().clearRect(0, height, width, height);
  }

  overlayFabrics.push(overlayFabric);
}

async function renderPdf(): Promise<void> {
  if (!pdfLoadingTask || unmounted) {
    return;
  }
  pdf = await pdfLoadingTask.promise;
  if (unmounted) return;
  pageNumbers.value = pdf?.numPages || 0;
  pagesLoaded.value = 0;

  setTimeout(() => {
    if (unmounted) return;
    const $wrapper = document.getElementById(
      "sheetViewerWrapper"
    ) as HTMLDivElement;
    const renderingPromises = [];
    for (let i = 1; i <= pageNumbers.value; i++) {
      const $canvas = $wrapper?.querySelector(
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
      const pageNumber = parseFloat(
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
  const scaling = 4;
  const page = await pdf.getPage(pageNumber);
  const scale1ViewPort = page.getViewport({
    scale: 1,
  });

  let scale = $wrapper.clientHeight / scale1ViewPort.height;

  let windowViewport = page.getViewport({ scale });

  if (windowViewport.width > $wrapper.clientWidth) {
    scale = $wrapper.clientWidth / scale1ViewPort.width;
    windowViewport = page.getViewport({ scale });
  }
  const viewport = scale1ViewPort;
  pageViewports.set(pageNumber, scale1ViewPort);

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
    canvas: $canvas,
    canvasContext,
    viewport,
    background: "#ffffff",
    // Hides our stamps (spec section 4); other annotations are rendered as before.
    optionalContentConfigPromise: optionalContentConfig ? Promise.resolve(optionalContentConfig) : undefined,
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
  const originalCanvas = $wrapper?.querySelector(
    'canvas[data-page="' + pageNumber + '"]'
  ) as HTMLCanvasElement;
  if (pageNumber === 1) {
    return Promise.resolve(pageNumber);
  }
  const halfPageCanvas = $wrapper?.querySelector(
    'canvas[data-page="' + (pageNumber - 0.5) + '"]'
  ) as HTMLCanvasElement;
  halfPageCanvas.height = originalCanvas.height;
  halfPageCanvas.width = originalCanvas.width;
  halfPageCanvas.style.height = originalCanvas.style.height;
  halfPageCanvas.style.width = originalCanvas.style.width;

  const halfPageContext = halfPageCanvas.getContext("2d");
  halfPageContext?.drawImage(originalCanvas, 0, 0);

  const backdrop = $wrapper?.querySelector(
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
      const height = originalCanvas.height / 2;
      const width = originalCanvas.width;
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
  z-index: 99;
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
