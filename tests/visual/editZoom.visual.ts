import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { afterEach, beforeAll, expect, test } from "vitest";
import { type Point, viewCenter, wheelZoomFactor } from "../../src/markup/editZoom";
import { saveMarkupToFile } from "../../src/pdfMarkup/markupFile";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { makePdf, makePng } from "../pdfMarkup/fixtures";
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
  originX?: string;
  originY?: string;
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
  // Below the edit canvas (and so below its buttons), not merely below the page canvas.
  const stacking = await session.zoomPictureStacking({ x: size.width / 2, y: size.height / 2 });
  expect(stacking.editCanvasOnTop, "edit canvas on top at the centre").toBe(true);
  expect(
    stacking.pictureZ < stacking.containerZ ||
      (stacking.pictureZ === stacking.containerZ && stacking.pictureBeforeContainer),
    `picture below the edit canvas: ${JSON.stringify(stacking)}`,
  ).toBe(true);
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

test("a symbol group stays sharp at 10x and saves no cache flag", { timeout: 5 * 60_000 }, async () => {
  // Markup holding a group, like an SVG symbol of the old app, saved in the PDF the way the app saves it
  // (points). Its child, a disc, is far too large for fabric's object cache at 10x.
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const radius = 150;
  const group = {
    type: "Group",
    originX: "left",
    originY: "top",
    left: 150,
    top: 200,
    width: 2 * radius,
    height: 2 * radius,
    objects: [{ type: "Circle", originX: "center", originY: "center", left: 0, top: 0, radius, fill: "#000000", strokeWidth: 0 }],
  };
  const saved = await saveMarkupToFile({
    path: pdf,
    pages: [
      {
        page: 1,
        payload: { version: 1, width: PAGE.width, height: PAGE.height, fabric: { version: "7", objects: [group] } },
        pngBase64: Buffer.from(makePng(300, 300)).toString("base64"),
      },
    ],
  });
  expect(saved).toEqual({ status: "pdf" });

  const session = await open(folder);
  await session.toggleEdit();
  const size = await session.editCanvasSize();
  // A point of the disc's edge inside its bounding box (an edge on the box's border would stay sharp even
  // from a cache, as the border of the cache image): 0.6 radius above and 0.8 radius left of its centre.
  const edgePt = { x: group.left + radius - 0.8 * radius, y: group.top + radius - 0.6 * radius };
  const edge = { x: (edgePt.x * size.width) / PAGE.width, y: (edgePt.y * size.height) / PAGE.height };
  await zoomTo(session, 10, edge);
  await sleep(SHARP_WAIT_MS);

  // One pixel row across the left edge (device px = CSS px, the driver forces 1x).
  const view = await session.editView();
  const x = Math.round(edge.x * view.zoom + view.x);
  const y = Math.round(edge.y * view.zoom + view.y);
  const span = 40;
  const pixels = await session.editCanvasPixels(x - span, y, 2 * span, 1);
  const alpha = Array.from({ length: 2 * span }, (_, i) => pixels[i * 4 + 3]);
  expect(alpha[0], `left of the edge: ${alpha.join(",")}`).toBeLessThan(0.05 * 255);
  expect(alpha[2 * span - 1], `right of the edge: ${alpha.join(",")}`).toBeGreaterThanOrEqual(0.95 * 255);
  const partial = alpha.filter((a) => a >= 0.05 * 255 && a < 0.95 * 255).length;
  expect(partial, `pixels between background and fill: ${alpha.join(",")}`).toBeLessThanOrEqual(3);

  // A change saves the page: the cache switch of the group and its child is not saved with it.
  await session.addText("x");
  await session.toggleEdit();
  await waitUntil("save of the change", async () => (await savedObjects(pdf)).length === 2);
  const json = JSON.stringify(await savedObjects(pdf));
  expect(json, "saved objects").not.toContain("objectCaching");
  expect(json, "saved group").toContain('"Circle"');
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

// --- Two fingers (touch through the DevTools protocol, spec 2026-11-23-edit-zoom „Bedienung“) ---

type Finger = { x: number; y: number; id: number };
/** `points` moved by (dx, dy). */
const moved = (points: Finger[], dx: number, dy: number) => points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));

