import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { repoRoot } from "./corpus";
import { currentApp, launchApp, startExtraInstance } from "./electronDriver";

/**
 * Single-instance lock (src/main.ts): a second start with the same profile (userData) quits and leaves the
 * running app alone; instances with different profiles (as the visual tests use) still run side by side.
 * Headless, on an empty sheet folder.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
const EXTRA_INSTANCE_TIMEOUT_MS = 30_000;

const windowCount = (launched: Awaited<ReturnType<typeof launchApp>>) =>
  launched.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

test("a second start with the same profile quits and leaves the running app alone", async () => {
  const app = await currentApp();
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "single-instance-"));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "smv-visual-profile-"));
  try {
    const first = await launchApp(app, folder, { profile });
    try {
      const exitCode = await startExtraInstance(app, profile, EXTRA_INSTANCE_TIMEOUT_MS);
      expect(exitCode, "exit code of the second instance (null: still running)").toBe(0);
      expect(await first.waitForExit(500), "first instance exited").toBe(false);
      expect(await windowCount(first)).toBe(1);
    } finally {
      await first.close();
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("instances with different profiles run side by side", async () => {
  const app = await currentApp();
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "single-instance-"));
  try {
    const [a, b] = await Promise.all([launchApp(app, folder), launchApp(app, folder)]);
    try {
      expect(await windowCount(a)).toBe(1);
      expect(await windowCount(b)).toBe(1);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
