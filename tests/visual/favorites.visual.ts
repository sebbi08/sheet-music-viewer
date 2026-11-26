import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, expect, test } from "vitest";
import { fingerprintOf } from "../../src/pdfFingerprint";
import { makePdf } from "../pdfMarkup/fixtures";
import { repoRoot } from "./corpus";
import { type AppUnderTest, currentApp, launchApp, type LaunchedApp, SHEET_LOADED } from "./electronDriver";

/**
 * Favorites (spec 2026-11-25) end to end, headless, on synthetic folders below test-results/visual/work/ (no
 * corpus needed): the heart in the viewer's app bar and on the cards of the folder view and the search
 * results, a press on a card's heart never opens the sheet, quick presses are saved in order, opening without
 * a change writes nothing, an unreadable `.config.json` is reported and never written, a moved favorite
 * follows its PDF on open, and the main page lists the favorites (sorted, open, unmark, the hint, moved and
 * renamed favorites found by the background search, missing ones hidden, copies not marked). The driver's default `SMV_DISABLE_BULK_MIGRATION=1` lets every folder count as
 * migrated.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
const CONFIG = ".config.json";
const UNREADABLE_PREFIX = `Die Favoriten konnten nicht geladen werden („${CONFIG}“: `;
const UNREADABLE_SUFFIX = "). Änderungen an Favoriten werden nicht gespeichert.";

let app: AppUnderTest;
let pdfA: Uint8Array;
let pdfB: Uint8Array;
/** Everything a test created, undone last-in first-out after each test, also when it failed. */
const cleanups: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  app = await currentApp();
  pdfA = await makePdf({ pages: 2, xref: "table" });
  pdfB = await makePdf({ pages: 3, xref: "table" });
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
}, 3 * 60_000);

const isBelow = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** A fresh folder below workDir with `a.pdf` and `b.pdf`, removed after the test. */
function newFolder(): string {
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "favorites-"));
  cleanups.push(() => {
    if (!isBelow(fs.realpathSync(workDir), fs.realpathSync(folder))) throw new Error(`not a work folder: ${folder}`);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(folder, "a.pdf"), pdfA);
  fs.writeFileSync(path.join(folder, "b.pdf"), pdfB);
  return folder;
}

async function start(folder: string): Promise<LaunchedApp> {
  const launched = await launchApp(app, folder);
  cleanups.push(() => launched.close());
  await launched.page.waitForFunction(() => document.documentElement.dataset.migrationGate === "passed", undefined, {
    timeout: 30_000,
  });
  return launched;
}

type StoredConfig = {
  version?: number;
  sheets?: Record<string, { favorite?: boolean; fingerprint?: { sha256: string; length: number } }>;
};
const configPath = (folder: string) => path.join(folder, CONFIG);
const readConfig = (folder: string): StoredConfig | null =>
  fs.existsSync(configPath(folder)) ? (JSON.parse(fs.readFileSync(configPath(folder), "utf8")) as StoredConfig) : null;
function writeConfig(folder: string, config: unknown): void {
  fs.writeFileSync(configPath(folder), JSON.stringify(config, null, 2));
}
/** Bytes and mtime of `.config.json`, null without one. */
const configState = (folder: string) =>
  fs.existsSync(configPath(folder))
    ? { bytes: fs.readFileSync(configPath(folder)).toString("base64"), mtimeMs: fs.statSync(configPath(folder)).mtimeMs }
    : null;

/** A press that must change nothing cannot be awaited; this gives any save it might start time to run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 2_000));

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

/** Shows the folder view of `relative` (e.g. "/" or "/sub/") and waits for its cards. */
async function showFolder(launched: LaunchedApp, relative: string): Promise<void> {
  await push(launched, { name: "SheetSelection", params: { path: relative.split("/").join(path.sep) } });
  await launched.page.locator(".v-card .itemName").first().waitFor();
}