/** Moves the fingers in `steps` from `from` to `to` (same ids, same order). */
async function moveFingers(session: SheetSession, from: Finger[], to: Finger[], steps = 10): Promise<void> {
  for (let i = 1; i <= steps; i++) {
    await session.touch(
      "touchMove",
      from.map((p, k) => ({ id: p.id, x: p.x + ((to[k].x - p.x) * i) / steps, y: p.y + ((to[k].y - p.y) * i) / steps })),
    );
  }
}

test("a pinch zooms and leaves no stroke", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  await session.startDrawing();
  const size = await session.editCanvasSize();
  const center = { x: size.width / 2, y: size.height / 2 };

  await session.pinch(center, 100, 300);
  const zoom = await session.editZoom();
  expect(Math.abs(zoom - 3), `zoom ${zoom}`).toBeLessThanOrEqual(0.3);

  // Also when the first finger drew a little before the second one landed (well within 300 ms).
  const first = { x: center.x - 50, y: center.y, id: 1 };
  const [drawn] = moved([first], 20, 15);
  await session.touch("touchStart", [first]);
  await moveFingers(session, [first], [drawn], 3);
  const pair = [drawn, { x: drawn.x + 100, y: drawn.y, id: 2 }];
  await session.touch("touchStart", pair);
  await moveFingers(session, pair, [...moved([pair[0]], -20, 0), ...moved([pair[1]], 20, 0)]);
  await session.touch("touchEnd", []);
  expect(await session.editZoom(), "zoomed further").toBeGreaterThan(zoom);

  await session.toggleEdit();
  await sleep(2000);
  expect(fs.readFileSync(pdf).equals(Buffer.from(pdfBytes)), "PDF bytes unchanged: no stroke saved").toBe(true);
  expect(session.networkRequests()).toEqual([]);
});

test("a slow second finger keeps the first stroke", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  await session.startDrawing();

  // Finger 1 draws for 400 ms ...
  const start = { x: 200, y: 400, id: 1 };
  await session.touch("touchStart", [start]);
  for (let i = 1; i <= 8; i++) {
    await sleep(50);
    await session.touch("touchMove", moved([start], 10 * i, 5 * i));
  }
  // ... then finger 2 lands and both spread.
  const [a] = moved([start], 80, 40);
  const pair = [a, { x: a.x + 100, y: a.y, id: 2 }];
  await session.touch("touchStart", pair);
  await moveFingers(session, pair, [...moved([pair[0]], -50, 0), ...moved([pair[1]], 50, 0)]);
  await session.touch("touchEnd", []);
  expect(await session.editZoom(), "zoomed").toBeGreaterThan(1.5);

  await session.toggleEdit();
  await waitUntil("save of the stroke", async () => (await savedObjects(pdf)).length > 0);
  await sleep(1000);
  const objects = await savedObjects(pdf);
  expect(objects.map((o) => o.type), "saved objects").toHaveLength(1);
  expect(objects[0].type, "saved object").toMatch(/path/i);
  expect(session.networkRequests()).toEqual([]);
});

test("two fingers move the zoomed view", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  const size = await session.editCanvasSize();
  const center = { x: size.width / 2, y: size.height / 2 };
  await zoomTo(session, 3, center);
  const before = await session.editView();

  const pair = [
    { x: center.x - 60, y: center.y, id: 1 },
    { x: center.x + 60, y: center.y, id: 2 },
  ];
  await session.touch("touchStart", [pair[0]]);
  await session.touch("touchStart", pair);
  await moveFingers(session, pair, moved(pair, -100, 0));
  await session.touch("touchEnd", []);
  const after = await session.editView();
  expect(after.zoom, "zoom").toBeCloseTo(before.zoom, 6);
  expect(Math.abs(after.x - (before.x - 100)), `x ${before.x} -> ${after.x}`).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y), `y ${before.y} -> ${after.y}`).toBeLessThanOrEqual(2);

  await session.toggleEdit();
  await sleep(2000);
  expect(fs.readFileSync(pdf).equals(Buffer.from(pdfBytes)), "PDF bytes unchanged").toBe(true);
  expect(session.networkRequests()).toEqual([]);
});

