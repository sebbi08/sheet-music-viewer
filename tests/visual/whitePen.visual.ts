import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeAll, expect, test } from "vitest";
import { saveMarkupToFile } from "../../src/pdfMarkup/markupFile";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { makePdf, makePng } from "../pdfMarkup/fixtures";
import { repoRoot } from "./corpus";
import { type AppUnderTest, type Capture, currentApp, openSheet, type SheetSession } from "./electronDriver";

/**
 * The white pen lies below every other mark (`src/markup/whiteout.ts`), headless, on synthetic folders below
 * test-results/visual/work/ (no corpus needed): a new white stroke across a black one leaves the black one
 * visible in edit mode, in the view and in the saved order; markup saved with white above other marks shows
 * it below them and saves it that way after a change.
 * The driver's default `SMV_DISABLE_BULK_MIGRATION=1` lets every folder count as migrated.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
const PAGE = { width: 595, height: 842 };
const WHITE = "rgba(255,255,255,1)";
const BLACK = "rgba(0,0,0,1)";

let app: AppUnderTest;
let pdfBytes: Uint8Array;
const cleanups: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  app = await currentApp();
  pdfBytes = await makePdf({ pages: 1, xref: "table" });
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
}, 3 * 60_000);

const isBelow = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** A fresh folder below workDir with `a.pdf` (with `objects` on page 1, if given), removed after the test. */
async function newFolder(objects?: object[]): Promise<string> {
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "white-pen-"));
  cleanups.push(() => {
    if (!isBelow(fs.realpathSync(workDir), fs.realpathSync(folder))) throw new Error(`not a work folder: ${folder}`);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const pdf = path.join(folder, "a.pdf");
  fs.writeFileSync(pdf, pdfBytes);
  if (objects) {
    const saved = await saveMarkupToFile({
      path: pdf,
      pages: [
        {
          page: 1,
          payload: { version: 1, width: PAGE.width, height: PAGE.height, fabric: { version: "7.4.0", objects } },
          pngBase64: Buffer.from(makePng(100, 100)).toString("base64"),
        },
      ],
    });
    expect(saved).toEqual({ status: "pdf" });
  }
  return folder;
}

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

type Saved = { type?: string; stroke?: string };

async function savedObjects(pdf: string): Promise<Saved[]> {
  const doc = await PDFDocument.load(fs.readFileSync(pdf), { updateMetadata: false });
  const page = readMarkup(doc).pages.find((p) => p.page === 1);
  return (page?.payload.fabric.objects ?? []) as Saved[];
}

/** Brightness (0–255) and alpha of one pixel of the edit canvas (canvas px at 1x). */
async function editPixel(session: SheetSession, at: { x: number; y: number }) {
  const [r, g, b, a] = await session.editCanvasPixels(Math.round(at.x), Math.round(at.y), 1, 1);
  return { brightness: (r + g + b) / 3, alpha: a };
}

/** Brightness (0–255) of the view (page with markup) at a point of the page in points. */
function viewBrightness(view: Capture, at: { x: number; y: number }): number {
  const img = view.with;
  const x = Math.round((at.x / PAGE.width) * img.width);
  const y = Math.round((at.y / PAGE.height) * img.height);
  const i = (y * img.width + x) * 4;
  return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
}

test("a new white stroke across a black one lies below it", { timeout: 5 * 60_000 }, async () => {
  const folder = await newFolder();
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  await session.startDrawing();
  const size = await session.editCanvasSize();
  // Canvas px of a point of the page in points.
  const px = (p: { x: number; y: number }) => ({ x: (p.x * size.width) / PAGE.width, y: (p.y * size.height) / PAGE.height });
  const cross = { x: 250, y: 300 };

  // Black (default colour), 6 wide, horizontal; then white, 18 wide, vertical across it.
  await session.setPenSize(6);
  await session.drawStroke([px({ x: 150, y: 300 }), px({ x: 350, y: 300 })]);
  await session.setPenColor("white");
  await session.setPenSize(18);
  await session.drawStroke([px({ x: 250, y: 220 }), px({ x: 250, y: 380 })]);

  // fabric draws the finished stroke on its next frame.
  await waitUntil("the white stroke on the edit canvas", async () => (await editPixel(session, px({ x: 250, y: 350 }))).alpha > 0);
  const onWhite = await editPixel(session, px({ x: 250, y: 350 }));
  expect(onWhite, "the white stroke is drawn").toMatchObject({ alpha: 255 });
  expect(onWhite.brightness, "the white stroke is drawn").toBeGreaterThan(240);
  const atCross = await editPixel(session, px(cross));
  expect(atCross.alpha, "black at the crossing in edit mode").toBe(255);
  expect(atCross.brightness, "black at the crossing in edit mode").toBeLessThan(40);

  await session.toggleEdit();
  await waitUntil("save of both strokes", async () => (await savedObjects(pdf)).length === 2);
  expect((await savedObjects(pdf)).map((o) => o.stroke), "saved order, lowest first").toEqual([WHITE, BLACK]);
  expect(viewBrightness(await session.captureView(1), cross), "black at the crossing in the view").toBeLessThan(40);
  expect(session.networkRequests()).toEqual([]);
});

test("white saved above other marks is shown below them and saved so after a change", { timeout: 5 * 60_000 }, async () => {
  // Saved before the rule: the white stroke above the black one.
  // Placed by the centre of their path (fabric does not take the position from the path data).
  const at = { originX: "center", originY: "center", left: 250, top: 300, fill: null };
  const black = { type: "Path", path: [["M", 150, 300], ["L", 350, 300]], stroke: BLACK, strokeWidth: 6, ...at };
  const white = { type: "Path", path: [["M", 250, 220], ["L", 250, 380]], stroke: WHITE, strokeWidth: 18, ...at };
  const folder = await newFolder([black, white]);
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  const cross = { x: 250, y: 300 };

  expect(viewBrightness(await session.captureView(1), cross), "black at the crossing in the view").toBeLessThan(40);

  await session.toggleEdit();
  const size = await session.editCanvasSize();
  const atCross = await editPixel(session, { x: (cross.x * size.width) / PAGE.width, y: (cross.y * size.height) / PAGE.height });
  expect(atCross.brightness, "black at the crossing in edit mode").toBeLessThan(40);

  await session.addText("x");
  await session.toggleEdit();
  await waitUntil("save of the change", async () => (await savedObjects(pdf)).length === 3);
  expect((await savedObjects(pdf)).map((o) => o.stroke ?? o.type), "saved order, lowest first").toEqual([WHITE, BLACK, "Text"]);
  expect(session.networkRequests()).toEqual([]);
});