/** Shows `pdfPath` (relative to `folder`) in the viewer, the way the folder view opens it. */
async function showSheet(launched: LaunchedApp, folder: string, pdfPath: string): Promise<void> {
  await push(launched, { name: "SheetViewer", params: { path: path.resolve(folder, pdfPath) } });
  await launched.page.waitForSelector("#sheetViewerWrapper canvas[data-page]", { state: "attached" });
  await launched.page.waitForSelector(SHEET_LOADED, { state: "attached", timeout: 60_000 });
}

/** Leaves the viewer with the app bar's back button. */
async function leaveSheet(launched: LaunchedApp): Promise<void> {
  await launched.page.locator("header .v-btn").filter({ has: launched.page.locator(".mdi-arrow-left") }).click();
  await launched.page.waitForSelector("#sheetViewerWrapper", { state: "detached" });
}

/** The card whose name is `name` (without `.pdf`). */
const card = (launched: LaunchedApp, name: string) =>
  launched.page.locator(".v-card").filter({ has: launched.page.locator(".itemName", { hasText: new RegExp(`^\\s*${name}\\s*$`) }) });

/** The icon of the heart on the card `name`; null while the card has none. */
async function cardHeart(launched: LaunchedApp, name: string): Promise<string | null> {
  const button = card(launched, name).getByTestId("favorite-toggle");
  if ((await button.count()) === 0) return null;
  const classes = (await button.locator(".v-icon").getAttribute("class")) ?? "";
  return classes.includes("mdi-heart-outline") ? "mdi-heart-outline" : classes.includes("mdi-heart") ? "mdi-heart" : classes;
}

/** The icon of the viewer's heart in the app bar. */
async function viewerHeart(launched: LaunchedApp): Promise<string> {
  const classes = (await launched.page.getByTestId("favorite-current").locator(".v-icon").getAttribute("class")) ?? "";
  return classes.includes("mdi-heart-outline") ? "mdi-heart-outline" : classes.includes("mdi-heart") ? "mdi-heart" : classes;
}

const snackbarText = (launched: LaunchedApp) =>
  launched.page.evaluate(() => (document.querySelector(".v-snackbar .v-snackbar__content")?.textContent ?? "").trim());

test("mark in the viewer, heart shows in the folder view and in search results", async () => {
  const folder = newFolder();
  const launched = await start(folder);
  await showSheet(launched, folder, "a.pdf");
  await expect.poll(() => viewerHeart(launched), { timeout: 30_000 }).toBe("mdi-heart-outline");

  await launched.page.getByTestId("favorite-current").click();
  await expect.poll(() => viewerHeart(launched)).toBe("mdi-heart");
  await expect.poll(() => readConfig(folder)?.sheets?.["a.pdf"]?.favorite, { timeout: 30_000 }).toBe(true);
  expect(readConfig(folder)?.sheets?.["a.pdf"]?.fingerprint, "fingerprint").toEqual(fingerprintOf(pdfA));
  expect(readConfig(folder)?.version, "version").toBe(1);

  await leaveSheet(launched);
  await showFolder(launched, "/");
  await expect.poll(() => cardHeart(launched, "a"), { timeout: 30_000 }).toBe("mdi-heart");
  expect(await cardHeart(launched, "b"), "heart of b").toBe("mdi-heart-outline");

  await launched.page.locator("header .searchFieldWrapper input").fill("a");
  // A search result card shows its folder below the name.
  await launched.page.locator(".v-card h5.itemName").first().waitFor({ timeout: 30_000 });
  await expect.poll(() => cardHeart(launched, "a"), { timeout: 30_000 }).toBe("mdi-heart");
  expect(await card(launched, "b").count(), "b is no search result").toBe(0);
  expect(fs.readFileSync(path.join(folder, "a.pdf")).equals(Buffer.from(pdfA)), "PDF bytes unchanged").toBe(true);
});

