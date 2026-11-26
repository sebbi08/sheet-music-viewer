import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import type { Page } from "playwright-core";
import { afterEach, beforeAll, expect, test } from "vitest";
import { saveMarkupToFile } from "../../src/pdfMarkup/markupFile";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { contentKey } from "../../src/pdfMarkup/writeCheckCache";
import { makeEncryptedPdf, makePdf, makePng, stripSmvData } from "../pdfMarkup/fixtures";
import { repoRoot } from "./corpus";
import { type AppUnderTest, currentApp, launchApp, type LaunchedApp, openSheet, SHEET_LOADED, type SheetSession } from "./electronDriver";
import { fifoSupported, holdFile } from "./fifo";

/**
 * Loading a sheet page by page (spec 2026-11-26) end to end, headless, on synthetic folders below
 * test-results/visual/work/ (no corpus needed): page 1 with its markup shows while later pages are still
 * drawn, the bar sits in the app bar and the pencil waits; pages finish in order; the write check is
 * remembered per content in the profile (`markup-write-check.json`) and a second open uses it; an encrypted
 * PDF shows its hint without a check; leaving during the load leaves nothing behind, also when the check
 * returns a block afterwards; a resize during the load draws every page again in order and keeps the markup
 * of pages it has not reached yet; an orphaned stamp the check repairs shows on that same open; a PDF that
 * pdf.js cannot load turns the pencil off with a notice.
 * The driver's default `SMV_DISABLE_BULK_MIGRATION=1` lets every folder count as migrated.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
const PAGES = 40;
const SHAPES_PER_PAGE = 4000;
const CACHE_FILE = "markup-write-check.json";
const READABLE = "Die Noten lassen sich trotzdem anzeigen.";
const REMEMBERED_DIALOG =
  "In „a.pdf“ können keine Markierungen gespeichert werden: In diese PDF kann die App nicht schreiben: aus dem Merker. " +
  `Bitte mit einem anderen Programm neu speichern. ${READABLE}`;
const LOAD_FAILED =
  "Die Markierungen dieser PDF konnten nicht geladen werden. Bearbeiten ist deaktiviert, damit sie nicht überschrieben werden.";
const ENCRYPTED_DIALOG =
  "In „a.pdf“ können keine Markierungen gespeichert werden: Die PDF ist verschlüsselt. " +
  `Bitte den Kennwortschutz entfernen. ${READABLE}`;
/** Overlays of the sheet with markup: page 1, the last page and the last page's half step. */
const OVERLAYS = ["1", String(PAGES - 0.5), String(PAGES)];

let app: AppUnderTest;
/** `PAGES` pages, markup saved on page 1 and on the last page (the way the app saves it). */
let markedBytes: Uint8Array;
let smallBytes: Uint8Array;
/** Everything a test created: undone last-in first-out after each test, also when it failed. */
const cleanups: (() => Promise<void> | void)[] = [];

const isBelow = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

function removeWorkFolder(folder: string): void {
  if (!isBelow(fs.realpathSync(workDir), fs.realpathSync(folder))) throw new Error(`not a work folder: ${folder}`);
  fs.rmSync(folder, { recursive: true, force: true });
}

const rect = (left: number, fill: string) => ({
  type: "Rect",
  left,
  top: 200,
  width: 120,
  height: 80,
  angle: 0,
  scaleX: 1,
  scaleY: 1,
  fill,
});

/**
 * `PAGES` pages, each with `SHAPES_PER_PAGE` filled and stroked circles: heavy enough that drawing the
 * sheet takes seconds, so a check can see it half done (a light page takes a few milliseconds).
 */
async function heavyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makePdf({ pages: PAGES, xref: "table" }));
  let seed = 1;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    for (let i = 0; i < SHAPES_PER_PAGE; i++) {
      page.drawCircle({
        x: next() * width,
        y: next() * (height - 200),
        size: 2 + next() * 20,
        color: rgb(next(), next(), next()),
        borderColor: rgb(next(), next(), next()),
        borderWidth: 0.5,
        opacity: 0.5,
      });
    }
  }
  return doc.save({ useObjectStreams: false });
}

