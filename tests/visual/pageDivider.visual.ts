import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, expect, test } from "vitest";
import { makePdf } from "../pdfMarkup/fixtures";
import { repoRoot } from "./corpus";
import { type AppUnderTest, currentApp, launchApp, openSheet, SHEET_LOADED, type SheetSession } from "./electronDriver";
import { fifoSupported, holdFile } from "./fifo";

/**
 * The movable page divider (spec 2026-11-23) end to end, headless, on synthetic folders below
 * test-results/visual/work/ (no corpus needed): the first step of a page turn is cut at the stored divider
 * (page image, backdrop, red marks), in the middle without one, also after a resize; the divider mode
 * (drag relative to the grab, a press without movement, keys, restart, „Zur Mitte“, failed load and save,
 * no mode before the sheet settings arrived).
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

// --- the divider mode ---

/** chmod-based read-only files do not work as root or on Windows. */
const canMakeReadOnly = process.getuid?.() !== 0 && process.platform !== "win32";
const configPath = (folder: string) => path.join(folder, ".config.json");
type StoredConfig = { sheets?: Record<string, { pageDividers?: Record<string, number> }> };
const readConfig = (folder: string): StoredConfig | null =>
  fs.existsSync(configPath(folder)) ? (JSON.parse(fs.readFileSync(configPath(folder), "utf8")) as StoredConfig) : null;
/** The stored divider of the turn `page` -> `page + 1` of `a.pdf`; undefined while none is stored. */
const storedDivider = (folder: string, page: number): number | undefined =>
  readConfig(folder)?.sheets?.["a.pdf"]?.pageDividers?.[String(page)];
const threeDecimals = (value: number) => Math.round(value * 1000) / 1000 === value;
/** A key press or click that must change nothing cannot be awaited; this gives it time to show. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));
const LOAD_FAILED_PREFIX =
  "Die Seitenteiler können nicht verschoben werden: „.config.json“ kann nicht gelesen werden: ";
const SAVE_FAILED_PREFIX = "Der Seitenteiler konnte nicht gespeichert werden: ";
const SAVE_FAILED_SUFFIX = ". Er gilt nur, bis das Blatt geschlossen wird.";

/**
 * In a sheet on page 1: grabs the line of the turn 1 -> 2 `grabOffset` CSS px below its centre and drags it
 * down by 0.2 of the page height; returns the stored value.
 */
async function dragTurnOneDown(session: SheetSession, folder: string, grabOffset = 0): Promise<number> {
  const { pageHeightPx } = await session.cutState(1);
  await session.toggleDividerMode();
  expect(await session.dividerLabel(), "label on entering on page 1").toBe("Seite 1 → 2");
  await session.dragDivider(0.2 * pageHeightPx, grabOffset);
  await expect.poll(() => storedDivider(folder, 1), { timeout: 30_000 }).toBeTypeOf("number");
  const stored = storedDivider(folder, 1) as number;
  expect(Math.abs(stored - 0.7), "stored divider").toBeLessThanOrEqual(0.01);
  expect(threeDecimals(stored), `three decimals: ${stored}`).toBe(true);
  return stored;
}