test("unmark on the card does not open the sheet", async () => {
  const folder = newFolder();
  writeConfig(folder, {
    version: 1,
    sheets: { "a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) }, "b.pdf": { favorite: true } },
  });
  const launched = await start(folder);
  await showFolder(launched, "/");
  await expect.poll(() => cardHeart(launched, "a"), { timeout: 30_000 }).toBe("mdi-heart");

  await card(launched, "a").getByTestId("favorite-toggle").click();
  await expect.poll(() => cardHeart(launched, "a")).toBe("mdi-heart-outline");
  await expect.poll(() => readConfig(folder)?.sheets?.["a.pdf"], { timeout: 30_000 }).toBeUndefined();
  await settle();
  expect(await routeName(launched), "route after the press").toBe("SheetSelection");
  expect(await launched.page.locator("#sheetViewerWrapper").count(), "viewer shown").toBe(0);
  expect(readConfig(folder)?.sheets?.["b.pdf"], "the other sheet").toEqual({ favorite: true });
  expect(fs.readFileSync(path.join(folder, "a.pdf")).equals(Buffer.from(pdfA)), "PDF bytes unchanged").toBe(true);
});

test("two quick presses: the last one counts", async () => {
  const folder = newFolder();
  const launched = await start(folder);
  await showSheet(launched, folder, "a.pdf");
  const button = launched.page.getByTestId("favorite-current");
  await expect.poll(() => button.isEnabled(), { timeout: 30_000 }).toBe(true);

  // Both presses in one task: the second comes before the first save could have finished.
  await button.evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });
  // The first press writes the file; only after the second one is the entry gone again.
  await expect
    .poll(() => fs.existsSync(configPath(folder)) && readConfig(folder)?.sheets?.["a.pdf"] === undefined, { timeout: 30_000 })
    .toBe(true);
  await settle();
  expect(readConfig(folder)?.sheets?.["a.pdf"], "entry after both saves").toBeUndefined();
  expect(await viewerHeart(launched), "heart after both saves").toBe("mdi-heart-outline");
  expect(await snackbarText(launched), "no notice").toBe("");

  // Three presses: the last one marks it.
  await button.evaluate((el: HTMLElement) => {
    el.click();
    el.click();
    el.click();
  });
  await expect.poll(() => readConfig(folder)?.sheets?.["a.pdf"]?.favorite, { timeout: 30_000 }).toBe(true);
  await settle();
  expect(readConfig(folder)?.sheets?.["a.pdf"]?.favorite, "favorite after three saves").toBe(true);
  expect(await viewerHeart(launched), "heart after three saves").toBe("mdi-heart");
});

test("opening a sheet without a change writes nothing", async () => {
  // With an entry that has a fingerprint, and a sheet without an entry.
  const folder = newFolder();
  writeConfig(folder, {
    version: 1,
    setLists: { version: 2, setLists: [] },
    sheets: { "a.pdf": { favorite: true, pageDividers: { "1": 0.6 }, fingerprint: fingerprintOf(pdfA) } },
  });
  const before = configState(folder);
  const launched = await start(folder);

  await showSheet(launched, folder, "a.pdf");
  await expect.poll(() => viewerHeart(launched), { timeout: 30_000 }).toBe("mdi-heart");
  await leaveSheet(launched);
  await showSheet(launched, folder, "b.pdf");
  await expect.poll(() => launched.page.getByTestId("favorite-current").isEnabled(), { timeout: 30_000 }).toBe(true);
  expect(await viewerHeart(launched), "heart of b").toBe("mdi-heart-outline");
  await leaveSheet(launched);
  await showFolder(launched, "/");
  await expect.poll(() => cardHeart(launched, "a"), { timeout: 30_000 }).toBe("mdi-heart");
  await settle();
  expect(configState(folder), ".config.json bytes and mtime").toEqual(before);
  expect(fs.readFileSync(path.join(folder, "a.pdf")).equals(Buffer.from(pdfA)), "a.pdf unchanged").toBe(true);
  expect(fs.readFileSync(path.join(folder, "b.pdf")).equals(Buffer.from(pdfB)), "b.pdf unchanged").toBe(true);

  // Without any `.config.json`.
  const empty = newFolder();
  const second = await start(empty);
  await showSheet(second, empty, "a.pdf");
  await expect.poll(() => second.page.getByTestId("favorite-current").isEnabled(), { timeout: 30_000 }).toBe(true);
  expect(await viewerHeart(second), "heart without a file").toBe("mdi-heart-outline");
  await leaveSheet(second);
  await showFolder(second, "/");
  await expect.poll(() => cardHeart(second, "a"), { timeout: 30_000 }).toBe("mdi-heart-outline");
  await settle();
  expect(fs.existsSync(configPath(empty)), ".config.json created").toBe(false);
  expect(fs.readFileSync(path.join(empty, "a.pdf")).equals(Buffer.from(pdfA)), "a.pdf unchanged").toBe(true);
});