beforeAll(async () => {
  app = await currentApp();
  smallBytes = await makePdf({ xref: "table" });
  fs.mkdirSync(workDir, { recursive: true });
  const setup = fs.mkdtempSync(path.join(workDir, "sheet-loading-setup-"));
  try {
    const pdf = path.join(setup, "a.pdf");
    fs.writeFileSync(pdf, await heavyPdf());
    const pngBase64 = Buffer.from(makePng(120, 80)).toString("base64");
    const saved = await saveMarkupToFile({
      path: pdf,
      pages: [1, PAGES].map((page, i) => ({
        page,
        payload: { version: 1, width: 595, height: 842, fabric: { version: "7", objects: [rect(100 + i * 200, "red")] } },
        pngBase64,
      })),
    });
    expect(saved).toEqual({ status: "pdf" });
    markedBytes = new Uint8Array(fs.readFileSync(pdf));
  } finally {
    removeWorkFolder(setup);
  }
}, 15 * 60_000);

afterEach(async () => {
  const errors: unknown[] = [];
  while (cleanups.length > 0) {
    try {
      await cleanups.pop()!();
    } catch (e) {
      errors.push(e);
    }
  }
  if (errors.length > 0) throw errors[0];
}, 3 * 60_000); // closing an app may take the driver's full close timeout

/** A fresh folder below workDir with `a.pdf` = `bytes`, removed after the test. */
function newFolder(bytes: Uint8Array): string {
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "sheet-loading-"));
  cleanups.push(() => removeWorkFolder(folder));
  fs.writeFileSync(path.join(folder, "a.pdf"), bytes);
  return folder;
}

/** A profile (userData) kept across starts, removed after the test. */
function newProfile(): string {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "smv-visual-profile-"));
  cleanups.push(() => fs.rmSync(profile, { recursive: true, force: true }));
  return profile;
}

const pdfUnchanged = (folder: string, bytes: Uint8Array) => fs.readFileSync(path.join(folder, "a.pdf")).equals(Buffer.from(bytes));

type CacheFile = { version: number; entries: Record<string, { ok: boolean; message?: string }> };
const readCache = (profile: string): CacheFile => JSON.parse(fs.readFileSync(path.join(profile, CACHE_FILE), "utf8")) as CacheFile;

/** Problems the renderer reported: console errors, uncaught exceptions and the viewer's "Could not …" warnings. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || (message.type() === "warning" && message.text().startsWith("Could not"))) {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Starts the app on `folder`, once the migration gate passed; closed after the test. */
async function start(folder: string, profile?: string): Promise<LaunchedApp> {
  const launched = await launchApp(app, folder, profile === undefined ? {} : { profile });
  cleanups.push(() => launched.close());
  await launched.page.waitForFunction(() => document.documentElement.dataset.migrationGate === "passed", undefined, {
    timeout: 30_000,
  });
  return launched;
}

/** Opens `a.pdf` in a fresh app through the driver (waits until it is loaded); closed after the test. */
async function openLoaded(folder: string, profile?: string): Promise<SheetSession> {
  const session = await openSheet(app, folder, "a.pdf", profile === undefined ? {} : { profile });
  cleanups.push(() => session.close());
  return session;
}

/**
 * Records in the page which page canvases get `data-rendered`, in order, split into passes (a pass starts
 * where the marks are removed: a new render run). For every page done it also notes which markup overlays
 * exist and which of them are left from before (tagged `data-smv-stale`).
 */
function watchRendering(page: Page): Promise<void> {
  return page.evaluate(() => {
    type Done = { page: number; overlays: string[]; stale: string[] };
    const w = window as unknown as { __smvPasses: Done[][]; __smvRenderObserver?: MutationObserver };
    w.__smvRenderObserver?.disconnect();
    w.__smvPasses = [[]];
    const overlays = (stale: boolean) =>
      [...document.querySelectorAll<HTMLCanvasElement>("#sheetViewerWrapper canvas.overlayCanvas")]
        .filter((c) => !stale || c.dataset.smvStale !== undefined)
        .map((c) => c.getAttribute("data-page-overlay") ?? "")
        .sort((a, b) => Number(a) - Number(b));
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const canvas = record.target as HTMLElement;
        if (canvas.tagName !== "CANVAS" || canvas.dataset.page === undefined) continue;
        const pass = w.__smvPasses[w.__smvPasses.length - 1];
        if (record.oldValue === null) {
          pass.push({ page: Number(canvas.dataset.page), overlays: overlays(false), stale: overlays(true) });
        } else if (pass.length > 0) {
          // The viewer only removes the mark at the start of a run.
          w.__smvPasses.push([]);
        }
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-rendered"], attributeOldValue: true });
    w.__smvRenderObserver = observer;
  });
}

