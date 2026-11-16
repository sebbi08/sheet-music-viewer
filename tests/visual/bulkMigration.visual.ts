import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import yauzl from "yauzl";
import { expect, test } from "vitest";
import type { MarkupPayload } from "../../src/models/markup";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { copyCorpus, legacyDataPath, listCorpus, repoRoot } from "./corpus";
import { currentApp, openSheet, runBulkMigration, WINDOW } from "./electronDriver";
import { diffRatio, encodePng, markupMask, sideBySide } from "./imageCompare";
import { renderPdfPage } from "./pdfRender";

/**
 * Bulk migration (spec 2026-11-16, section 8) end to end, headless, on copies of the corpus:
 *   copy A  all legacy `.data` files migrated on start (one PDF read-only: reported, not written), the
 *           backup zip holds the original bytes, a sheet opened afterwards in the same session renders,
 *           a second start shows no dialog (the permanent failure is remembered in the profile)
 *   copy B  every PDF migrated on open (SheetViewer path), as in compare.visual.ts
 * A and B must end up with the same embedded payloads and the same stamp pixels per page, so checks
 * A–Er of compare.visual.ts (run on the open path) hold for the bulk migration, too.
 */
const corpus = listCorpus();
const workDir = path.join(repoRoot, "test-results", "visual", "work");
const diffDir = path.join(repoRoot, "test-results", "visual", "diff", "bulk-migration");
/** Same threshold as compare.visual.ts. */
const PIXEL_RATIO_MAX = 0.001;
const NOT_WRITABLE = "PDF kann nicht beschrieben werden";
const ZIP_PATTERN = /^Markierungen-Backup \d{4}-\d{2}-\d{2} \d{2}-\d{2}( \(\d+\))?\.zip$/;

const isBelow = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Resolves a corpus copy made by `copyCorpus` below `workDir`; throws for anything else (e.g. Noten/). */
function realCopyDir(copy: string): string {
  const real = fs.realpathSync(copy);
  if (!isBelow(fs.realpathSync(workDir), real)) throw new Error(`not a corpus copy: ${copy}`);
  return real;
}

/** Returns `file` (resolved) after checking that it lies inside the corpus copy `copy`. */
function insideCopy(copy: string, file: string): string {
  const real = fs.realpathSync(file);
  if (!isBelow(realCopyDir(copy), real)) throw new Error(`${file} is outside the corpus copy ${copy}`);
  return real;
}

function removeCopy(copy: string): void {
  if (!fs.existsSync(copy)) return;
  const real = realCopyDir(copy);
  // Windows cannot delete a read-only file.
  for (const name of fs.readdirSync(real)) {
    const file = insideCopy(real, path.join(real, name));
    if (fs.statSync(file).isFile()) fs.chmodSync(file, 0o644);
  }
  fs.rmSync(real, { recursive: true, force: true });
}

const legacyFiles = (dir: string) => fs.readdirSync(dir).filter((name) => name.startsWith(".") && name.endsWith(".data"));