test("unreadable .config.json: no hearts on cards; the viewer button shows the reason and writes nothing", async () => {
  const folder = newFolder();
  fs.writeFileSync(configPath(folder), "{ broken");
  const before = configState(folder);
  const launched = await start(folder);

  await showFolder(launched, "/");
  await card(launched, "b").waitFor();
  await settle();
  expect(await launched.page.getByTestId("favorite-toggle").count(), "hearts on the cards").toBe(0);

  await showSheet(launched, folder, "a.pdf");
  const button = launched.page.getByTestId("favorite-current");
  await expect.poll(() => button.isEnabled(), { timeout: 30_000 }).toBe(true);
  expect(await viewerHeart(launched), "heart before the press").toBe("mdi-heart-outline");
  await button.click();
  await expect.poll(() => snackbarText(launched), { timeout: 15_000 }).toContain(UNREADABLE_PREFIX);
  expect((await snackbarText(launched)).endsWith(UNREADABLE_SUFFIX), "notice ends with the hint").toBe(true);
  await settle();
  expect(await viewerHeart(launched), "heart after the press").toBe("mdi-heart-outline");
  expect(configState(folder), ".config.json bytes and mtime").toEqual(before);
  expect(fs.readFileSync(path.join(folder, "a.pdf")).equals(Buffer.from(pdfA)), "PDF bytes unchanged").toBe(true);
});

test("a moved favorite: its card shows an empty heart until opened, then it is a favorite", async () => {
  const folder = newFolder();
  writeConfig(folder, { version: 1, sheets: { "a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) } } });
  fs.mkdirSync(path.join(folder, "sub"));
  fs.renameSync(path.join(folder, "a.pdf"), path.join(folder, "sub", "c.pdf"));
  const before = configState(folder);
  const launched = await start(folder);

  await showFolder(launched, "/sub/");
  await expect.poll(() => cardHeart(launched, "c"), { timeout: 30_000 }).toBe("mdi-heart-outline");
  await settle();
  expect(configState(folder), ".config.json while only shown").toEqual(before);

  await showSheet(launched, folder, "sub/c.pdf");
  await expect.poll(() => viewerHeart(launched), { timeout: 30_000 }).toBe("mdi-heart");
  const config = readConfig(folder);
  expect(config?.sheets?.["sub/c.pdf"], "entry at the new key").toEqual({ favorite: true, fingerprint: fingerprintOf(pdfA) });
  expect(config?.sheets?.["a.pdf"], "entry at the old key").toBeUndefined();

  await leaveSheet(launched);
  await showFolder(launched, "/sub/");
  await expect.poll(() => cardHeart(launched, "c"), { timeout: 30_000 }).toBe("mdi-heart");
  expect(fs.readFileSync(path.join(folder, "sub", "c.pdf")).equals(Buffer.from(pdfA)), "PDF bytes unchanged").toBe(true);
});

// ---------------------------------------------------------------------------------------------------------
// The main page (spec „Startseite“)
// ---------------------------------------------------------------------------------------------------------

const NO_FAVORITES_HINT = "Noch keine Favoriten. Markiere Blätter mit dem Herz.";

/** Shows the main page. */
async function showOverview(launched: LaunchedApp): Promise<void> {
  await push(launched, { name: "Overview" });
  await launched.page.locator(".v-card", { hasText: "Folder Selection" }).waitFor();
}

/** The favorite cards of the main page in their order: name, and the folder below it ("" on the top level). */
const favoriteCards = (launched: LaunchedApp) =>
  launched.page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="favorite-card"]')].map((el) => ({
      name: (el.querySelector(".favoriteName")?.textContent ?? "").trim(),
      dir: (el.querySelector(".favoriteDir")?.textContent ?? "").trim(),
    })),
  );