type Done = { page: number; overlays: string[]; stale: string[] };
const passes = (page: Page) => page.evaluate(() => (window as unknown as { __smvPasses: Done[][] }).__smvPasses);
const pageOrder = (pass: Done[]) => pass.map((d) => d.page);
const allPages = Array.from({ length: PAGES }, (_, i) => i + 1);

async function push(launched: LaunchedApp, to: { name: string; params?: Record<string, string> }): Promise<void> {
  await launched.page.evaluate((target) => {
    const vueApp = (document.querySelector("#app") as unknown as {
      __vue_app__: { config: { globalProperties: { $router: { push(to: unknown): Promise<unknown> } } } };
    }).__vue_app__;
    return vueApp.config.globalProperties.$router.push(target);
  }, to);
}

const routeName = (launched: LaunchedApp) =>
  launched.page.evaluate(() => {
    const vueApp = (document.querySelector("#app") as unknown as {
      __vue_app__: { config: { globalProperties: { $router: { currentRoute: { value: { name: string } } } } } };
    }).__vue_app__;
    return vueApp.config.globalProperties.$router.currentRoute.value.name;
  });

/** Shows `a.pdf` the way the folder view opens it, without waiting for it to load. */
const pushSheet = (launched: LaunchedApp, folder: string) =>
  push(launched, { name: "SheetViewer", params: { path: path.join(folder, "a.pdf") } });

/** The state of the viewer and the app bar in one go. */
const viewerState = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('header [data-testid="sheet-loading"]');
    const box = bar?.getBoundingClientRect();
    const pencil = [...document.querySelectorAll<HTMLButtonElement>("header .v-btn")].find((b) => b.querySelector(".mdi-pencil"));
    const valueNow = bar?.getAttribute("aria-valuenow");
    return {
      rendered: [...document.querySelectorAll<HTMLCanvasElement>("#sheetViewerWrapper canvas[data-page][data-rendered]")]
        .map((c) => Number(c.dataset.page))
        .filter((n) => Number.isInteger(n)).length,
      barShown: !!bar && !!box && box.width > 0 && box.height > 0 && getComputedStyle(bar).display !== "none",
      barValue: valueNow === null || valueNow === undefined ? null : Number(valueNow),
      pencilDisabled: pencil ? pencil.disabled : null,
      overlays: [...document.querySelectorAll<HTMLCanvasElement>("#sheetViewerWrapper canvas.overlayCanvas")]
        .map((c) => c.getAttribute("data-page-overlay") ?? "")
        .sort((a, b) => Number(a) - Number(b)),
      loaded: !!document.querySelector('#sheetViewerWrapper[data-sheet-loaded="true"]'),
    };
  });

/** `store.sheetLoading` of the app store. */
const sheetLoading = (page: Page) =>
  page.evaluate(() => {
    const vueApp = (document.querySelector("#app") as unknown as {
      __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, { sheetLoading: unknown }> } } } };
    }).__vue_app__;
    const store = vueApp.config.globalProperties.$pinia._s.get("app");
    if (!store) throw new Error("app store not found");
    return store.sheetLoading;
  });

/** The app store's loading and pencil state. */
const appStore = (page: Page) =>
  page.evaluate(() => {
    const vueApp = (document.querySelector("#app") as unknown as {
      __vue_app__: {
        config: {
          globalProperties: {
            $pinia: { _s: Map<string, { sheetLoading: unknown; markupEditDisabled: boolean; editMode: boolean }> };
          };
        };
      };
    }).__vue_app__;
    const store = vueApp.config.globalProperties.$pinia._s.get("app");
    if (!store) throw new Error("app store not found");
    return { sheetLoading: store.sheetLoading, markupEditDisabled: store.markupEditDisabled, editMode: store.editMode };
  });

/** Waits (polling every 10 ms) until page `n` is marked rendered; returns the viewer state at that moment. */
async function whenRendered(page: Page, n: number) {
  await page.waitForFunction(
    (p) => !!document.querySelector(`#sheetViewerWrapper canvas[data-page="${p}"][data-rendered]`),
    n,
    { polling: 10, timeout: 60_000 },
  );
  return viewerState(page);
}

