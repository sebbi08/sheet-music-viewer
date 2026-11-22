import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, expect, test } from "vitest";
import type { SetListsWrapper } from "../../src/models/types";
import { repoRoot } from "./corpus";
import { type AppUnderTest, currentApp, launchApp, type LaunchedApp } from "./electronDriver";

/**
 * Set lists live in `.config.json` in the sheet folder (spec 2026-11-22), end to end, headless, on synthetic
 * folders below test-results/visual/work/ (no corpus needed): each folder keeps its own set lists, the
 * legacy `.set-lists.json` is taken over, a start without changes writes nothing, and a broken file is
 * reported and never overwritten.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
const CONFIG = ".config.json";
const LEGACY = ".set-lists.json";
const UNREADABLE_PREFIX = `Die Setlisten konnten nicht geladen werden („${CONFIG}“: `;
const UNREADABLE_SUFFIX = "). Änderungen an Setlisten werden nicht gespeichert.";

const setListsWith = (id: number, name: string): SetListsWrapper => ({
  version: 2,
  setLists: [{ id, name, sheets: [{ path: [], name: "a.pdf", isFile: true, isSearch: false }] }],
});

let app: AppUnderTest;
/** Everything a test created, undone last-in first-out after each test, also when it failed. */
const cleanups: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  app = await currentApp();
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

