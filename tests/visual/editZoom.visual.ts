import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { afterEach, beforeAll, expect, test } from "vitest";
import { type Point, viewCenter, wheelZoomFactor } from "../../src/markup/editZoom";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { makePdf } from "../pdfMarkup/fixtures";
import { repoRoot } from "./corpus";
import { type AppUnderTest, currentApp, openSheet, type SheetSession } from "./electronDriver";

/**
 * Zooming in edit mode with the mouse wheel (spec 2026-11-23-edit-zoom) end to end, headless, on synthetic
 * folders below test-results/visual/work/ (no corpus needed): Ctrl + wheel zooms the page and not the app,
 * the page picture becomes sharp, a stroke drawn zoomed is saved where it would be unzoomed, zooming alone
 * saves nothing, „ganze Seite“, new symbols at the centre of the visible area, a resize resets the zoom and
 * marks stay sharp at 10x.
 * The driver's default `SMV_DISABLE_BULK_MIGRATION=1` lets every folder count as migrated.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
/** Page size of the fixture in points. */
const PAGE = { width: 595, height: 842 };
/** More than the wait before the sharp render (200 ms) plus the render itself. */
const SHARP_WAIT_MS = 500;

/** A black square on page 1 of `squarePdf`: its top left corner in displayed PDF points (y down). */
const SQUARE = { left: 500, top: 300, width: 30, height: 40 };

let app: AppUnderTest;
let pdfBytes: Uint8Array;
/** One A4 page with the black SQUARE: a sharp page feature at a known position. */
let squarePdf: Uint8Array;
/** Everything a test created: removed after each test, also when it failed. */
const cleanups: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  app = await currentApp();
  pdfBytes = await makePdf({ pages: 3, xref: "table" });
  const doc = await PDFDocument.create();
  doc.addPage([PAGE.width, PAGE.height]).drawRectangle({
    x: SQUARE.left,
    y: PAGE.height - SQUARE.top - SQUARE.height,
    width: SQUARE.width,
    height: SQUARE.height,
    color: rgb(0, 0, 0),
  });
  squarePdf = await doc.save({ useObjectStreams: false });
}, 15 * 60_000);

afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (e) {
      errors.push(e);
    }
  }
  if (errors.length > 0) throw errors[0];
}, 3 * 60_000); // closing an app may take the driver's full close timeout

const isBelow = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** A fresh folder below workDir with `a.pdf` (3 pages), removed after the test. */
function newFolder(): string {
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "edit-zoom-"));
  cleanups.push(() => {
    if (!isBelow(fs.realpathSync(workDir), fs.realpathSync(folder))) throw new Error(`not a work folder: ${folder}`);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(folder, "a.pdf"), pdfBytes);
  return folder;
}

/** Opens `a.pdf` in a fresh app (temporary profile); the app is closed after the test. */
async function open(folder: string): Promise<SheetSession> {
  const session = await openSheet(app, folder, "a.pdf");
  cleanups.push(() => session.close());
  return session;
}