async function resizeWindow(launched: LaunchedApp, width: number, height: number): Promise<void> {
  await launched.electronApp.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith("devtools:"));
    if (!win) throw new Error("app window not found");
    win.setContentSize(s.width, s.height);
  }, { width, height });
  await launched.page.waitForFunction((s) => window.innerWidth === s.width && window.innerHeight === s.height, { width, height });
}

async function noNetwork(launched: LaunchedApp): Promise<void> {
  await launched.refreshRequests();
  expect(launched.networkRequests(), "network requests").toEqual([]);
}

test("page 1 shows before the last page is done; bar in the app bar, pencil waits", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder(markedBytes);
  const launched = await start(folder);
  const problems = watchConsole(launched.page);
  await pushSheet(launched, folder);

  const early = await whenRendered(launched.page, 1);
  console.log(`when page 1 shows: ${JSON.stringify(early)}`);
  expect(early.rendered, "pages done when page 1 shows").toBeLessThan(PAGES);
  expect(early.loaded, "loaded marker when page 1 shows").toBe(false);
  expect(early.barShown, "bar in the app bar").toBe(true);
  expect(early.barValue, "bar value (determinate, below 100)").not.toBeNull();
  expect(early.barValue!, "bar value").toBeLessThan(100);
  expect(early.pencilDisabled, "pencil disabled").toBe(true);
  expect(early.overlays, "overlays when page 1 shows").toContain("1");

  await launched.page.waitForSelector(SHEET_LOADED, { state: "attached", timeout: 120_000 });
  await expect.poll(() => viewerState(launched.page).then((s) => s.barShown), { timeout: 10_000 }).toBe(false);
  const done = await viewerState(launched.page);
  expect(await launched.page.locator('[data-testid="sheet-loading"]').count(), "bar gone").toBe(0);
  expect(done.pencilDisabled, "pencil disabled after loading").toBe(false);
  expect(done.rendered, "pages done").toBe(PAGES);
  expect(done.overlays, "overlays").toEqual(OVERLAYS);
  expect(await sheetLoading(launched.page), "store.sheetLoading").toBeNull();
  expect(problems, "console problems").toEqual([]);
  expect(pdfUnchanged(folder, markedBytes), "PDF bytes unchanged").toBe(true);
  await noNetwork(launched);
});

test("pages are done in order, each with its markup", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder(markedBytes);
  const launched = await start(folder);
  await watchRendering(launched.page);
  await pushSheet(launched, folder);
  await launched.page.waitForSelector(SHEET_LOADED, { state: "attached", timeout: 120_000 });

  const recorded = await passes(launched.page);
  expect(recorded.length, "passes").toBe(1);
  expect(pageOrder(recorded[0]), "order").toEqual(allPages);
  // A page's overlays exist once it counts as done; later pages have none yet.
  const overlaysAt = (n: number) => recorded[0].find((d) => d.page === n)?.overlays;
  expect(overlaysAt(1), "overlays when page 1 is done").toEqual(["1"]);
  expect(overlaysAt(PAGES - 1), `overlays when page ${PAGES - 1} is done`).toEqual(["1"]);
  expect(overlaysAt(PAGES), `overlays when page ${PAGES} is done`).toEqual(OVERLAYS);
  expect(pdfUnchanged(folder, markedBytes), "PDF bytes unchanged").toBe(true);
  await noNetwork(launched);
});

test("second open uses the remembered check", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder(smallBytes);
  const profile = newProfile();
  const key = contentKey(smallBytes);

  const first = await openLoaded(folder, profile);
  expect(await first.writeBlockText(), "dialog on the first open").toBeNull();
  expect(await first.editButtonEnabled(), "pencil on the first open").toBe(true);
  expect(first.networkRequests(), "network requests of the first start").toEqual([]);
  await first.close();
  const afterFirst = readCache(profile);
  expect(afterFirst.version, "cache version").toBe(1);
  expect(afterFirst.entries[key], "remembered result after the first open").toEqual({ ok: true });

  // A different result for the same content: the second open must take it from the file, not build again.
  fs.writeFileSync(
    path.join(profile, CACHE_FILE),
    JSON.stringify({ version: 1, entries: { ...afterFirst.entries, [key]: { ok: false, message: "aus dem Merker" } } }),
  );
  const second = await openLoaded(folder, profile);
  expect(await second.writeBlockText(), "dialog on the second open").toBe(REMEMBERED_DIALOG);
  await second.confirmWriteBlock();
  expect(await second.editButtonEnabled(), "pencil on the second open").toBe(false);
  expect(await second.pageRendered(1), "page 1 rendered").toBe(true);
  expect(readCache(profile).entries[key], "remembered result after the second open").toEqual({
    ok: false,
    message: "aus dem Merker",
  });
  expect(second.networkRequests(), "network requests of the second start").toEqual([]);
  expect(pdfUnchanged(folder, smallBytes), "PDF bytes unchanged").toBe(true);
});