/** The favorite card `name` with the folder `dir`. */
const favoriteCard = (launched: LaunchedApp, name: string, dir = "") =>
  launched.page
    .getByTestId("favorite-card")
    .filter({ has: launched.page.locator(".favoriteName", { hasText: new RegExp(`^\\s*${name}\\s*$`) }) })
    .filter({ has: launched.page.locator(".favoriteDir", { hasText: new RegExp(`^\\s*${dir}\\s*$`) }) });

const favoritesError = (launched: LaunchedApp) =>
  launched.page.evaluate(() => (document.querySelector('[data-testid="favorites-error"]')?.textContent ?? "").trim());
const favoritesHint = (launched: LaunchedApp) =>
  launched.page.evaluate(() => (document.querySelector('[data-testid="favorites-empty"]')?.textContent ?? "").trim());

/** Writes `bytes` to `relative` below `folder`, creating its folders. */
function putPdf(folder: string, relative: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(path.join(folder, relative)), { recursive: true });
  fs.writeFileSync(path.join(folder, relative), bytes);
}

const samePdf = (folder: string, relative: string, bytes: Uint8Array) =>
  fs.readFileSync(path.join(folder, relative)).equals(Buffer.from(bytes));

test("the main page shows favorites sorted, a click opens the sheet", async () => {
  const folder = newFolder();
  putPdf(folder, "sub/a.pdf", pdfA);
  putPdf(folder, "x/a.pdf", pdfA);
  putPdf(folder, "C.pdf", pdfB);
  writeConfig(folder, {
    version: 1,
    sheets: {
      "C.pdf": { favorite: true },
      "x/a.pdf": { favorite: true },
      "b.pdf": { favorite: true, fingerprint: fingerprintOf(pdfB) },
      "sub/a.pdf": { favorite: true },
      "a.pdf": { pageDividers: { "1": 0.6 } },
    },
  });
  const before = configState(folder);
  const launched = await start(folder);
  await showOverview(launched);

  expect(await launched.page.locator(".v-card", { hasText: "Set Lists" }).count(), "set lists card").toBe(1);
  expect(await launched.page.getByText("Favoriten", { exact: true }).count(), "heading").toBe(1);
  await expect.poll(() => favoriteCards(launched), { timeout: 30_000 }).toEqual([
    { name: "a", dir: "sub" },
    { name: "a", dir: "x" },
    { name: "b", dir: "" },
    { name: "C", dir: "" },
  ]);
  expect(await launched.page.getByTestId("favorite-card").getByTestId("favorite-toggle").count(), "hearts").toBe(4);
  expect(await favoritesHint(launched), "no hint").toBe("");

  await favoriteCard(launched, "a", "x").click();
  await launched.page.waitForSelector("#sheetViewerWrapper canvas[data-page]", { state: "attached", timeout: 30_000 });
  const params = await launched.page.evaluate(() => {
    const vueApp = (document.querySelector("#app") as unknown as {
      __vue_app__: { config: { globalProperties: { $router: { currentRoute: { value: { name: string; params: unknown } } } } } };
    }).__vue_app__;
    const route = vueApp.config.globalProperties.$router.currentRoute.value;
    return { name: route.name, params: route.params };
  });
  expect(params, "route of the click").toEqual({ name: "SheetViewer", params: { path: path.join(folder, "x", "a.pdf") } });
  await launched.page.waitForSelector(SHEET_LOADED, { state: "attached", timeout: 60_000 });
  await expect.poll(() => viewerHeart(launched), { timeout: 30_000 }).toBe("mdi-heart");
  await settle();
  expect(configState(folder), ".config.json bytes and mtime").toEqual(before);
  expect(samePdf(folder, "x/a.pdf", pdfA), "PDF bytes unchanged").toBe(true);
});