function readZip(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr) return reject(openErr);
      const entries = new Map<string, Buffer>();
      zip.on("error", reject);
      zip.on("end", () => resolve(entries));
      zip.on("entry", (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

/** Our embedded payload per page (pdf-lib, like the main process reads it). */
async function embeddedPayloads(pdfFile: string): Promise<Map<number, MarkupPayload>> {
  const doc = await PDFDocument.load(fs.readFileSync(pdfFile), { updateMetadata: false, ignoreEncryption: true });
  return new Map(readMarkup(doc).pages.map((p) => [p.page, p.payload]));
}

async function waitUntil(what: string, probe: () => boolean, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

if (corpus.length < 2) test.skip("Noten/ corpus with at least two .data files is missing");
else {
  test("bulk migration on start produces the same PDFs as the migration on open", { timeout: 45 * 60_000 }, async () => {
    fs.rmSync(diffDir, { recursive: true, force: true });
    const readOnly = corpus[corpus.length - 1];
    const migratedEntries = corpus.filter((e) => e !== readOnly);
    // A migrated sheet with visible markup, opened right after the migration in the same session.
    const shown = migratedEntries.find((e) => e.markedPages.some((p) => !e.blankPages.includes(p)));
    if (!shown) throw new Error("no corpus PDF with visible markup");
    const shownPage = shown.markedPages.find((p) => !shown.blankPages.includes(p)) as number;

    const app = await currentApp();
    let copyA = "";
    let copyB = "";
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "smv-visual-profile-"));
    const requests: string[] = [];
    try {
      copyA = copyCorpus(workDir);
      copyB = copyCorpus(workDir);
      // --- copy A: bulk migration ---
      const original = new Map<string, Buffer>();
      for (const { pdfPath } of corpus) {
        const pdfFile = insideCopy(copyA, path.join(copyA, pdfPath));
        const dataFile = insideCopy(copyA, legacyDataPath(pdfFile));
        original.set(pdfPath, fs.readFileSync(pdfFile));
        original.set(path.basename(dataFile), fs.readFileSync(dataFile));
      }
      const readOnlyFile = insideCopy(copyA, path.join(copyA, readOnly.pdfPath));
      fs.chmodSync(readOnlyFile, 0o444);

      // First start: the migration runs, then a sheet opens in the same session (the migration has
      // destroyed its pdf.js loading tasks, which share one worker with the SheetViewer).
      const first = await openSheet(app, copyA, shown.pdfPath, { bulkMigration: true, profile });
      try {
        const outcome = first.bulkMigration();
        console.log(`bulk migration of copy A: ${JSON.stringify(outcome)}`);
        expect(outcome?.dialogShown, "migration dialog on the first start").toBe(true);
        expect(outcome?.migrated, "migrated files").toBe(corpus.length - 1);
        expect(outcome?.failures).toEqual([`${readOnly.pdfPath} – ${NOT_WRITABLE}`]);
        expect(outcome?.zipName ?? "", "zip name in the summary").toMatch(ZIP_PATTERN);

        await first.gotoPage(shownPage);
        const view = await first.captureView(shownPage);
        const dark = view.without.data.filter((v, i) => i % 4 === 0 && v < 128).length;
        const markup = markupMask(view.with, view.without).reduce((sum, v) => sum + v, 0);
        console.log(`${shown.pdfPath} p${shownPage} after the migration: ${dark} dark page pixels, ${markup} markup pixels`);
        expect(dark, "page canvas has content after the migration").toBeGreaterThan(0);
        expect(markup, "markup drawn after the migration").toBeGreaterThan(0);
      } finally {
        await first.close();
        requests.push(...first.networkRequests());
      }

      expect(legacyFiles(copyA), "legacy files left in copy A").toEqual([path.basename(legacyDataPath(readOnlyFile))]);
      expect(fs.readFileSync(readOnlyFile).equals(original.get(readOnly.pdfPath) as Buffer), "read-only PDF unchanged").toBe(true);
      const zips = fs.readdirSync(copyA).filter((name) => name.startsWith("Markierungen-Backup"));
      expect(zips).toHaveLength(1);
      expect(zips[0]).toMatch(ZIP_PATTERN);
      const zipped = await readZip(path.join(copyA, zips[0]));
      expect([...zipped.keys()].sort(), "zip entries").toEqual([...original.keys()].sort());
      for (const [name, bytes] of original) {
        expect((zipped.get(name) as Buffer).equals(bytes), `zip entry ${name} byte-identical`).toBe(true);
      }

      // Second start with the same profile: the read-only PDF is skipped, nothing is left to migrate.
      const second = await runBulkMigration(app, copyA, { profile });
      console.log(`second start on copy A: ${JSON.stringify(second)}`);
      expect(second.dialogShown, "migration dialog on the second start").toBe(false);
      requests.push(...second.networkRequests);

      // --- copy B: migration on open, one sheet per session ---
      for (const { pdfPath } of migratedEntries) {
        const dataFile = insideCopy(copyB, legacyDataPath(path.join(copyB, pdfPath)));
        const session = await openSheet(app, copyB, pdfPath);
        try {
          await waitUntil(`migration of ${pdfPath} on open`, () => !fs.existsSync(dataFile));
        } finally {
          await session.close();
          requests.push(...session.networkRequests());
        }
      }

      // --- A against B ---
      const violations: string[] = [];
      for (const { pdfPath } of migratedEntries) {
        const fileA = path.join(copyA, pdfPath);
        const fileB = path.join(copyB, pdfPath);
        const payloadsA = await embeddedPayloads(fileA);
        const payloadsB = await embeddedPayloads(fileB);
        expect([...payloadsA.keys()], `${pdfPath}: pages with embedded markup`).toEqual([...payloadsB.keys()]);
        expect([...payloadsA], `${pdfPath}: embedded payloads (bulk vs. open)`).toEqual([...payloadsB]);

        const bytesA = new Uint8Array(fs.readFileSync(fileA));
        const bytesB = new Uint8Array(fs.readFileSync(fileB));
        for (const page of payloadsA.keys()) {
          const imgA = await renderPdfPage(bytesA, page, WINDOW.width, { annotations: true });
          const imgB = await renderPdfPage(bytesB, page, WINDOW.width, { annotations: true });
          const { ratio, diff } = diffRatio(imgA, imgB);
          console.log(`${pdfPath} p${page}: bulk vs. open ${(ratio * 100).toFixed(4)} % differing pixels`);
          if (ratio > PIXEL_RATIO_MAX) {
            violations.push(`${pdfPath} p${page}: ${(ratio * 100).toFixed(4)} % pixels differ (max ${PIXEL_RATIO_MAX * 100} %)`);
            fs.mkdirSync(diffDir, { recursive: true });
            fs.writeFileSync(path.join(diffDir, `${pdfPath.replace(/\.pdf$/i, "")}-${page}.png`), encodePng(sideBySide(imgA, imgB, diff)));
          }
        }
      }
      expect(violations, `diff images (bulk | open | diff) in ${diffDir}`).toEqual([]);
      expect(requests, "http(s) requests of the app").toEqual([]);
    } finally {
      removeCopy(copyA);
      removeCopy(copyB);
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
