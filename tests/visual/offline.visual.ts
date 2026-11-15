import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { copyCorpus, listCorpus, repoRoot } from "./corpus";
import { currentApp, openSheet } from "./electronDriver";

const corpus = listCorpus();

if (corpus.length === 0) test.skip("Noten/ corpus with .data files is missing");
else {
  test("the app starts without any network request and renders with the bundled Roboto", async () => {
    // The new app migrates (writes) on open: never open sheets in Noten/ itself.
    const folder = copyCorpus(path.join(repoRoot, "test-results", "visual", "work"));
    try {
      const app = await currentApp();
      const session = await openSheet(app, folder, corpus[0].pdfPath);
      try {
        const { appBarFamily, robotoLoaded } = await session.fontStatus();
        expect(appBarFamily).toContain("Roboto");
        expect(robotoLoaded).toBe(true);
        expect(session.networkRequests()).toEqual([]);
      } finally {
        await session.close();
      }
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
}
