import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { copyCorpus, legacyDataPath, listCorpus, repoRoot } from "./corpus";
import { currentApp, openSheet } from "./electronDriver";

/**
 * Final review B2: a close whose renderer-side save never finishes must still end. The renderer's flush
 * is made to hang; main shows its own dialog after the (shortened) timeout, and a second close click
 * while the renderer is still stuck shows it at once. Headless, on a corpus copy.
 */
const TIMEOUT_MS = 3000;
const SAVING_NOTICE = "Markierungen werden gespeichert";
const corpus = listCorpus();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (corpus.length === 0) test.skip("Noten/ corpus with .data files is missing");
else {
  test("a hung save on closing: main's dialog after the timeout, at once on the next close, then the window closes", async () => {
    // The app migrates (writes) on open: never open sheets in Noten/ itself.
    const folder = copyCorpus(path.join(repoRoot, "test-results", "visual", "work"));
    const pdfFile = path.join(folder, corpus[0].pdfPath);
    try {
      const session = await openSheet(await currentApp(), folder, corpus[0].pdfPath, {
        env: { SMV_EXIT_GUARD_TIMEOUT_MS: String(TIMEOUT_MS) },
      });
      try {
        const deadline = Date.now() + 60_000;
        while (fs.existsSync(legacyDataPath(pdfFile)) && Date.now() < deadline) await sleep(200);
        expect(fs.existsSync(legacyDataPath(pdfFile)), "migration finished").toBe(false);
        // Entering and leaving edit mode without a change saves nothing, but gives the page the user
        // activation Chromium requires before beforeunload may block an unload.
        await session.toggleEdit();
        await session.toggleEdit();
        await sleep(1000);
        const pdfBefore = fs.readFileSync(pdfFile);

        await session.hangCloseSave();
        await session.stubMessageBox(2); // "Abbrechen"
        const closedAt = performance.now(); // monotonic: the WSL wall clock can jump
        await session.requestWindowClose();

        await sleep(1500);
        expect(await session.snackbarText(), "visible feedback while the save is running").toContain(SAVING_NOTICE);
        expect(await session.messageBoxCalls(), "no dialog before the timeout").toEqual([]);

        while ((await session.messageBoxCalls()).length === 0 && performance.now() - closedAt < 30_000) await sleep(100);
        const firstDialogAfter = performance.now() - closedAt;
        console.log(`main-side dialog ${Math.round(firstDialogAfter)} ms after the close request (timeout ${TIMEOUT_MS} ms)`);
        expect(await session.messageBoxCalls()).toEqual(["Markierungen konnten nicht gespeichert werden."]);
        expect(firstDialogAfter).toBeGreaterThanOrEqual(TIMEOUT_MS - 200);
        await sleep(1000);
        expect(await session.windowCount(), "'Abbrechen' keeps the window").toBe(1);

        // The renderer is still stuck. The next close asks at once; "Verwerfen und schließen" ends the app.
        await session.stubMessageBox(1);
        const secondAt = performance.now();
        await session.requestWindowClose();
        expect(await session.waitForExit(30_000), "the app exits").toBe(true);
        const exitAfter = performance.now() - secondAt;
        console.log(`app exited ${Math.round(exitAfter)} ms after the second close request`);
        expect(exitAfter, "the second close did not wait for the timeout").toBeLessThan(TIMEOUT_MS);
        expect(fs.readFileSync(pdfFile).equals(pdfBefore), "PDF untouched").toBe(true);
        expect(fs.existsSync(legacyDataPath(pdfFile)), "no sidecar").toBe(false);
        expect(session.networkRequests()).toEqual([]);
      } finally {
        await session.close();
      }
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
}