test("no favorites: the hint", async () => {
  const folder = newFolder();
  const launched = await start(folder);
  await showOverview(launched);
  await expect.poll(() => favoritesHint(launched), { timeout: 30_000 }).toBe(NO_FAVORITES_HINT);
  expect(await launched.page.getByText("Favoriten", { exact: true }).count(), "heading").toBe(1);
  expect(await launched.page.getByTestId("favorite-card").count(), "favorite cards").toBe(0);
  expect(await favoritesError(launched), "no error").toBe("");
  await settle();
  expect(fs.existsSync(configPath(folder)), ".config.json created").toBe(false);

  // A file with entries but no favorite (only a divider) shows the hint, too.
  const other = newFolder();
  writeConfig(other, { version: 1, sheets: { "a.pdf": { pageDividers: { "1": 0.6 } } } });
  const before = configState(other);
  const second = await start(other);
  await showOverview(second);
  await expect.poll(() => favoritesHint(second), { timeout: 30_000 }).toBe(NO_FAVORITES_HINT);
  await settle();
  expect(configState(other), ".config.json bytes and mtime").toEqual(before);
});

test("unmark on the main page removes the card", async () => {
  const folder = newFolder();
  writeConfig(folder, {
    version: 1,
    sheets: {
      "a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) },
      "b.pdf": { favorite: true, pageDividers: { "1": 0.6 }, fingerprint: fingerprintOf(pdfB) },
    },
  });
  const launched = await start(folder);
  await showOverview(launched);
  await expect.poll(() => favoriteCards(launched), { timeout: 30_000 }).toEqual([
    { name: "a", dir: "" },
    { name: "b", dir: "" },
  ]);

  await favoriteCard(launched, "b").getByTestId("favorite-toggle").click();
  await expect.poll(() => favoriteCards(launched)).toEqual([{ name: "a", dir: "" }]);
  await expect.poll(() => readConfig(folder)?.sheets?.["b.pdf"]?.favorite, { timeout: 30_000 }).toBeUndefined();
  await settle();
  expect(await routeName(launched), "route after the press").toBe("Overview");
  expect(await launched.page.locator("#sheetViewerWrapper").count(), "viewer shown").toBe(0);
  expect(readConfig(folder)?.sheets, "entries after the press").toEqual({
    "a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) },
    "b.pdf": { pageDividers: { "1": 0.6 }, fingerprint: fingerprintOf(pdfB) },
  });
  expect(await snackbarText(launched), "no notice").toBe("");

  // The last one: the hint replaces the cards.
  await favoriteCard(launched, "a").getByTestId("favorite-toggle").click();
  await expect.poll(() => favoritesHint(launched)).toBe(NO_FAVORITES_HINT);
  await expect.poll(() => readConfig(folder)?.sheets?.["a.pdf"], { timeout: 30_000 }).toBeUndefined();
  expect(samePdf(folder, "a.pdf", pdfA), "a.pdf unchanged").toBe(true);
  expect(samePdf(folder, "b.pdf", pdfB), "b.pdf unchanged").toBe(true);
});

test("a moved and a renamed favorite show at their new place; the config has the new keys", async () => {
  const folder = newFolder();
  writeConfig(folder, {
    version: 1,
    setLists: { version: 2, setLists: [] },
    sheets: {
      "a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) },
      "b.pdf": { favorite: true, pageDividers: { "2": 0.3 }, fingerprint: fingerprintOf(pdfB) },
    },
  });
  // a.pdf moves to another folder, b.pdf is renamed in place; an unrelated PDF lies in between.
  putPdf(folder, "other/z.pdf", await makePdf({ pages: 1, xref: "table" }));
  fs.mkdirSync(path.join(folder, "Pop"));
  fs.renameSync(path.join(folder, "a.pdf"), path.join(folder, "Pop", "a.pdf"));
  fs.renameSync(path.join(folder, "b.pdf"), path.join(folder, "b neu.pdf"));
  const launched = await start(folder);
  await showOverview(launched);

  await expect.poll(() => favoriteCards(launched), { timeout: 60_000 }).toEqual([
    { name: "a", dir: "Pop" },
    { name: "b neu", dir: "" },
  ]);
  const config = readConfig(folder) as StoredConfig & { setLists?: unknown };
  expect(config.sheets, "entries at the new keys").toEqual({
    "Pop/a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) },
    "b neu.pdf": { favorite: true, pageDividers: { "2": 0.3 }, fingerprint: fingerprintOf(pdfB) },
  });
  expect(config.setLists, "set lists").toEqual({ version: 2, setLists: [] });
  expect(config.version, "version").toBe(1);
  expect(samePdf(folder, "Pop/a.pdf", pdfA), "Pop/a.pdf unchanged").toBe(true);
  expect(samePdf(folder, "b neu.pdf", pdfB), "b neu.pdf unchanged").toBe(true);

  // The moved card opens the sheet at its new place.
  await favoriteCard(launched, "a", "Pop").click();
  await launched.page.waitForSelector("#sheetViewerWrapper canvas[data-page]", { state: "attached", timeout: 30_000 });
  await expect.poll(() => viewerHeart(launched), { timeout: 30_000 }).toBe("mdi-heart");
});

