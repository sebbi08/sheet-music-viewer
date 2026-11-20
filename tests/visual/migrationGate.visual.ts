import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeAll, expect, test } from "vitest";
import { getSidecarPath } from "../../src/pdfMarkup/legacySidecar";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { makeEncryptedPdf, makePdf } from "../pdfMarkup/fixtures";
import { repoRoot } from "./corpus";
import { type AppUnderTest, currentApp, launchApp, type LaunchedApp, settleBulkMigration } from "./electronDriver";

/**
 * The migration gate (spec 2026-11-20) end to end, headless, on synthetic folders below
 * test-results/visual/work/ (no corpus needed): a folder with legacy `.data` files must pass the gate
 * before any sheet opens; a failed check lists every problem and changes nothing.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
const ZIP_PATTERN = /^Markierungen-Backup \d{4}-\d{2}-\d{2} \d{2}-\d{2}( \(\d+\))?\.zip$/;
const MIGRATED_FOLDERS = "markup-migrated-folders.json";
const DAMAGED_TEXT = "Die alte Markierungsdatei „.b.data“ ist beschädigt. Bitte die Datei löschen und die Markierungen neu eintragen.";
const READ_ONLY_TEXT = "Die PDF oder ihr Ordner ist schreibgeschützt. Bitte den Schreibschutz entfernen.";
const ENCRYPTED_TEXT = "Die PDF ist verschlüsselt. Bitte den Kennwortschutz entfernen.";
/** chmod-based read-only files do not work as root or on Windows. */
const canMakeReadOnly = process.getuid?.() !== 0 && process.platform !== "win32";

/** A legacy `.data` file (old app) with one rectangle on page 1. */
const rect = { type: "rect", left: 100, top: 200, width: 50, height: 40, angle: 0, scaleX: 1, scaleY: 1, fill: "red" };
const LEGACY_DATA = JSON.stringify([{ page: 1, data: { version: "7", objects: [rect] }, drawWidth: 300, drawHeight: 400 }]);
const DAMAGED_DATA = "{not json";

let app: AppUnderTest;
let pdfBytes: Uint8Array;
/** Everything a test created: removed after each test, also when it failed. */
const cleanups: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  app = await currentApp();
  pdfBytes = await makePdf({ xref: "table" });
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
});

const isBelow = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** A fresh folder below workDir, removed after the test (read-only files made writable first). */
function newFolder(): string {
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "gate-"));
  cleanups.push(() => {
    if (!isBelow(fs.realpathSync(workDir), fs.realpathSync(folder))) throw new Error(`not a work folder: ${folder}`);
    for (const name of fs.readdirSync(folder)) fs.chmodSync(path.join(folder, name), 0o644);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

/** A fresh Electron profile, removed after the test. */
function newProfile(): string {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "smv-visual-profile-"));
  cleanups.push(() => fs.rmSync(profile, { recursive: true, force: true }));
  return profile;
}

/** Writes `name` (a PDF) and, unless `data` is null, its legacy `.data` file. */
function addPdf(folder: string, name: string, data: string | null = LEGACY_DATA, bytes: Uint8Array = pdfBytes): string {
  const pdf = path.join(folder, name);
  fs.writeFileSync(pdf, bytes);
  if (data !== null) fs.writeFileSync(getSidecarPath(pdf), data);
  return pdf;
}

/** Starts the app with the gate enabled; it is closed after the test. */
async function start(folder: string, profile: string): Promise<LaunchedApp> {
  const launched = await launchApp(app, folder, { bulkMigration: true, profile });
  cleanups.push(() => launched.close());
  return launched;
}

/** The app's set lists: written into the sheet folder on every start, not by the gate. */
const SET_LISTS_FILE = ".set-lists.json";

/** sha256 of every file in `folder` (except the set lists), by name. */
function snapshot(folder: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of fs.readdirSync(folder).sort()) {
    if (name === SET_LISTS_FILE) continue;
    result[name] = createHash("sha256").update(fs.readFileSync(path.join(folder, name))).digest("hex");
  }
  return result;
}

const zipsIn = (folder: string) => fs.readdirSync(folder).filter((name) => name.startsWith("Markierungen-Backup"));
const legacyFilesIn = (folder: string) => fs.readdirSync(folder).filter((name) => name.endsWith(".data"));

/** The folders the profile remembers as migrated ([] without the file). */
function migratedFolders(profile: string): string[] {
  const file = path.join(profile, MIGRATED_FOLDERS);
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { folders: string[] }).folders;
}

