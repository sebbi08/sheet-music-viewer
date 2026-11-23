import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, expect, test } from "vitest";
import { makePdf } from "../pdfMarkup/fixtures";
import { repoRoot } from "./corpus";
import { type AppUnderTest, currentApp, openSheet, type SheetSession } from "./electronDriver";

/**
 * The movable page divider (spec 2026-11-23) end to end, headless, on synthetic folders below
 * test-results/visual/work/ (no corpus needed): the first step of a page turn is cut at the stored divider
 * (page image, backdrop, red marks), in the middle without one, also after a resize.
 * The driver's default `SMV_DISABLE_BULK_MIGRATION=1` lets every folder count as migrated.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
/** The cut line separates the backdrop from the rest of the page by a 5 px strip. */
const STRIP_PX = 5;

let app: AppUnderTest;
let pdfBytes: Uint8Array;
/** Everything a test created: removed after each test, also when it failed. */
const cleanups: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  app = await currentApp();
  pdfBytes = await makePdf({ pages: 3, xref: "table" });
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
  const folder = fs.mkdtempSync(path.join(workDir, "page-divider-"));
  cleanups.push(() => {
    if (!isBelow(fs.realpathSync(workDir), fs.realpathSync(folder))) throw new Error(`not a work folder: ${folder}`);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(folder, "a.pdf"), pdfBytes);
  return folder;
}

/** Writes `.config.json` with the divider of the turn 1 -> 2 at 0.7; returns its bytes. */
function storeDivider(folder: string): Buffer {
  const config = { version: 1, sheets: { "a.pdf": { pageDividers: { "1": 0.7 } } } };
  fs.writeFileSync(path.join(folder, ".config.json"), JSON.stringify(config, null, 2));
  return fs.readFileSync(path.join(folder, ".config.json"));
}

/** Opens `a.pdf` in a fresh app (temporary profile); the app is closed after the test. */
async function open(folder: string): Promise<SheetSession> {
  const session = await openSheet(app, folder, "a.pdf");
  cleanups.push(() => session.close());
  return session;
}

test("without a divider the cut is in the middle", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const session = await open(folder);

  for (const turn of [1, 2]) {
    const cut = await session.cutState(turn);
    expect(cut.ratio, `ratio of turn ${turn}`).toBeCloseTo(0.5, 3);
    expect(Math.abs(cut.backdropPx - (cut.pageHeightPx / 2 + STRIP_PX)), `backdrop of turn ${turn}`).toBeLessThanOrEqual(1);
  }
  expect(fs.existsSync(path.join(folder, ".config.json")), ".config.json after opening").toBe(false);
  expect(session.networkRequests()).toEqual([]);
});

test("a stored divider cuts the first step and moves the red marks", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const configBytes = storeDivider(folder);
  const session = await open(folder);

  const first = await session.cutState(1);
  expect(first.ratio, "ratio of turn 1").toBeCloseTo(0.7, 3);
  expect(Math.abs(first.backdropPx - (0.7 * first.pageHeightPx + STRIP_PX)), "backdrop of turn 1").toBeLessThanOrEqual(1);
  expect(first.marksTopPx, "marks on page 1").not.toBeNull();

  // Page 2 has no divider for its turn: its marks are where they always were.
  await session.gotoPage(2);
  const second = await session.cutState(2);
  expect(second.ratio, "ratio of turn 2").toBeCloseTo(0.5, 3);
  expect(Math.abs(second.backdropPx - (second.pageHeightPx / 2 + STRIP_PX)), "backdrop of turn 2").toBeLessThanOrEqual(1);
  expect(second.marksTopPx, "marks on page 2").not.toBeNull();
  expect(
    Math.abs((first.marksTopPx as number) - (second.marksTopPx as number) - 0.2 * first.pageHeightPx),
    "marks on page 1 lower by 0.2 of the page height",
  ).toBeLessThanOrEqual(1);

  expect(fs.readFileSync(path.join(folder, ".config.json")).equals(configBytes), ".config.json unchanged").toBe(true);
  expect(session.networkRequests()).toEqual([]);
});

test("the cut follows the divider after a resize", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  storeDivider(folder);
  const session = await open(folder);
  const before = await session.cutState(1);
  expect(before.ratio, "ratio before the resize").toBeCloseTo(0.7, 3);

  await session.resizeContent(1000, 1300);
  const after = await session.cutState(1);
  expect(after.pageHeightPx, "page height after the resize").not.toBeCloseTo(before.pageHeightPx, 0);
  expect(after.ratio, "ratio after the resize").toBeCloseTo(0.7, 3);
  expect(Math.abs(after.backdropPx - (0.7 * after.pageHeightPx + STRIP_PX)), "backdrop after the resize").toBeLessThanOrEqual(1);
  expect(session.networkRequests()).toEqual([]);
});