test("encrypted PDF: hint at once, no check", { timeout: 5 * 60_000 }, async () => {
  const encrypted = makeEncryptedPdf();
  const folder = newFolder(encrypted);
  const profile = newProfile();

  const session = await openLoaded(folder, profile);
  expect(await session.writeBlockText()).toBe(ENCRYPTED_DIALOG);
  await session.confirmWriteBlock();
  expect(await session.pageRendered(1), "page 1 rendered").toBe(true);
  expect(await session.editButtonEnabled(), "pencil").toBe(false);
  expect(fs.existsSync(path.join(profile, CACHE_FILE)), `${CACHE_FILE} created`).toBe(false);
  expect(session.networkRequests(), "network requests").toEqual([]);
  expect(pdfUnchanged(folder, encrypted), "PDF bytes unchanged").toBe(true);
});

test.skipIf(!fifoSupported)("leaving during the load: a check that returns a block afterwards changes nothing", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder(markedBytes);
  const profile = newProfile();
  // The check waits for the remembered result until the test releases it, after the sheet was left; the
  // result is a block, so a check result looked at after leaving would show (pencil state, dialog).
  const held = holdFile(path.join(profile, CACHE_FILE));
  const launched = await start(folder, profile);
  cleanups.push(() => held.abandon());
  const problems = watchConsole(launched.page);
  // Opened from the folder view, as a user does: the back button returns to it.
  await push(launched, { name: "SheetSelection", params: { path: path.sep } });
  await launched.page.locator(".v-card .itemName").first().waitFor({ timeout: 30_000 });
  await pushSheet(launched, folder);

  const early = await whenRendered(launched.page, 1);
  expect(early.rendered, "pages done when leaving").toBeLessThan(PAGES);
  // Watches the page canvases themselves: a page drawn after leaving would mark its (detached) canvas.
  await launched.page.evaluate(() => {
    const w = window as unknown as { __smvLateRendered: number };
    w.__smvLateRendered = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.oldValue === null && (record.target as HTMLElement).hasAttribute("data-rendered")) w.__smvLateRendered++;
      }
    });
    document.querySelectorAll("#sheetViewerWrapper canvas[data-page]").forEach((canvas) =>
      observer.observe(canvas, { attributes: true, attributeFilter: ["data-rendered"], attributeOldValue: true }),
    );
  });
  await launched.page.locator("header .v-btn").filter({ has: launched.page.locator(".mdi-arrow-left") }).click();
  await launched.page.waitForSelector("#sheetViewerWrapper", { state: "detached" });
  await launched.page.evaluate(() => ((window as unknown as { __smvLateRendered: number }).__smvLateRendered = 0));
  expect(await routeName(launched), "route after leaving").toBe("SheetSelection");
  await launched.page.locator(".v-card .itemName").first().waitFor({ timeout: 30_000 });

  const key = contentKey(markedBytes);
  const remembered = { version: 1, entries: { [key]: { ok: false, message: "aus dem Merker" } } };
  await held.release(JSON.stringify(remembered));
  // Time for the check to return and for anything the left sheet might still do.
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  expect(await launched.page.getByTestId("write-block-dialog").isVisible(), "write-block dialog").toBe(false);
  expect(await appStore(launched.page), "app store after leaving").toEqual({
    sheetLoading: null,
    markupEditDisabled: false,
    editMode: false,
  });
  expect(await launched.page.locator('[data-testid="sheet-loading"]').count(), "bar").toBe(0);
  expect(await launched.page.locator("#sheetViewerWrapper").count(), "viewer").toBe(0);
  expect(
    await launched.page.evaluate(() => (window as unknown as { __smvLateRendered: number }).__smvLateRendered),
    "pages marked rendered after leaving",
  ).toBe(0);
  // The check took the remembered result (nothing new stored).
  expect(readCache(profile), "remembered results").toEqual(remembered);
  expect(problems, "console problems").toEqual([]);
  expect(pdfUnchanged(folder, markedBytes), "PDF bytes unchanged").toBe(true);
  await noNetwork(launched);
});