async function embeddedPages(pdf: string): Promise<number[]> {
  const doc = await PDFDocument.load(fs.readFileSync(pdf), { updateMetadata: false });
  return readMarkup(doc).pages.map((p) => p.page);
}

const routeName = (launched: LaunchedApp) =>
  launched.page.evaluate(() => {
    const vueApp = (document.querySelector("#app") as unknown as {
      __vue_app__: { config: { globalProperties: { $router: { currentRoute: { value: { name: unknown } } } } } };
    }).__vue_app__;
    return String(vueApp.config.globalProperties.$router.currentRoute.value.name);
  });

/** Replaces the native folder dialog of the main process: it answers with `folder`. */
async function stubFolderDialog(launched: LaunchedApp, folder: string): Promise<void> {
  await launched.electronApp.evaluate(({ dialog }, f) => {
    const stub = async () => ({ canceled: false, filePaths: [f] });
    Object.defineProperty(dialog, "showOpenDialog", { value: stub, configurable: true, writable: true });
  }, folder);
}

const waitForGate = (launched: LaunchedApp, state: "passed" | "failed") =>
  launched.page.waitForFunction((s) => document.documentElement.dataset.migrationGate === s, state, { timeout: 120_000 });

test("two legacy files pass the gate; the second start shows nothing", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const profile = newProfile();
  const a = addPdf(folder, "a.pdf");
  const b = addPdf(folder, "b.pdf");

  const first = await start(folder, profile);
  const outcome = await settleBulkMigration(first.page);
  console.log(`first start: ${JSON.stringify(outcome)}`);
  expect(outcome.status).toBe("passed");
  expect(outcome.dialogShown).toBe(true);
  expect(outcome.migrated).toBe(2);
  expect(outcome.lines[0]).toBe("2 Dateien übernommen.");
  expect(outcome.zipName ?? "").toMatch(ZIP_PATTERN);
  await first.close();

  const zips = zipsIn(folder);
  expect(zips).toEqual([outcome.zipName]);
  expect(legacyFilesIn(folder)).toEqual([]);
  expect(await embeddedPages(a)).toEqual([1]);
  expect(await embeddedPages(b)).toEqual([1]);
  expect(migratedFolders(profile)).toEqual([path.resolve(folder)]);
  const after = snapshot(folder);

  const second = await start(folder, profile);
  const again = await settleBulkMigration(second.page);
  expect(again.status).toBe("passed");
  expect(again.dialogShown, "dialog on the second start").toBe(false);
  await second.close();
  expect(snapshot(folder)).toEqual(after);
});

test("a damaged .data among healthy files: full list, folder untouched, Schließen ends the app", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const profile = newProfile();
  addPdf(folder, "a.pdf");
  addPdf(folder, "b.pdf", DAMAGED_DATA);
  const before = snapshot(folder);

  const launched = await start(folder, profile);
  const outcome = await settleBulkMigration(launched.page);
  console.log(`damaged: ${JSON.stringify(outcome)}`);
  expect(outcome.status).toBe("failed");
  expect(outcome.headline).toBe("1 von 2 Dateien hat ein Problem. Es wurde nichts verändert. Bitte beheben und erneut prüfen.");
  expect(outcome.failures).toEqual([{ path: "b.pdf", text: DAMAGED_TEXT }]);
  expect(snapshot(folder)).toEqual(before);
  expect(zipsIn(folder)).toEqual([]);

  await launched.page.getByTestId("migration-close").click();
  expect(await launched.waitForExit(30_000), "app ended by Schließen").toBe(true);
  expect(snapshot(folder)).toEqual(before);
  expect(migratedFolders(profile)).toEqual([]);
});

test.skipIf(!canMakeReadOnly)("a read-only PDF and an encrypted PDF are both listed", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const profile = newProfile();
  const a = addPdf(folder, "a.pdf");
  fs.chmodSync(a, 0o444);
  addPdf(folder, "b.pdf", LEGACY_DATA, makeEncryptedPdf());
  addPdf(folder, "c.pdf");
  const before = snapshot(folder);

  const launched = await start(folder, profile);
  const outcome = await settleBulkMigration(launched.page);
  console.log(`read-only and encrypted: ${JSON.stringify(outcome)}`);
  expect(outcome.status).toBe("failed");
  expect(outcome.headline).toBe("2 von 3 Dateien haben ein Problem. Es wurde nichts verändert. Bitte beheben und erneut prüfen.");
  expect(outcome.failures).toEqual([
    { path: "a.pdf", text: READ_ONLY_TEXT },
    { path: "b.pdf", text: ENCRYPTED_TEXT },
  ]);
  expect(snapshot(folder)).toEqual(before);
  expect(zipsIn(folder)).toEqual([]);
});

