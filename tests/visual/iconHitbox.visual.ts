import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeAll, expect, test } from "vitest";
import { saveMarkupToFile } from "../../src/pdfMarkup/markupFile";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { makePdf, makePng } from "../pdfMarkup/fixtures";
import { repoRoot } from "./corpus";
import { type AppUnderTest, currentApp, openSheet, type SheetSession } from "./electronDriver";

/**
 * The box of a music symbol on the edit canvas lies around its glyph (`src/markup/iconBounds.ts`), headless,
 * on a synthetic folder below test-results/visual/work/ (no corpus needed): a symbol saved before (the
 * accent „>“, whose fabric box is many times its glyph) is not grabbed beside its glyph inside that box, is
 * grabbed on its glyph, and is saved with fabric's own box, moved only by the drag on the glyph. Symbols
 * draw with the bundled Noto Music (`loadMarkupFonts`), in the view and in edit mode.
 * The driver's default `SMV_DISABLE_BULK_MIGRATION=1` lets every folder count as migrated.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
/** Page size of the fixture in points. */
const PAGE = { width: 595, height: 842 };

/** The accent as the app saves it (font size 1, ×50), its box centred at (300, 400) points. */
const ACCENT = {
  type: "Text",
  version: "7.4.0",
  originX: "center",
  originY: "center",
  left: 300,
  top: 400,
  width: 2,
  height: 1.13,
  fill: "red",
  strokeWidth: 1,
  scaleX: 50,
  scaleY: 50,
  text: "\u{1D17B}",
  fontSize: 1,
  fontWeight: 500,
  fontFamily: "noto-icons",
};

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

/** A fresh folder below workDir with `a.pdf` holding `objects` on page 1, removed after the test. */
async function newFolder(objects: object[]): Promise<string> {
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "icon-hitbox-"));
  cleanups.push(() => {
    if (!isBelow(fs.realpathSync(workDir), fs.realpathSync(folder))) throw new Error(`not a work folder: ${folder}`);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const pdf = path.join(folder, "a.pdf");
  fs.writeFileSync(pdf, pdfBytes);
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

type Saved = Record<string, unknown> & { left: number; top: number };

async function savedObjects(pdf: string): Promise<Saved[]> {
  const doc = await PDFDocument.load(fs.readFileSync(pdf), { updateMetadata: false });
  const page = readMarkup(doc).pages.find((p) => p.page === 1);
  return (page?.payload.fabric.objects ?? []) as Saved[];
}

/** Bounds of the red pixels of the edit canvas in a square of 2 × `radius` around `at` (canvas px). */
async function redInk(session: SheetSession, at: { x: number; y: number }, radius: number) {
  const x0 = Math.round(at.x - radius);
  const y0 = Math.round(at.y - radius);
  const side = 2 * radius;
  return redBounds(await session.editCanvasPixels(x0, y0, side, side), side, side, x0, y0);
}

/** Bounds of the red pixels in RGBA `pixels` (`width` × `height`, top left at x0/y0). */
function redBounds(pixels: ArrayLike<number>, width: number, height: number, x0 = 0, y0 = 0) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 128 || pixels[i] < 128 || pixels[i + 1] > 100) continue;
      left = Math.min(left, x0 + x);
      right = Math.max(right, x0 + x + 1);
      top = Math.min(top, y0 + y);
      bottom = Math.max(bottom, y0 + y + 1);
    }
  }
  if (left === Infinity) throw new Error("no red ink around the symbol");
  return { left, top, right, bottom };
}

/** One finger drags from `from` by (dx, dy) in hand mode (canvas px at 1x). */
async function drag(session: SheetSession, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await session.touch("touchStart", [{ ...from, id: 1 }]);
  for (let i = 1; i <= 8; i++) {
    await session.touch("touchMove", [{ id: 1, x: from.x + (dx * i) / 8, y: from.y + (dy * i) / 8 }]);
  }
  await session.touch("touchEnd", []);
}

