import { expect, test } from "vitest";
import { corpusDir, listCorpus } from "./corpus";
import { currentApp, openSheet } from "./electronDriver";

const corpus = listCorpus();

if (corpus.length === 0) test.skip("Noten/ corpus with .data files is missing");
else {
  test("the app starts without any network request and renders with the bundled Roboto", async () => {
    const app = await currentApp();
    const session = await openSheet(app, corpusDir, corpus[0].pdfPath);
    try {
      const { appBarFamily, robotoLoaded } = await session.fontStatus();
      expect(appBarFamily).toContain("Roboto");
      expect(robotoLoaded).toBe(true);
      expect(session.networkRequests()).toEqual([]);
    } finally {
      await session.close();
    }
  });
}