test("a missing favorite is hidden, its mark stays; back in place it shows again", async () => {
  const folder = newFolder();
  writeConfig(folder, {
    version: 1,
    sheets: {
      "a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) },
      "b.pdf": { favorite: true, fingerprint: fingerprintOf(pdfB) },
    },
  });
  fs.rmSync(path.join(folder, "a.pdf"));
  const before = configState(folder);
  const launched = await start(folder);
  await showOverview(launched);

  await expect.poll(() => favoriteCards(launched), { timeout: 30_000 }).toEqual([{ name: "b", dir: "" }]);
  // Gives the background search time to run (it finds nothing).
  await settle();
  expect(await favoriteCards(launched), "cards after the search").toEqual([{ name: "b", dir: "" }]);
  expect(configState(folder), ".config.json while a.pdf is missing").toEqual(before);

  fs.writeFileSync(path.join(folder, "a.pdf"), pdfA);
  await showFolder(launched, "/");
  await showOverview(launched);
  await expect.poll(() => favoriteCards(launched), { timeout: 30_000 }).toEqual([
    { name: "a", dir: "" },
    { name: "b", dir: "" },
  ]);
  await settle();
  expect(configState(folder), ".config.json after a.pdf is back").toEqual(before);
});

/** The text of the main page's "nicht gefunden" line ("" while it is not shown). */
const notFoundLine = (launched: LaunchedApp) =>
  launched.page.evaluate(() =>
    (document.querySelector('[data-testid="favorites-not-found"] .notFoundText')?.textContent ?? "").trim(),
  );
/** The entries of the opened "nicht gefunden" list. */
const notFoundEntries = (launched: LaunchedApp) =>
  launched.page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="favorite-not-found"] .notFoundName')].map((el) =>
      (el.textContent ?? "").trim(),
    ),
  );

test("favorites not found are listed after the search; Entfernen and Alle entfernen unmark them", async () => {
  const folder = newFolder();
  fs.rmSync(path.join(folder, "a.pdf"));
  const a = { favorite: true, pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfA) };
  const b = { favorite: true, fingerprint: fingerprintOf(pdfB) };
  writeConfig(folder, {
    version: 1,
    sheets: { "a.pdf": a, "b.pdf": b, "c.pdf": { favorite: true }, "d.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) } },
  });
  const before = configState(folder);
  const launched = await start(folder);
  await showOverview(launched);

  await expect.poll(() => favoriteCards(launched), { timeout: 30_000 }).toEqual([{ name: "b", dir: "" }]);
  await expect.poll(() => notFoundLine(launched), { timeout: 30_000 }).toBe("3 Favoriten nicht gefunden");
  expect(await favoritesHint(launched), "no hint").toBe("");
  expect(await notFoundEntries(launched), "collapsed").toEqual([]);
  expect(configState(folder), ".config.json after the search").toEqual(before);

  const toggle = launched.page.getByTestId("favorites-not-found-toggle");
  expect((await toggle.textContent())?.trim()).toBe("Anzeigen");
  await toggle.click();
  await expect.poll(() => notFoundEntries(launched)).toEqual(["a", "c", "d"]);
  expect((await toggle.textContent())?.trim()).toBe("Ausblenden");

  await launched.page
    .getByTestId("favorite-not-found")
    .filter({ has: launched.page.locator(".notFoundName", { hasText: /^\s*a\s*$/ }) })
    .getByTestId("favorite-not-found-remove")
    .click();
  await expect.poll(() => notFoundEntries(launched)).toEqual(["c", "d"]);
  expect(await notFoundLine(launched)).toBe("2 Favoriten nicht gefunden");
  await expect
    .poll(() => readConfig(folder)?.sheets?.["a.pdf"], { timeout: 30_000 })
    .toEqual({ pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfA) });

  await launched.page.getByTestId("favorites-not-found-remove-all").click();
  await expect.poll(() => notFoundLine(launched)).toBe("");
  await expect
    .poll(() => readConfig(folder)?.sheets, { timeout: 30_000 })
    .toEqual({ "a.pdf": { pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfA) }, "b.pdf": b });
  expect(await favoriteCards(launched), "cards").toEqual([{ name: "b", dir: "" }]);
  expect(await snackbarText(launched), "no notice").toBe("");
  expect(samePdf(folder, "b.pdf", pdfB), "b.pdf unchanged").toBe(true);
});