test("dragging the line saves the divider, the PDF stays byte-identical", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const before = fs.readFileSync(path.join(folder, "a.pdf"));
  const session = await open(folder);
  const middle = await session.cutState(1);
  expect(middle.marksTopPx, "marks on page 1 before the drag").not.toBeNull();

  // Grabbed off-centre: a line that jumped to the pointer would end GRAB_OFFSET px lower.
  const GRAB_OFFSET = 15;
  const stored = await dragTurnOneDown(session, folder, GRAB_OFFSET);
  expect(GRAB_OFFSET / middle.pageHeightPx, "the offset is visible in the ratio").toBeGreaterThan(0.006);
  expect(
    Math.abs(stored - (0.5 + 0.2)),
    `stored ${stored} follows dy / page height, not the pointer (page ${middle.pageHeightPx} px)`,
  ).toBeLessThanOrEqual(GRAB_OFFSET / middle.pageHeightPx / 2);
  expect(fs.readFileSync(path.join(folder, "a.pdf")).equals(before), "PDF bytes unchanged").toBe(true);

  await session.toggleDividerMode();
  expect(await session.currentPage(), "page after leaving the mode").toBe(1);
  const after = await session.cutState(1);
  expect(after.ratio, "cut of turn 1 after leaving the mode").toBeCloseTo(stored, 3);
  expect(after.marksTopPx, "marks on page 1 after the drag").not.toBeNull();
  expect(
    Math.abs((after.marksTopPx as number) - (middle.marksTopPx as number) - (stored - 0.5) * middle.pageHeightPx),
    "marks moved with the cut",
  ).toBeLessThanOrEqual(1);
  expect(session.networkRequests()).toEqual([]);
});

test("a press on the line without movement writes nothing", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const session = await open(folder);
  await session.toggleDividerMode();

  await session.dragDivider(0, 15);
  await settle();
  expect((await session.cutState(1)).ratio, "cut of turn 1 after the press").toBeCloseTo(0.5, 3);
  expect(await session.dividerControlEnabled("reset"), "Zur Mitte after the press").toBe(false);
  await session.toggleDividerMode();
  expect((await session.cutState(1)).ratio, "cut of turn 1 after leaving the mode").toBeCloseTo(0.5, 3);
  expect(fs.existsSync(configPath(folder)), ".config.json").toBe(false);
  expect(session.networkRequests()).toEqual([]);
});

test("the divider holds after a restart and Zur Mitte removes it", { timeout: 8 * 60_000 }, async () => {
  const folder = newFolder();
  const first = await open(folder);
  const stored = await dragTurnOneDown(first, folder);
  await first.close();

  const session = await open(folder);
  expect((await session.cutState(1)).ratio, "cut of turn 1 after a restart").toBeCloseTo(stored, 3);
  await session.toggleDividerMode();
  expect(await session.dividerControlEnabled("reset"), "Zur Mitte with a divider").toBe(true);
  await session.clickDividerControl("reset");
  await expect.poll(() => readConfig(folder)?.sheets, { timeout: 30_000 }).toBeUndefined();
  expect(readConfig(folder), ".config.json still there").not.toBeNull();
  expect(await session.dividerControlEnabled("reset"), "Zur Mitte in the middle").toBe(false);
  expect((await session.cutState(1)).ratio, "cut of turn 1 after Zur Mitte").toBeCloseTo(0.5, 3);
  expect(session.networkRequests()).toEqual([]);
});

test("keys and a click beside the line change no divider", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const session = await open(folder);
  await session.toggleDividerMode();
  expect(await session.dividerLabel()).toBe("Seite 1 → 2");

  await session.pressKey("ArrowRight");
  await expect.poll(() => session.dividerLabel()).toBe("Seite 2 → 3");
  expect(await session.currentPage(), "page after ArrowRight").toBe(2.5);
  await session.pressKey("ArrowRight");
  await settle();
  expect(await session.dividerLabel(), "stays at the last turn").toBe("Seite 2 → 3");
  await session.pressKey("ArrowLeft");
  await expect.poll(() => session.dividerLabel()).toBe("Seite 1 → 2");
  await session.pressKey("ArrowLeft");
  await settle();
  expect(await session.dividerLabel(), "stays at the first turn").toBe("Seite 1 → 2");
  expect(await session.currentPage(), "page at the first turn").toBe(1.5);

  // Right half (outside the mode a click there turns the page), below the line, away from the controls.
  await session.clickAt(0.75, 0.75);
  await settle();
  expect(await session.dividerLabel(), "label after the click").toBe("Seite 1 → 2");
  expect(await session.currentPage(), "page after the click").toBe(1.5);
  expect((await session.cutState(1)).ratio, "cut of turn 1 after the click").toBeCloseTo(0.5, 3);
  expect(fs.existsSync(configPath(folder)), ".config.json").toBe(false);
  expect(session.networkRequests()).toEqual([]);
});