function makeFolder(name: string): string {
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, `folder-config-${name}-`));
  cleanups.push(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

async function start(folder: string): Promise<LaunchedApp> {
  const launched = await launchApp(app, folder);
  cleanups.push(() => launched.close());
  return launched;
}

/** Every file in `folder` with its bytes and mtime. */
function snapshot(folder: string): Record<string, { bytes: string; mtimeMs: number }> {
  return Object.fromEntries(
    fs
      .readdirSync(folder)
      .sort()
      .map((name) => {
        const file = path.join(folder, name);
        return [name, { bytes: fs.readFileSync(file).toString("base64"), mtimeMs: fs.statSync(file).mtimeMs }];
      }),
  );
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

async function navigate(launched: LaunchedApp, name: string): Promise<void> {
  await launched.page.evaluate((routeName) => {
    const vueApp = (document.querySelector("#app") as unknown as {
      __vue_app__: { config: { globalProperties: { $router: { push(to: unknown): Promise<unknown> } } } };
    }).__vue_app__;
    return vueApp.config.globalProperties.$router.push({ name: routeName });
  }, name);
}

/** Names of the set lists the overview shows (without the "Add Set List" card). */
const shownSetLists = (launched: LaunchedApp) =>
  launched.page.evaluate(() =>
    [...document.querySelectorAll(".v-card:not(.addSetListCard) h2.itemName")].map((h) => (h.textContent ?? "").trim()),
  );

async function expectSetLists(launched: LaunchedApp, names: string[]): Promise<void> {
  await expect.poll(() => shownSetLists(launched), { timeout: 30_000 }).toEqual(names);
}

/** Adds a set list through the overview's dialog. */
async function addSetList(launched: LaunchedApp, name: string): Promise<void> {
  const { page } = launched;
  await page.locator(".addSetListCard").click();
  const dialog = page.locator(".v-overlay--active .v-card").filter({ hasText: "Add Set List" });
  await dialog.locator("input").fill(name);
  await dialog.getByRole("button", { name: "Save" }).click();
}

/** Replaces the native folder dialog: every call answers `folder`. */
async function stubFolderDialog(launched: LaunchedApp, folder: string): Promise<void> {
  await launched.electronApp.evaluate(({ dialog }, chosen) => {
    const stub = async () => ({ canceled: false, filePaths: [chosen] });
    Object.defineProperty(dialog, "showOpenDialog", { value: stub, configurable: true, writable: true });
  }, folder);
}

/** Lets any save the renderer might start run to its end. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 2_000));

test("set lists stay in their folder when another folder is chosen", async () => {
  const folderA = makeFolder("a");
  const folderB = makeFolder("b");
  fs.writeFileSync(path.join(folderA, CONFIG), JSON.stringify({ version: 1, setLists: setListsWith(1, "Liste A") }));
  fs.writeFileSync(path.join(folderB, CONFIG), JSON.stringify({ version: 1, setLists: setListsWith(7, "Liste B") }));
  const beforeA = snapshot(folderA);
  const beforeB = snapshot(folderB);

  const launched = await start(folderA);
  await navigate(launched, "SetListList");
  await expectSetLists(launched, ["Liste A"]);

  await stubFolderDialog(launched, folderB);
  await navigate(launched, "FolderSetup");
  await launched.page.getByTestId("select-folder").click();
  await launched.page.waitForFunction(() => location.hash.startsWith("#/sheetSelection"), undefined, { timeout: 30_000 });
  await navigate(launched, "SetListList");
  await expectSetLists(launched, ["Liste B"]);
  await settle();
  expect(snapshot(folderA), "folder A unchanged").toEqual(beforeA);
  expect(snapshot(folderB), "folder B unchanged").toEqual(beforeB);

  // A change made now goes into B only.
  await addSetList(launched, "Neu in B");
  await expectSetLists(launched, ["Liste B", "Neu in B"]);
  await expect
    .poll(() => (readJson(path.join(folderB, CONFIG)) as { setLists: SetListsWrapper }).setLists.setLists.map((l) => l.name), {
      timeout: 15_000,
    })
    .toEqual(["Liste B", "Neu in B"]);
  expect(fs.readdirSync(folderB)).toEqual([CONFIG]);
  await settle();
  expect(snapshot(folderA), "folder A unchanged after the change in B").toEqual(beforeA);
});

test(".set-lists.json is taken over into .config.json on start", async () => {
  const folder = makeFolder("legacy");
  const setLists = setListsWith(3, "Alte Liste");
  fs.writeFileSync(path.join(folder, LEGACY), JSON.stringify(setLists, null, 2));

  const launched = await start(folder);
  await expect.poll(() => fs.readdirSync(folder), { timeout: 30_000 }).toEqual([CONFIG]);
  expect(readJson(path.join(folder, CONFIG))).toEqual({ version: 1, setLists });
  await navigate(launched, "SetListList");
  await expectSetLists(launched, ["Alte Liste"]);
});

test("a start without changes does not write .config.json", async () => {
  const folder = makeFolder("unchanged");
  // Other formatting and key order than the app writes: still nothing to save.
  const setLists = setListsWith(5, "Unverändert");
  fs.writeFileSync(
    path.join(folder, CONFIG),
    `{"setLists":${JSON.stringify(setLists)},"version":1,"markupMigrated":{"at":"2026-11-22T10:15:00.000Z"}}`,
  );
  const before = snapshot(folder);

  const launched = await start(folder);
  await navigate(launched, "SetListList");
  await expectSetLists(launched, ["Unverändert"]);
  await settle();
  expect(snapshot(folder)).toEqual(before);
});

test("a broken .config.json shows the notice and is not overwritten", async () => {
  const folder = makeFolder("broken");
  fs.writeFileSync(path.join(folder, CONFIG), '{"version":1,"setLists":');
  const before = snapshot(folder);

  const launched = await start(folder);
  const snackbar = () =>
    launched.page.evaluate(() => (document.querySelector(".v-snackbar .v-snackbar__content")?.textContent ?? "").trim());
  await expect.poll(snackbar, { timeout: 30_000 }).toContain(UNREADABLE_PREFIX);
  const text = await snackbar();
  expect(text.startsWith(UNREADABLE_PREFIX), text).toBe(true);
  expect(text.endsWith(UNREADABLE_SUFFIX), text).toBe(true);
  expect(text.length).toBeGreaterThan(UNREADABLE_PREFIX.length + UNREADABLE_SUFFIX.length);

  // A set list added now is not saved.
  await navigate(launched, "SetListList");
  await expectSetLists(launched, []);
  await addSetList(launched, "Nicht gespeichert");
  await expectSetLists(launched, ["Nicht gespeichert"]);
  await settle();
  expect(snapshot(folder)).toEqual(before);
});