async function waitUntil(what: string, probe: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SavedObject = {
  type?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  strokeWidth?: number;
};

/** The objects saved in the PDF for page 1 (empty without markup). */
async function savedObjects(pdf: string): Promise<SavedObject[]> {
  const doc = await PDFDocument.load(fs.readFileSync(pdf), { updateMetadata: false });
  const page = readMarkup(doc).pages.find((p) => p.page === 1);
  return (page?.payload.fabric.objects ?? []) as SavedObject[];
}

/** Ctrl + wheel at `at` until the zoom is `target` (each event zooms at most by the wheel's limit). */
async function zoomTo(session: SheetSession, target: number, at: Point): Promise<void> {
  const unit = -Math.log(wheelZoomFactor(1)); // zoom exponent per unit of deltaY
  for (let i = 0; i < 30; i++) {
    const exponent = Math.log(target / (await session.editZoom()));
    if (Math.abs(exponent) < 1e-6) return;
    await session.ctrlWheel(at, Math.max(-200, Math.min(200, -exponent / unit)));
  }
  throw new Error(`could not zoom to ${target}`);
}

/** Bounding box of a saved object in PDF points: [left, top, width, height]. */
const boxOf = (o: SavedObject) => [o.left, o.top, o.width * o.scaleX, o.height * o.scaleY];

test("ctrl+wheel zooms the page, not the app, and the picture becomes sharp", { timeout: 5 * 60_000 }, async () => {
  const session = await open(newFolder());
  const before = await session.appZoom();
  await session.toggleEdit();
  const size = await session.editCanvasSize();

  await session.ctrlWheel({ x: size.width / 2, y: size.height / 2 }, -400);
  const zoom = await session.editZoom();
  expect(zoom, "edit zoom").toBeGreaterThan(1);
  expect(await session.appZoom(), "the app does not zoom").toEqual(before);

  await sleep(SHARP_WAIT_MS);
  const picture = await session.zoomPicture();
  expect(picture.width, "picture width").toBe(Math.round(picture.cssWidth * before.devicePixelRatio));
  expect(picture.height, "picture height").toBe(Math.round(picture.cssHeight * before.devicePixelRatio));
  expect(picture.zoom, "zoom of the sharp picture").toBe(zoom);
  expect(session.networkRequests()).toEqual([]);
});

test(
  "a stroke drawn zoomed is saved where it would be unzoomed, also when leaving with the back arrow",
  { timeout: 5 * 60_000 },
  async () => {
    const stroke = [
      { x: 200, y: 300 },
      { x: 230, y: 320 },
      { x: 260, y: 340 },
    ];

    const folderA = newFolder();
    const unzoomed = await open(folderA);
    await unzoomed.toggleEdit();
    await unzoomed.startDrawing();
    await unzoomed.drawStroke(stroke);
    await unzoomed.toggleEdit();
    await waitUntil("save of the unzoomed stroke", async () => (await savedObjects(path.join(folderA, "a.pdf"))).length > 0);

    const folderB = newFolder();
    const zoomed = await open(folderB);
    await zoomed.toggleEdit();
    await zoomed.startDrawing();
    await zoomTo(zoomed, 4, { x: 230, y: 320 });
    const view = await zoomed.editView();
    expect(view.zoom, "zoom").toBeCloseTo(4, 3);
    await zoomed.drawStroke(stroke.map((p) => ({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y })));
    await zoomed.leaveSheet();
    await waitUntil("save of the zoomed stroke", async () => (await savedObjects(path.join(folderB, "a.pdf"))).length > 0);

    const [a] = await savedObjects(path.join(folderA, "a.pdf"));
    const [b] = await savedObjects(path.join(folderB, "a.pdf"));
    expect(a.type, "unzoomed object").toMatch(/path/i);
    expect(b.type, "zoomed object").toMatch(/path/i);
    const boxA = boxOf(a);
    const boxB = boxOf(b);
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(boxA[i] - boxB[i]), `box ${JSON.stringify(boxA)} vs ${JSON.stringify(boxB)}`).toBeLessThanOrEqual(1);
    }
    expect(b.strokeWidth, "stroke width").toBe(a.strokeWidth);
    expect(zoomed.networkRequests()).toEqual([]);
  },
);

test("zooming alone saves nothing", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  // A stroke first, so the edit canvas loads markup when it opens again.
  await session.toggleEdit();
  await session.startDrawing();
  await session.drawStroke([
    { x: 300, y: 300 },
    { x: 400, y: 380 },
  ]);
  await session.toggleEdit();
  await waitUntil("save of the stroke", async () => (await savedObjects(pdf)).length > 0);
  const saved = fs.readFileSync(pdf);

  await session.toggleEdit();
  await zoomTo(session, 3, { x: 350, y: 340 });
  await session.wheel(40, 120);
  await sleep(SHARP_WAIT_MS);
  await session.toggleEdit();
  await sleep(2000);
  expect(fs.readFileSync(pdf).equals(saved), "PDF bytes unchanged").toBe(true);
  expect(session.networkRequests()).toEqual([]);
});