test("a symbol is grabbed on its glyph, not beside it, and saved with fabric's box", { timeout: 5 * 60_000 }, async () => {
  const folder = await newFolder([ACCENT]);
  const pdf = path.join(folder, "a.pdf");
  const session = await open(folder);
  await session.toggleEdit();
  await session.setHandMode();
  const size = await session.editCanvasSize();
  // Canvas px per point (each axis by its own canvas side, like payloadFromCanvas).
  const kx = size.width / PAGE.width;
  const ky = size.height / PAGE.height;
  const center = { x: ACCENT.left * kx, y: ACCENT.top * ky };
  const ink = await redInk(session, center, 120);

  // fabric's box of the symbol: (width + strokeWidth) × (height + strokeWidth) units, centred at left/top.
  const half = {
    x: ((ACCENT.width + ACCENT.strokeWidth) * ACCENT.scaleX * kx) / 2,
    y: ((ACCENT.height + ACCENT.strokeWidth) * ACCENT.scaleY * ky) / 2,
  };
  // Beside the glyph (beyond the padding of 8 px plus slack), still well inside fabric's box.
  const beside = { x: (ink.left + ink.right) / 2, y: ink.top - 20 };
  expect(Math.abs(beside.x - center.x), "beside the glyph, inside fabric's box (x)").toBeLessThan(half.x - 5);
  expect(Math.abs(beside.y - center.y), "beside the glyph, inside fabric's box (y)").toBeLessThan(half.y - 5);
  expect(ink.right - ink.left, "glyph narrower than a third of fabric's box").toBeLessThan((2 * half.x) / 3);

  // Beside the glyph: the symbol stays. On it: the symbol moves by exactly the drag.
  await drag(session, beside, 25, 0);
  await drag(session, { x: (ink.left + ink.right) / 2, y: (ink.top + ink.bottom) / 2 }, 40, 30);
  const moved = await redInk(session, center, 160);
  expect([moved.left - ink.left, moved.top - ink.top], "glyph moved on the canvas").toEqual([40, 30]);

  await session.toggleEdit();
  await waitUntil("save of the move", async () => (await savedObjects(pdf))[0]?.left !== ACCENT.left);
  const [saved] = await savedObjects(pdf);
  // fabric's own box is saved, unchanged apart from the move (in points).
  // (scale drifts by ~1e-6 through the canvas pixels, as for every object.)
  const { left, top, scaleX, scaleY, ...rest } = ACCENT;
  expect(saved).toMatchObject(rest);
  expect(saved.scaleX).toBeCloseTo(scaleX, 3);
  expect(saved.scaleY).toBeCloseTo(scaleY, 3);
  expect(saved.left).toBeCloseTo(left + 40 / kx, 1);
  expect(saved.top).toBeCloseTo(top + 30 / ky, 1);
  expect(saved).not.toHaveProperty("padding");
  expect(session.networkRequests()).toEqual([]);
});

test("symbols draw with the bundled Noto Music in the view and in edit mode", { timeout: 5 * 60_000 }, async () => {
  // ♮ saved like every symbol so far (font family "noto-icons"); systems fall back to fonts whose ♮ differs.
  const natural = { ...ACCENT, text: "\u266E" };
  // Noto Music's ♮ outline: x 51…306, y -213…404 of 1000 units per em (font size 1, ×50).
  const expected = { width: (0.255 * natural.scaleX), height: (0.617 * natural.scaleY) };
  const folder = await newFolder([natural]);
  const session = await open(folder);

  const view = await session.captureView(1);
  const kView = view.with.width / view.cssSize.width; // device px per CSS px
  const inView = redBounds(view.with.data, view.with.width, view.with.height);
  // CSS px per point of the displayed page.
  const viewScale = view.cssSize.width / PAGE.width;
  expect((inView.right - inView.left) / kView, "width in the view").toBeCloseTo(expected.width * viewScale, -0.5);
  expect((inView.bottom - inView.top) / kView, "height in the view").toBeCloseTo(expected.height * viewScale, -0.5);

  await session.toggleEdit();
  const size = await session.editCanvasSize();
  const kx = size.width / PAGE.width;
  const ky = size.height / PAGE.height;
  const inEdit = await redInk(session, { x: natural.left * kx, y: natural.top * ky }, 120);
  expect(inEdit.right - inEdit.left, "width in edit mode").toBeCloseTo(expected.width * kx, -0.5);
  expect(inEdit.bottom - inEdit.top, "height in edit mode").toBeCloseTo(expected.height * ky, -0.5);
  expect(session.networkRequests()).toEqual([]);
});