test("a pinch that starts on a symbol in hand mode leaves the symbol where it was", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  const size = await session.editCanvasSize();
  // A new text lies at the centre of the visible area (the whole page at 1x), selected.
  await session.addText("Pinch");
  await session.setHandMode();
  const center = { x: size.width / 2, y: size.height / 2 };

  // Finger 1 grabs the text and drags it; 100 ms after it landed, finger 2 lands and both spread.
  const first = { ...center, id: 1 };
  await session.touch("touchStart", [first]);
  const landed = Date.now();
  const [dragged] = moved([first], 40, 30);
  await moveFingers(session, [first], [dragged], 3);
  await sleep(Math.max(0, 100 - (Date.now() - landed)));
  // Finger 2 must land well within the 300 ms in which the drag of finger 1 is undone.
  expect(Date.now() - landed, "ms since finger 1 landed").toBeLessThan(250);
  const pair = [dragged, { x: dragged.x + 120, y: dragged.y, id: 2 }];
  await session.touch("touchStart", pair);
  await moveFingers(session, pair, [...moved([pair[0]], -60, 0), ...moved([pair[1]], 60, 0)]);
  await session.touch("touchEnd", []);
  expect(await session.editZoom(), "zoomed").toBeGreaterThan(1.5);

  await session.toggleEdit();
  await waitUntil("save of the text", async () => (await savedObjects(pdf)).length > 0);
  const [text] = await savedObjects(pdf);
  // Payload points per canvas px (payloadFromCanvas scales each axis by its own canvas side).
  const sx = PAGE.width / size.width;
  const sy = PAGE.height / size.height;
  expect(Math.abs(text.left - center.x * sx), `left ${text.left} vs ${center.x * sx}`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(text.top - center.y * sy), `top ${text.top} vs ${center.y * sy}`).toBeLessThanOrEqual(0.5);
  expect(session.networkRequests()).toEqual([]);
});

test("fingers do nothing while the pen is down, and zoom again once it lifted", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  await session.startDrawing();
  const size = await session.editCanvasSize();
  const center = { x: size.width / 2, y: size.height / 2 };

  await session.pen("down", { x: 200, y: 300 });
  await session.pen("move", { x: 240, y: 330 });
  await session.pinch(center, 100, 300);
  expect(await session.editZoom(), "no zoom while the pen is down").toBe(1);
  await session.pen("move", { x: 280, y: 360 });
  await session.pen("up", { x: 280, y: 360 });

  await session.pinch(center, 100, 300);
  expect(await session.editZoom(), "zoom after the pen lifted").toBeGreaterThan(2.5);

  // The pen's stroke is kept; the fingers left nothing.
  await session.toggleEdit();
  await waitUntil("save of the stroke", async () => (await savedObjects(pdf)).length > 0);
  await sleep(1000);
  const objects = await savedObjects(pdf);
  expect(objects, "saved objects").toHaveLength(1);
  expect(objects[0].type, "saved object").toMatch(/path/i);
  expect(session.networkRequests()).toEqual([]);
});

test("a single finger still draws", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  await session.startDrawing();

  const start = { x: 300, y: 300, id: 1 };
  await session.touch("touchStart", [start]);
  await moveFingers(session, [start], moved([start], 150, 100));
  await session.touch("touchEnd", []);
  expect(await session.editZoom(), "no zoom").toBe(1);

  await session.toggleEdit();
  await waitUntil("save of the stroke", async () => (await savedObjects(pdf)).length > 0);
  await sleep(1000);
  const objects = await savedObjects(pdf);
  expect(objects, "saved objects").toHaveLength(1);
  expect(objects[0].type, "saved object").toMatch(/path/i);
  expect(session.networkRequests()).toEqual([]);
});