test("no sheet opens while the list is shown", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const profile = newProfile();
  const a = addPdf(folder, "a.pdf");
  addPdf(folder, "b.pdf", DAMAGED_DATA);

  const launched = await start(folder, profile);
  expect((await settleBulkMigration(launched.page)).status).toBe("failed");
  const routeBefore = await routeName(launched);
  // Like a click on a sheet in the list, a set list or the search.
  await launched.page.evaluate((p) => {
    const vueApp = (document.querySelector("#app") as unknown as {
      __vue_app__: { config: { globalProperties: { $router: { push(to: unknown): Promise<unknown> } } } };
    }).__vue_app__;
    return vueApp.config.globalProperties.$router.push({ name: "SheetViewer", params: { path: p } });
  }, a);
  await launched.page.waitForTimeout(1000);
  expect(await routeName(launched)).toBe(routeBefore);
  expect(routeBefore).not.toBe("SheetViewer");
  expect(await launched.page.locator("#sheetViewerWrapper").count()).toBe(0);
  await expect(launched.page.getByTestId("migration-failed").isVisible()).resolves.toBe(true);
});

test("Erneut prüfen after fixing the file passes the gate", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const profile = newProfile();
  const a = addPdf(folder, "a.pdf");
  const b = addPdf(folder, "b.pdf", DAMAGED_DATA);

  const launched = await start(folder, profile);
  expect((await settleBulkMigration(launched.page)).status).toBe("failed");
  fs.rmSync(getSidecarPath(b));
  await launched.page.getByTestId("migration-recheck").click();
  await waitForGate(launched, "passed");
  const outcome = await settleBulkMigration(launched.page);
  expect(outcome.status).toBe("passed");
  expect(outcome.lines[0]).toBe("1 Datei übernommen.");
  expect(legacyFilesIn(folder)).toEqual([]);
  expect(await embeddedPages(a)).toEqual([1]);
  expect(zipsIn(folder)).toHaveLength(1);
  expect(migratedFolders(profile)).toEqual([path.resolve(folder)]);
});

test("choosing the same folder again reruns the gate", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const profile = newProfile();
  const a = addPdf(folder, "a.pdf");
  const b = addPdf(folder, "b.pdf", DAMAGED_DATA);

  const launched = await start(folder, profile);
  expect((await settleBulkMigration(launched.page)).status).toBe("failed");
  fs.rmSync(getSidecarPath(b));
  await stubFolderDialog(launched, folder);
  await launched.page.getByTestId("migration-choose-folder").click();
  await waitForGate(launched, "passed");
  const outcome = await settleBulkMigration(launched.page);
  expect(outcome.status).toBe("passed");
  expect(outcome.lines[0]).toBe("1 Datei übernommen.");
  expect(await embeddedPages(a)).toEqual([1]);
  expect(await routeName(launched)).toBe("SheetSelection");
  expect(migratedFolders(profile)).toEqual([path.resolve(folder)]);
});

test("a folder without legacy files is marked without a dialog", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  const profile = newProfile();
  addPdf(folder, "a.pdf", null);
  const before = snapshot(folder);

  const launched = await start(folder, profile);
  const outcome = await settleBulkMigration(launched.page);
  expect(outcome.status).toBe("passed");
  expect(outcome.dialogShown).toBe(false);
  expect(migratedFolders(profile)).toEqual([path.resolve(folder)]);
  expect(snapshot(folder)).toEqual(before);
});

test("Abbrechen during the check closes the app and changes nothing", { timeout: 10 * 60_000 }, async () => {
  const folder = newFolder();
  const profile = newProfile();
  for (let i = 1; i <= 300; i++) addPdf(folder, `p${String(i).padStart(3, "0")}.pdf`);
  const before = snapshot(folder);

  const launched = await start(folder, profile);
  // The check of 300 files runs long enough to click "Abbrechen" while it shows its progress.
  await launched.page.getByTestId("migration-progress").filter({ hasText: "von 300" }).waitFor({ timeout: 120_000 });
  await launched.page.getByTestId("migration-cancel").click();
  expect(await launched.waitForExit(30_000), "app ended by Abbrechen").toBe(true);
  expect(snapshot(folder)).toEqual(before);
  expect(zipsIn(folder)).toEqual([]);
  expect(migratedFolders(profile)).toEqual([]);
});