test("a repaired orphan stamp shows on the open that repairs it", { timeout: 5 * 60_000 }, async () => {
  // A stamp of ours whose data another program dropped: the check takes it out of our optional content group.
  const folder = newFolder(smallBytes);
  const pdf = path.join(folder, "a.pdf");
  const saved = await saveMarkupToFile({
    path: pdf,
    pages: [
      {
        page: 1,
        payload: { version: 1, width: 595, height: 842, fabric: { version: "7", objects: [rect(100, "red")] } },
        pngBase64: Buffer.from(makePng(120, 80)).toString("base64"),
      },
    ],
  });
  expect(saved).toEqual({ status: "pdf" });
  fs.writeFileSync(pdf, await stripSmvData(fs.readFileSync(pdf)));
  const orphansIn = async () => readMarkup(await PDFDocument.load(fs.readFileSync(pdf), { updateMetadata: false })).orphans;
  expect(await orphansIn(), "orphans before the open").toHaveLength(1);

  const launched = await start(folder);
  const problems = watchConsole(launched.page);
  await pushSheet(launched, folder);
  await launched.page.waitForSelector(SHEET_LOADED, { state: "attached", timeout: 120_000 });

  // The stamp's picture (blue 128 everywhere) covers the whole page; the page itself is white there.
  const center = await launched.page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#sheetViewerWrapper canvas[data-page="1"]');
    const context = canvas?.getContext("2d");
    if (!canvas || !context) throw new Error("no page canvas");
    return [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
  });
  console.log(`centre pixel of page 1: ${JSON.stringify(center)}`);
  expect(center[3], "centre pixel alpha").toBe(255);
  expect(center.slice(0, 3), "centre pixel of page 1 (the stamp shows)").not.toEqual([255, 255, 255]);
  expect(await orphansIn(), "orphans after the open").toEqual([]);
  const state = await viewerState(launched.page);
  expect(state.overlays, "markup overlays (no data)").toEqual([]);
  expect(state.pencilDisabled, "pencil").toBe(false);
  expect(problems, "console problems").toEqual([]);
  await noNetwork(launched);
});

test("a PDF pdf.js cannot load: pencil off, notice", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder(smallBytes);
  const launched = await start(folder);
  const problems = watchConsole(launched.page);
  // The main process parses the file (markup, check) as usual; pdf.js gets bytes it cannot read.
  await launched.electronApp.evaluate(({ protocol }) => {
    protocol.unhandle("local-resource");
    protocol.handle("local-resource", () => new Response("this is not a pdf", { headers: { "content-type": "application/pdf" } }));
  });
  // A frame keeps the handlers it was loaded with.
  await launched.page.reload();
  await launched.page.waitForFunction(() => document.documentElement.dataset.migrationGate === "passed", undefined, {
    timeout: 30_000,
  });
  await pushSheet(launched, folder);
  await expect
    .poll(() => launched.page.evaluate(() => document.querySelector(".v-snackbar .v-snackbar__content")?.textContent?.trim() ?? ""), {
      timeout: 60_000,
    })
    .toBe(LOAD_FAILED);
  // The check returns meanwhile; nothing turns the pencil on again.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  expect(await appStore(launched.page), "app store").toEqual({ sheetLoading: null, markupEditDisabled: true, editMode: false });
  expect((await viewerState(launched.page)).pencilDisabled, "pencil").toBe(true);
  expect(await launched.page.getByTestId("write-block-dialog").isVisible(), "write-block dialog").toBe(false);
  expect(problems.filter((p) => !p.startsWith("warning: Could not load the PDF")), "console problems").toEqual([]);
  expect(pdfUnchanged(folder, smallBytes), "PDF bytes unchanged").toBe(true);
  await noNetwork(launched);
});

