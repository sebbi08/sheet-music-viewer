<template>
  <div class="canvasWrapper" ref="wrapper">
    <canvas class="pageCanvas" ref="prevPage"></canvas>
    <canvas class="pageCanvas" ref="currentPage"></canvas>
    <canvas class="pageCanvas" ref="nextPage"></canvas>
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
  startTime?: number;

  async mounted(): Promise<void> {
    this.startTime = performance.now();
    let pdfLoadingTask = pdfJs.getDocument({
      url: "local-resource://" + this.$route.params.path,
      pdfBug: true,
      verbosity: 9,
    });

    this.pdf = await pdfLoadingTask.promise;

    console.log(performance.now() - this.startTime, "pageloaded");

    this.renderPage(1, this.$refs["currentPage"] as HTMLCanvasElement);
  }

  async renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement
  ): Promise<void> {
    if (!this.pdf) {
      return;
    }
    let page = await this.pdf.getPage(pageNumber);
    let scale1ViewPort = page.getViewport({
      scale: 1,
    } as ViewportParameters);
    let wrapper = this.$refs.wrapper as HTMLDivElement;
    let scale = wrapper.clientHeight / scale1ViewPort.height;
    const viewport = page.getViewport({ scale } as ViewportParameters);

    // Prepare canvas using PDF page dimensions

    canvas.height = viewport.height;
    canvas.width = viewport.width;
    canvas.style.height = viewport.height + "px";
    canvas.style.width = viewport.width + "px";

    // Render PDF page into canvas context
    const canvasContext = canvas.getContext("2d");
    const renderContext = {
      canvasContext,
      viewport,
      background: "#ffffff",
    } as PDFRenderParams;
    console.log(performance.now() - (this.startTime ?? 0), "render start");
    await page
      .render(renderContext)
      .promise.then(() => console.log("Page rendered"));
    console.log(performance.now() - (this.startTime ?? 0), "render end");
  }
}
</script>

<style scoped>
.canvasWrapper {
  height: 100%;
  position: relative;
}

.pageCanvas {
  position: absolute;
  transform: translateX(-50%);
  left: 50%;
  right: 0;
  top: 0;
  bottom: 0;
}
</style>