test("a copy of a favorite is no favorite", async () => {
  const folder = newFolder();
  writeConfig(folder, { version: 1, sheets: { "a.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) } } });
  putPdf(folder, "sub/a.pdf", pdfA);
  putPdf(folder, "a Kopie.pdf", pdfA);
  const before = configState(folder);
  const launched = await start(folder);
  await showOverview(launched);

  await expect.poll(() => favoriteCards(launched), { timeout: 30_000 }).toEqual([{ name: "a", dir: "" }]);
  await settle();
  expect(await favoriteCards(launched), "cards after a while").toEqual([{ name: "a", dir: "" }]);

  await showFolder(launched, "/");
  await expect.poll(() => cardHeart(launched, "a Kopie"), { timeout: 30_000 }).toBe("mdi-heart-outline");
  await showSheet(launched, folder, "a Kopie.pdf");
  await expect.poll(() => launched.page.getByTestId("favorite-current").isEnabled(), { timeout: 30_000 }).toBe(true);
  expect(await viewerHeart(launched), "heart of the copy").toBe("mdi-heart-outline");
  await leaveSheet(launched);
  await showSheet(launched, folder, "sub/a.pdf");
  await expect.poll(() => launched.page.getByTestId("favorite-current").isEnabled(), { timeout: 30_000 }).toBe(true);
  expect(await viewerHeart(launched), "heart of the copy in sub").toBe("mdi-heart-outline");
  await leaveSheet(launched);
  await showOverview(launched);
  await expect.poll(() => favoriteCards(launched), { timeout: 30_000 }).toEqual([{ name: "a", dir: "" }]);
  await settle();
  expect(configState(folder), ".config.json bytes and mtime").toEqual(before);
});

test("unreadable .config.json: the reason instead of favorites, other cards work", async () => {
  const folder = newFolder();
  fs.writeFileSync(configPath(folder), "{ broken");
  const before = configState(folder);
  const launched = await start(folder);
  await showOverview(launched);

  await expect.poll(() => favoritesError(launched), { timeout: 30_000 }).toContain(UNREADABLE_PREFIX);
  expect((await favoritesError(launched)).endsWith(UNREADABLE_SUFFIX), "reason ends with the hint").toBe(true);
  expect(await launched.page.getByText("Favoriten", { exact: true }).count(), "heading").toBe(1);
  expect(await launched.page.getByTestId("favorite-card").count(), "favorite cards").toBe(0);
  expect(await favoritesHint(launched), "no hint").toBe("");

  await launched.page.locator(".v-card", { hasText: "Folder Selection" }).click();
  await expect.poll(() => routeName(launched)).toBe("SheetSelection");
  await card(launched, "a").waitFor({ timeout: 30_000 });
  await showOverview(launched);
  await launched.page.locator(".v-card", { hasText: "Set Lists" }).click();
  await expect.poll(() => routeName(launched)).toBe("SetListList");
  await settle();
  expect(configState(folder), ".config.json bytes and mtime").toEqual(before);
  expect(samePdf(folder, "a.pdf", pdfA), "PDF bytes unchanged").toBe(true);
});