test("entering and leaving without a drag writes nothing", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const session = await open(folder);

  await session.gotoPage(2);
  await session.toggleDividerMode();
  expect(await session.dividerLabel(), "label on page 2").toBe("Seite 2 → 3");
  await session.toggleDividerMode();
  expect(await session.currentPage(), "page after leaving on page 2").toBe(2);

  await session.gotoPage(3);
  await session.toggleDividerMode();
  expect(await session.dividerLabel(), "label on the last page").toBe("Seite 2 → 3");
  await session.toggleDividerMode();
  expect(await session.currentPage(), "page after leaving on page 3: the last turn 2 -> 3").toBe(2);

  expect(fs.existsSync(configPath(folder)), ".config.json").toBe(false);
  expect(session.networkRequests()).toEqual([]);
});

test.skipIf(!canMakeReadOnly)("the mode works on a PDF that cannot take markup", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  fs.chmodSync(path.join(folder, "a.pdf"), 0o444);
  const session = await open(folder);
  await expect.poll(() => session.writeBlockText(), { timeout: 30_000 }).not.toBeNull();
  await session.confirmWriteBlock();

  expect(await session.editButtonEnabled(), "pencil").toBe(false);
  expect(await session.dividerButtonEnabled(), "divider button").toBe(true);
  await dragTurnOneDown(session, folder);
  expect(session.networkRequests()).toEqual([]);
});

test.skipIf(!canMakeReadOnly)(
  "a failed save shows a notice, the divider holds while the sheet is open",
  { timeout: 5 * 60_000 },
  async () => {
    const folder = newFolder();
    fs.writeFileSync(configPath(folder), JSON.stringify({ version: 1 }, null, 2));
    const bytes = fs.readFileSync(configPath(folder));
    // A read-only file alone does not fail the save on Linux (the atomic rename replaces it); a read-only
    // folder does. It also blocks markup (folder probe), so the "no markup possible" dialog comes first.
    fs.chmodSync(folder, 0o555);
    cleanups.push(() => fs.chmodSync(folder, 0o755));
    const session = await open(folder);
    await expect.poll(() => session.writeBlockText(), { timeout: 30_000 }).not.toBeNull();
    await session.confirmWriteBlock();

    const { pageHeightPx } = await session.cutState(1);
    await session.toggleDividerMode();
    await session.dragDivider(0.2 * pageHeightPx);
    await expect.poll(() => session.snackbarText(), { timeout: 30_000 }).toContain(SAVE_FAILED_PREFIX);
    const text = await session.snackbarText();
    expect(text.startsWith(SAVE_FAILED_PREFIX), `notice text: ${text}`).toBe(true);
    expect(text.endsWith(SAVE_FAILED_SUFFIX), `notice text: ${text}`).toBe(true);
    const dragged = (await session.cutState(1)).ratio;
    expect(Math.abs(dragged - 0.7), "cut of turn 1 after the failed save").toBeLessThanOrEqual(0.01);
    await session.toggleDividerMode();
    expect((await session.cutState(1)).ratio, "cut of turn 1 after leaving the mode").toBeCloseTo(dragged, 3);
    expect(fs.readFileSync(configPath(folder)).equals(bytes), ".config.json unchanged").toBe(true);
    expect(session.networkRequests()).toEqual([]);
  },
);