test("a pen that arrives as touch events draws", { timeout: 5 * 60_000 }, async () => {
  // Chromium on Windows delivers a pen on the page as pen pointer events, each followed by a touch event at
  // the same point; fabric draws from the touch events. They are the pen's, not a finger's.
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  await session.startDrawing();

  await session.stylusTouch("down", { x: 200, y: 300 });
  for (let i = 1; i <= 10; i++) await session.stylusTouch("move", { x: 200 + i * 15, y: 300 + i * 10 });
  await session.stylusTouch("up", { x: 350, y: 400 });
  expect(await session.editZoom(), "no zoom").toBe(1);

  await session.toggleEdit();
  await waitUntil("save of the stroke", async () => (await savedObjects(pdf)).length > 0);
  await sleep(1000);
  const objects = await savedObjects(pdf);
  expect(objects, "saved objects").toHaveLength(1);
  expect(objects[0].type, "saved object").toMatch(/path/i);
});

test("a resting hand neither zooms nor stops a pen that arrives as touch events", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  await session.startDrawing();

  await session.stylusTouch("down", { x: 200, y: 300 });
  await session.stylusTouch("move", { x: 215, y: 310 });
  // The hand lands and moves like a pinch while the pen writes on.
  const palm = [
    { x: 400, y: 500, id: 1 },
    { x: 480, y: 560, id: 2 },
  ];
  await session.touch("touchStart", palm);
  for (let i = 2; i <= 10; i++) {
    await session.touch("touchMove", moved(palm, i * 10, i * 8));
    await session.stylusTouch("move", { x: 200 + i * 15, y: 300 + i * 10 });
  }
  await session.stylusTouch("up", { x: 350, y: 400 });
  await session.touch("touchEnd", []);
  expect(await session.editZoom(), "no zoom").toBe(1);

  await session.toggleEdit();
  await waitUntil("save of the stroke", async () => (await savedObjects(pdf)).length > 0);
  await sleep(1000);
  const objects = await savedObjects(pdf);
  expect(objects, "saved objects").toHaveLength(1);
  expect(objects[0].type, "saved object").toMatch(/path/i);
});

test("a pinch that starts on an icon of the selected text neither edits, clones nor deletes it", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  const size = await session.editCanvasSize();
  // A saved text tells where it lies and how large it is.
  await session.addText("Pinch");
  await session.toggleEdit();
  await waitUntil("save of the text", async () => (await savedObjects(pdf)).length > 0);
  const saved = fs.readFileSync(pdf);
  const [text] = await savedObjects(pdf);
  // Its box on screen at 1x (canvas px; payloadFromCanvas scales each axis by its own canvas side).
  const cx = size.width / PAGE.width;
  const cy = size.height / PAGE.height;
  const stroke = text.strokeWidth ?? 0;
  const w = (text.width + stroke) * text.scaleX * cx;
  const h = (text.height + stroke) * text.scaleY * cy;
  const mid = {
    x: text.left * cx + (text.originX === "left" ? w / 2 : 0),
    y: text.top * cy + (text.originY === "top" ? h / 2 : 0),
  };
  // The icons above the text (src/fabricEnhancements.ts): 50 px beside and above its corners.
  const icons = {
    edit: { x: mid.x, y: mid.y - h / 2 - 50 },
    clone: { x: mid.x - w / 2 - 50, y: mid.y - h / 2 - 50 },
    delete: { x: mid.x + w / 2 + 50, y: mid.y - h / 2 - 50 },
  };

  await session.toggleEdit();
  await session.setHandMode();
  // A tap selects the text.
  await session.touch("touchStart", [{ ...mid, id: 1 }]);
  await session.touch("touchEnd", []);

  /** Finger 1 lands on `at` (1x), finger 2 right after it below, and both spread. */
  async function pinchFrom(at: Point): Promise<void> {
    const pair = [
      { ...at, id: 1 },
      { x: at.x, y: at.y + 150, id: 2 },
    ];
    await session.touch("touchStart", [pair[0]]);
    await session.touch("touchStart", pair);
    await moveFingers(session, pair, [...moved([pair[0]], 0, -40), ...moved([pair[1]], 0, 40)]);
    await session.touch("touchEnd", []);
    expect(await session.editZoom(), "zoomed").toBeGreaterThan(1.2);
    await sleep(300); // a clone is added asynchronously
  }

  await pinchFrom(icons.edit);
  expect(await session.textDialogShown(), "text dialog after a pinch from the edit icon").toBe(false);
  await session.zoomFit();
  await pinchFrom(icons.clone);
  await session.zoomFit();
  await pinchFrom(icons.delete);

  await session.toggleEdit();
  await sleep(2000);
  expect(await savedObjects(pdf), "saved objects").toHaveLength(1);
  expect(fs.readFileSync(pdf).equals(saved), "PDF bytes unchanged").toBe(true);
  expect(session.networkRequests()).toEqual([]);
});