test("zoom-fit returns to the whole page and the next edit starts at 1x", { timeout: 5 * 60_000 }, async () => {
  const session = await open(newFolder());
  await session.toggleEdit();
  expect(await session.zoomFitShown(), "button at 1x").toBe(false);
  await session.ctrlWheel({ x: 300, y: 300 }, -400);
  expect(await session.zoomFitShown(), "button zoomed").toBe(true);
  expect(await session.zoomPictureShown(), "picture zoomed").toBe(true);

  await session.zoomFit();
  expect(await session.editZoom(), "zoom after the button").toBe(1);
  expect(await session.editView(), "view after the button").toEqual({ zoom: 1, x: 0, y: 0 });
  expect(await session.zoomPictureShown(), "picture after the button").toBe(false);
  expect(await session.zoomFitShown(), "button after the button").toBe(false);

  // Leaving edit mode zoomed: the next edit starts at 1x.
  await session.ctrlWheel({ x: 300, y: 300 }, -400);
  expect(await session.editZoom(), "zoomed again").toBeGreaterThan(1);
  await session.toggleEdit();
  await session.toggleEdit();
  expect(await session.editZoom(), "zoom when editing again").toBe(1);
  expect(await session.zoomFitShown(), "button when editing again").toBe(false);
  expect(await session.zoomPictureShown(), "picture when editing again").toBe(false);
  expect(session.networkRequests()).toEqual([]);
});

test("a new symbol appears at the centre of the visible area", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  const size = await session.editCanvasSize();
  await zoomTo(session, 4, { x: 100, y: 100 });
  const view = await session.editView();
  const center = viewCenter(view, size);

  await session.addText("centre");
  await session.toggleEdit();
  await waitUntil("save of the text", async () => (await savedObjects(pdf)).length > 0);
  const [text] = await savedObjects(pdf);
  // Payload points per canvas px (payloadFromCanvas scales each axis by its own canvas side).
  const sx = PAGE.width / size.width;
  const sy = PAGE.height / size.height;
  expect(Math.abs(text.left - center.x * sx), `left ${text.left} vs ${center.x * sx}`).toBeLessThanOrEqual(20 * sx);
  expect(Math.abs(text.top - center.y * sy), `top ${text.top} vs ${center.y * sy}`).toBeLessThanOrEqual(20 * sy);
  expect(session.networkRequests()).toEqual([]);
});

test("rapid wheel zooming ends with a sharp picture of the last view", { timeout: 5 * 60_000 }, async () => {
  const session = await open(newFolder());
  await session.toggleEdit();
  for (const at of [
    { x: 300, y: 300 },
    { x: 320, y: 340 },
    { x: 360, y: 380 },
  ]) {
    await session.ctrlWheel(at, -300);
    await sleep(50);
  }
  await sleep(600);
  const picture = await session.zoomPicture();
  expect(picture.zoom, "zoom of the sharp picture").toBe(await session.editZoom());
  expect(session.networkRequests()).toEqual([]);
});

test("a resize while zoomed returns to the whole page", { timeout: 5 * 60_000 }, async () => {
  const session = await open(newFolder());
  await session.toggleEdit();
  await session.ctrlWheel({ x: 300, y: 300 }, -400);
  expect(await session.editZoom(), "zoomed").toBeGreaterThan(1);

  await session.resizeContent(1000, 1300, { whileEditing: true });
  expect(await session.editZoom(), "zoom after the resize").toBe(1);
  expect(await session.zoomPictureShown(), "picture after the resize").toBe(false);
  expect(session.networkRequests()).toEqual([]);
});