test("resize during the first load: every page again, in order", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder(markedBytes);
  const launched = await start(folder);
  const problems = watchConsole(launched.page);
  await watchRendering(launched.page);
  await pushSheet(launched, folder);

  const early = await whenRendered(launched.page, 1);
  expect(early.rendered, "pages done at the resize").toBeLessThan(PAGES);
  await resizeWindow(launched, 1000, 1400);
  await launched.page.waitForSelector(SHEET_LOADED, { state: "attached", timeout: 120_000 });

  const recorded = await passes(launched.page);
  console.log(`passes: ${JSON.stringify(recorded.map(pageOrder))}`);
  expect(recorded.length, "passes").toBe(2);
  expect(pageOrder(recorded[0]).length, "pages of the first pass").toBeLessThan(PAGES);
  expect(pageOrder(recorded[0]), "first pass in order").toEqual(allPages.slice(0, recorded[0].length));
  expect(pageOrder(recorded[1]), "second pass").toEqual(allPages);
  const done = await viewerState(launched.page);
  expect(done.rendered, "pages done").toBe(PAGES);
  expect(done.overlays, "overlays").toEqual(OVERLAYS);
  expect(done.pencilDisabled, "pencil disabled after loading").toBe(false);
  expect(done.barShown, "bar").toBe(false);
  expect(problems, "console problems").toEqual([]);
  expect(pdfUnchanged(folder, markedBytes), "PDF bytes unchanged").toBe(true);
  await noNetwork(launched);
});

test("resize during a redraw: the markup of pages not reached yet stays until they are drawn", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder(markedBytes);
  const launched = await start(folder);
  const problems = watchConsole(launched.page);
  await pushSheet(launched, folder);
  await launched.page.waitForSelector(SHEET_LOADED, { state: "attached", timeout: 120_000 });
  expect((await viewerState(launched.page)).overlays, "overlays after loading").toEqual(OVERLAYS);

  // Tag the overlays of the first run, then redraw: a second resize hits the redraw while it runs.
  await launched.page.evaluate(() =>
    document.querySelectorAll<HTMLCanvasElement>("#sheetViewerWrapper canvas.overlayCanvas").forEach((c) => (c.dataset.smvStale = "1")),
  );
  await watchRendering(launched.page);
  await resizeWindow(launched, 1000, 1400);
  await launched.page.waitForFunction(
    () => ((window as unknown as { __smvPasses: unknown[][] }).__smvPasses.at(-1)?.length ?? 0) >= 3,
    undefined,
    { polling: 10, timeout: 60_000 },
  );
  const during = await viewerState(launched.page);
  expect(during.loaded, "loaded marker during the redraw").toBe(false);
  expect(during.rendered, "pages done at the second resize").toBeLessThan(PAGES);
  await resizeWindow(launched, 900, 1300);
  await launched.page.waitForSelector(SHEET_LOADED, { state: "attached", timeout: 120_000 });

  const recorded = await passes(launched.page);
  console.log(`passes: ${JSON.stringify(recorded.map(pageOrder))}`);
  // The redraw, cut short by the second resize, and the redraw after it.
  expect(recorded.length, "passes").toBe(2);
  expect(pageOrder(recorded[0]), "interrupted redraw in order").toEqual(allPages.slice(0, recorded[0].length));
  expect(recorded[0].length, "pages of the interrupted redraw").toBeLessThan(PAGES);
  expect(pageOrder(recorded[1]), "last redraw").toEqual(allPages);
  // Until the last page is drawn again, its overlays (and its half step's) are those of the first run.
  const lastHalf = String(PAGES - 0.5);
  const last = String(PAGES);
  for (const done of [...recorded[0], ...recorded[1].slice(0, -1)]) {
    expect(done.overlays, `overlays when page ${done.page} is done`).toEqual(expect.arrayContaining([lastHalf, last]));
    expect(done.stale, `old overlays when page ${done.page} is done`).toEqual(expect.arrayContaining([lastHalf, last]));
  }
  // Page 1 got its new overlay when it was drawn again.
  expect(recorded[1][0].stale, "old overlays when page 1 is done").not.toContain("1");
  expect(recorded[1][0].overlays, "overlays when page 1 is done").toContain("1");
  const end = recorded[1][recorded[1].length - 1];
  expect(end.overlays, `overlays when page ${PAGES} is done`).toEqual(OVERLAYS);
  expect(end.stale, `old overlays when page ${PAGES} is done`).toEqual([]);

  const done = await viewerState(launched.page);
  expect(done.rendered, "pages done").toBe(PAGES);
  expect(done.overlays, "overlays").toEqual(OVERLAYS);
  expect(done.pencilDisabled, "pencil disabled after loading").toBe(false);
  expect(problems, "console problems").toEqual([]);
  expect(pdfUnchanged(folder, markedBytes), "PDF bytes unchanged").toBe(true);
  await noNetwork(launched);
});