test("shift + wheel pans sideways, also when the wheel arrives horizontal", { timeout: 5 * 60_000 }, async () => {
  const session = await open(newFolder());
  await session.toggleEdit();
  const size = await session.editCanvasSize();
  await zoomTo(session, 3, { x: size.width / 2, y: size.height / 2 });
  const before = await session.editView();

  // The vertical delta with Shift held ...
  await session.shiftWheel(0, 50);
  const vertical = await session.editView();
  expect(vertical, "after Shift + vertical wheel").toEqual({ zoom: before.zoom, x: before.x - 50, y: before.y });
  // ... and a horizontal one, as Chromium on Windows delivers Shift + wheel.
  await session.shiftWheel(50, 0);
  const horizontal = await session.editView();
  expect(horizontal, "after Shift + horizontal wheel").toEqual({ zoom: before.zoom, x: before.x - 100, y: before.y });
  expect(session.networkRequests()).toEqual([]);
});

test("a cancelled finger ends its stroke and the next finger draws again", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  await session.startDrawing();

  const first = { x: 200, y: 300, id: 1 };
  await session.touch("touchStart", [first]);
  await moveFingers(session, [first], moved([first], 150, 100));
  await session.touch("touchCancel", []);
  const second = { x: 200, y: 600, id: 1 };
  await session.touch("touchStart", [second]);
  await moveFingers(session, [second], moved([second], 150, 100));
  await session.touch("touchEnd", []);

  await session.toggleEdit();
  await sleep(2000);
  const objects = await savedObjects(pdf);
  expect(objects.map((o) => o.type), "saved objects").toHaveLength(2);
  expect(objects.every((o) => /path/i.test(o.type ?? "")), "both paths").toBe(true);
  expect(session.networkRequests()).toEqual([]);
});

test("a finger placed again beside the remaining one goes on zooming", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  await session.startDrawing();
  const size = await session.editCanvasSize();
  const center = { x: size.width / 2, y: size.height / 2 };

  const pair = [
    { x: center.x - 50, y: center.y, id: 1 },
    { x: center.x + 50, y: center.y, id: 2 },
  ];
  await session.touch("touchStart", [pair[0]]);
  await session.touch("touchStart", pair);
  const spread = [...moved([pair[0]], -50, 0), ...moved([pair[1]], 50, 0)];
  await moveFingers(session, pair, spread);
  const zoom = await session.editZoom();
  expect(Math.abs(zoom - 2), `zoom ${zoom}`).toBeLessThanOrEqual(0.2);

  // Finger 1 lifts, finger 2 stays; a new finger lands beside it and both spread.
  await session.touch("touchEnd", [spread[0]]);
  const again = [spread[1], { x: spread[1].x - 100, y: center.y, id: 3 }];
  await session.touch("touchStart", again);
  await moveFingers(session, again, [...moved([again[0]], 50, 0), ...moved([again[1]], -50, 0)]);
  await session.touch("touchEnd", []);
  const zoomAgain = await session.editZoom();
  expect(Math.abs(zoomAgain - 2 * zoom), `zoom ${zoom} -> ${zoomAgain}`).toBeLessThanOrEqual(0.3);

  await session.toggleEdit();
  await sleep(2000);
  expect(fs.readFileSync(pdf).equals(Buffer.from(pdfBytes)), "PDF bytes unchanged: no stroke saved").toBe(true);
  expect(session.networkRequests()).toEqual([]);
});