test("marks stay sharp at 10x", { timeout: 5 * 60_000 }, async () => {
  const session = await open(newFolder());
  await session.toggleEdit();
  await session.startDrawing();
  // A long diagonal stroke: its bounding box is far too large for fabric's object cache at 10x.
  const from = { x: 150, y: 250 };
  const to = { x: 800, y: 900 };
  await session.drawStroke([from, to]);
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  await zoomTo(session, 10, middle);
  await sleep(SHARP_WAIT_MS);

  // One pixel column across the stroke at the zoom centre (device px = CSS px, the driver forces 1x).
  const view = await session.editView();
  const x = Math.round(middle.x * view.zoom + view.x);
  const y = Math.round(middle.y * view.zoom + view.y);
  const span = 80;
  const pixels = await session.editCanvasPixels(x, y - span, 1, 2 * span);
  const alpha = Array.from({ length: 2 * span }, (_, i) => pixels[i * 4 + 3]);
  const inked = alpha.map((a) => a >= 0.95 * 255);
  const first = inked.indexOf(true);
  const last = inked.lastIndexOf(true);
  expect(first, `stroke in the column: ${alpha.join(",")}`).toBeGreaterThan(0);
  // Pixels between background (< 5 %) and the stroke colour (>= 95 %) on each edge.
  const partial = (from: number, step: number) => {
    let count = 0;
    for (let i = from; i >= 0 && i < alpha.length && alpha[i] >= 0.05 * 255 && alpha[i] < 0.95 * 255; i += step) count++;
    return count;
  };
  expect(partial(first - 1, -1), `upper edge: ${alpha.join(",")}`).toBeLessThanOrEqual(3);
  expect(partial(last + 1, 1), `lower edge: ${alpha.join(",")}`).toBeLessThanOrEqual(3);
  expect(session.networkRequests()).toEqual([]);
});

test("the zoomed page lies exactly where marks are saved", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  fs.writeFileSync(path.join(folder, "a.pdf"), squarePdf);
  const session = await open(folder);
  await session.toggleEdit();
  const size = await session.editCanvasSize();
  // The square's corner in canvas points under the mapping of the save (payloadFromCanvas: a canvas point p
  // is saved at p * page size / edit canvas size, each axis on its own).
  const corner = { x: (SQUARE.left * size.width) / PAGE.width, y: (SQUARE.top * size.height) / PAGE.height };
  await zoomTo(session, 10, corner);
  await sleep(SHARP_WAIT_MS);
  const view = await session.editView();
  expect((await session.zoomPicture()).zoom, "sharp picture").toBe(view.zoom);

  // Where a mark at the corner is drawn on screen (CSS px relative to the edit canvas, = device px at 1x).
  const expected = { x: corner.x * view.zoom + view.x, y: corner.y * view.zoom + view.y };
  const dark = (data: number[], i: number) => data[i * 4 + 3] === 255 && data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] < 3 * 128;
  const span = 40;
  const x0 = Math.round(expected.x) - span;
  const row = await session.zoomPicturePixels(x0, Math.round(expected.y) + 40, 2 * span, 1);
  const left = Array.from({ length: 2 * span }, (_, i) => dark(row.data, i)).indexOf(true);
  const y0 = Math.round(expected.y) - span;
  const column = await session.zoomPicturePixels(Math.round(expected.x) + 40, y0, 1, 2 * span);
  const top = Array.from({ length: 2 * span }, (_, i) => dark(column.data, i)).indexOf(true);
  expect(left, "square's left edge in the row").toBeGreaterThan(0);
  expect(top, "square's top edge in the column").toBeGreaterThan(0);
  const edge = { x: row.offsetX + x0 + left, y: column.offsetY + y0 + top };
  console.log(`square edge at ${edge.x}, ${edge.y}; marks at ${expected.x}, ${expected.y} (zoom ${view.zoom})`);
  expect(Math.abs(edge.x - expected.x), `left edge at ${edge.x}, marks at ${expected.x}`).toBeLessThanOrEqual(1);
  expect(Math.abs(edge.y - expected.y), `top edge at ${edge.y}, marks at ${expected.y}`).toBeLessThanOrEqual(1);
  expect(session.networkRequests()).toEqual([]);
});