test("a broken .config.json keeps the mode off with a notice", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  fs.writeFileSync(configPath(folder), "{");
  const bytes = fs.readFileSync(configPath(folder));
  const session = await open(folder);
  // The set lists report the broken file first (App.vue); the notices wait in a queue.
  await expect.poll(() => session.snackbarText(), { timeout: 30_000 }).toContain("Setlisten");
  await session.dismissSnackbar();

  expect(await session.dividerButtonEnabled(), "divider button").toBe(true);
  await session.clickDividerButton();
  await expect.poll(() => session.snackbarText(), { timeout: 30_000 }).toContain(LOAD_FAILED_PREFIX);
  expect((await session.snackbarText()).startsWith(LOAD_FAILED_PREFIX), "notice text").toBe(true);
  expect(await session.dividerModeOn(), "divider line").toBe(false);
  expect(await session.currentPage(), "page").toBe(1);
  expect((await session.cutState(1)).ratio, "cut of turn 1 in the middle").toBeCloseTo(0.5, 3);
  expect(fs.readFileSync(configPath(folder)).equals(bytes), ".config.json unchanged").toBe(true);
  expect(session.networkRequests()).toEqual([]);
});

test.skipIf(!fifoSupported)("the divider mode waits for the sheet settings", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const launched = await launchApp(app, folder);
  cleanups.push(() => launched.close());
  const { page } = launched;
  await page.waitForFunction(() => document.documentElement.dataset.migrationGate === "passed", undefined, { timeout: 30_000 });
  const push = (to: { name: string; params?: Record<string, string> }) =>
    page.evaluate((target) => {
      const vueApp = (document.querySelector("#app") as unknown as {
        __vue_app__: { config: { globalProperties: { $router: { push(to: unknown): Promise<unknown> } } } };
      }).__vue_app__;
      return vueApp.config.globalProperties.$router.push(target);
    }, to);
  // The main page has read `.config.json` (set lists, favorites); from now on only the sheet reads it.
  await push({ name: "Overview" });
  await page.getByTestId("favorites-empty").waitFor({ timeout: 30_000 });
  await settle();
  // The sheet's settings arrive only when the test releases them, after every page is drawn.
  const held = holdFile(configPath(folder));
  cleanups.push(() => held.abandon());
  await push({ name: "SheetViewer", params: { path: path.join(folder, "a.pdf") } });
  await page.waitForSelector(SHEET_LOADED, { state: "attached", timeout: 60_000 });
  await settle();
  const dividerButton = page.locator("header .v-btn").filter({ has: page.locator(".mdi-arrow-split-horizontal, .mdi-check") });
  expect(await dividerButton.isEnabled(), "divider button before the settings arrived").toBe(false);

  await held.release(JSON.stringify({ version: 1, sheets: { "a.pdf": { pageDividers: { "1": 0.7 } } } }, null, 2));
  await expect.poll(() => dividerButton.isEnabled(), { timeout: 30_000 }).toBe(true);
  const clip = await page.evaluate(
    () => getComputedStyle(document.querySelector<HTMLCanvasElement>('#sheetViewerWrapper canvas[data-page="1.5"]')!).clipPath,
  );
  expect(clip, "cut of turn 1 at the stored divider").toMatch(/^inset\(0px 0px 30%/);
  await dividerButton.click();
  await page.locator("#sheetViewerWrapper .dividerLine").first().waitFor({ state: "attached" });
  await launched.refreshRequests();
  expect(launched.networkRequests()).toEqual([]);
});

test("a single page PDF has no divider mode", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  fs.writeFileSync(path.join(folder, "a.pdf"), await makePdf({ pages: 1, xref: "table" }));
  const session = await open(folder);
  expect(await session.dividerButtonEnabled(), "divider button").toBe(false);
  expect(session.networkRequests()).toEqual([]);
});

test("pencil and divider mode exclude each other", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const session = await open(folder);

  await session.toggleDividerMode();
  expect(await session.editButtonEnabled(), "pencil in divider mode").toBe(false);
  await session.toggleDividerMode();

  await session.toggleEdit();
  expect(await session.dividerButtonEnabled(), "divider button in pencil mode").toBe(false);
  await session.toggleEdit();
  expect(await session.dividerButtonEnabled(), "divider button after the pencil mode").toBe(true);
  expect(fs.existsSync(configPath(folder)), ".config.json").toBe(false);
  expect(session.networkRequests()).toEqual([]);
});
