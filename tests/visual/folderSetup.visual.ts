import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { getSidecarPath } from "../../src/pdfMarkup/legacySidecar";
import { makePdf } from "../pdfMarkup/fixtures";
import { repoRoot } from "./corpus";
import { currentApp, launchApp, type LaunchedApp } from "./electronDriver";

/**
 * Choosing a new sheet folder shows the current one: the folder page names it, and the folder dialog
 * opens at it (on the folder page and in the migration dialog's "Anderen Notenordner wählen").
 * No corpus needed: synthetic folders below test-results/visual/work/.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

function makeFolder(): string {
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "folder-setup-"));
  cleanups.push(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

async function start(folder: string, bulkMigration = false): Promise<LaunchedApp> {
  const launched = await launchApp(await currentApp(), folder, { bulkMigration });
  cleanups.push(() => launched.close());
  return launched;
}

/** Replaces the native folder dialog; records the options of every call and answers "cancelled". */
async function recordFolderDialog(launched: LaunchedApp): Promise<void> {
  await launched.electronApp.evaluate(({ dialog }) => {
    const calls: unknown[] = [];
    (globalThis as { __folderDialogCalls?: unknown[] }).__folderDialogCalls = calls;
    const stub = async (...args: unknown[]) => {
      // showOpenDialog(window?, options)
      calls.push(args[args.length - 1]);
      return { canceled: true, filePaths: [] };
    };
    Object.defineProperty(dialog, "showOpenDialog", { value: stub, configurable: true, writable: true });
  });
}

const folderDialogCalls = (launched: LaunchedApp) =>
  launched.electronApp.evaluate(() => (globalThis as { __folderDialogCalls?: { defaultPath?: string }[] }).__folderDialogCalls ?? []);

async function showFolderSetup(launched: LaunchedApp): Promise<void> {
  await launched.page.evaluate(() => {
    const app = (document.querySelector("#app") as unknown as {
      __vue_app__: { config: { globalProperties: { $router: { push(to: unknown): Promise<unknown> } } } };
    }).__vue_app__;
    return app.config.globalProperties.$router.push({ name: "FolderSetup" });
  });
}

test("the folder page shows the current folder and the dialog opens at it", async () => {
  const folder = makeFolder();
  const launched = await start(folder);
  await recordFolderDialog(launched);
  await showFolderSetup(launched);

  const current = launched.page.getByTestId("current-folder");
  await current.waitFor({ state: "visible", timeout: 30_000 });
  expect(await current.textContent()).toContain(folder);

  await launched.page.getByTestId("select-folder").click();
  await expect.poll(async () => (await folderDialogCalls(launched)).length, { timeout: 10_000 }).toBe(1);
  expect((await folderDialogCalls(launched))[0].defaultPath).toBe(folder);
});

test("Anderen Notenordner wählen opens the dialog at the current folder", async () => {
  const folder = makeFolder();
  const pdf = path.join(folder, "a.pdf");
  fs.writeFileSync(pdf, await makePdf({ xref: "table" }));
  fs.writeFileSync(getSidecarPath(pdf), '[{"page": 1, "data": {"objects": [ broken');
  const launched = await start(folder, true);
  await launched.page.waitForFunction(() => document.documentElement.dataset.migrationGate === "failed", undefined, {
    timeout: 120_000,
  });
  await recordFolderDialog(launched);

  await launched.page.getByTestId("migration-choose-folder").click();
  await expect.poll(async () => (await folderDialogCalls(launched)).length, { timeout: 10_000 }).toBe(1);
  expect((await folderDialogCalls(launched))[0].defaultPath).toBe(folder);
});
