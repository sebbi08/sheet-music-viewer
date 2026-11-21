import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import yauzl from "yauzl";
import { afterEach, beforeAll, expect, test } from "vitest";
import { getSidecarPath } from "../../src/pdfMarkup/legacySidecar";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { makeEncryptedPdf, makePdf } from "../pdfMarkup/fixtures";
import { copyCorpus, legacyDataPath, listCorpus, repoRoot } from "./corpus";
import { type AppUnderTest, currentApp, launchApp, runBulkMigration, settleBulkMigration } from "./electronDriver";

/**
 * The migration gate (spec 2026-11-20, section 10) end to end, headless, on a copy of the whole corpus:
 * every legacy `.data` file is moved into its PDF, the backup zip holds the original bytes, the folder is
 * remembered, and a second start shows nothing. Prepared failures among the corpus (a damaged `.data`, a
 * read-only PDF, an encrypted PDF) are all listed and change nothing; once fixed, the next start passes.
 * A read-only sheet folder (no corpus needed) lists every file as read-only.
 * Checks A–Er against the old app run per PDF through the same gate in compare.visual.ts.
 */
const corpus = listCorpus();
const workDir = path.join(repoRoot, "test-results", "visual", "work");
const ZIP_PATTERN = /^Markierungen-Backup \d{4}-\d{2}-\d{2} \d{2}-\d{2}( \(\d+\))?\.zip$/;
const MIGRATED_FOLDERS = "markup-migrated-folders.json";
const READ_ONLY_TEXT = "Die PDF oder ihr Ordner ist schreibgeschützt. Bitte den Schreibschutz entfernen.";
const ENCRYPTED_TEXT = "Die PDF ist verschlüsselt. Bitte den Kennwortschutz entfernen.";
const damagedText = (sidecarName: string) =>
  `Die alte Markierungsdatei „${sidecarName}“ ist beschädigt. Bitte die Datei löschen und die Markierungen neu eintragen.`;
const failedHeadline = (problems: number, total: number) =>
  `${problems} von ${total} Dateien haben ein Problem. Es wurde nichts verändert. Bitte beheben und erneut prüfen.`;
/** chmod-based read-only files and folders do not work as root or on Windows. */
const canMakeReadOnly = process.getuid?.() !== 0 && process.platform !== "win32";

/** A legacy `.data` file (old app) with one rectangle on page 1. */
const rect = { type: "rect", left: 100, top: 200, width: 50, height: 40, angle: 0, scaleX: 1, scaleY: 1, fill: "red" };
const LEGACY_DATA = JSON.stringify([{ page: 1, data: { version: "7", objects: [rect] }, drawWidth: 300, drawHeight: 400 }]);
const DAMAGED_DATA = "{not json";
/** Added to the corpus copy with a `.data` file; not part of the corpus. */
const ENCRYPTED_PDF = "zz encrypted test.pdf";

let app: AppUnderTest;
/** Everything a test created: removed after each test, also when it failed. */
const cleanups: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  app = await currentApp();
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
}, 3 * 60_000); // closing an app may take the driver's full close timeout

const isBelow = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Removes a folder made below workDir (never anything else, e.g. Noten/); read-only entries made writable first. */
function removeWorkFolder(folder: string): void {
  if (!fs.existsSync(folder)) return;
  const real = fs.realpathSync(folder);
  if (!isBelow(fs.realpathSync(workDir), real)) throw new Error(`not a work folder: ${folder}`);
  fs.chmodSync(real, 0o755);
  // Windows cannot delete a read-only file.
  for (const entry of fs.readdirSync(real, { withFileTypes: true, recursive: true })) {
    fs.chmodSync(path.join(entry.parentPath, entry.name), entry.isDirectory() ? 0o755 : 0o644);
  }
  fs.rmSync(real, { recursive: true, force: true });
}

/** A copy of the whole corpus below workDir, removed after the test. */
function newCopy(): string {
  const copy = copyCorpus(workDir);
  cleanups.push(() => removeWorkFolder(copy));
  return copy;
}

/** A fresh empty folder below workDir, removed after the test. */
function newFolder(): string {
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "bulk-"));
  cleanups.push(() => removeWorkFolder(folder));
  return folder;
}

/** A fresh Electron profile, removed after the test. */
function newProfile(): string {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "smv-visual-profile-"));
  cleanups.push(() => fs.rmSync(profile, { recursive: true, force: true }));
  return profile;
}

/** The app's set lists: written into the sheet folder on start, not by the gate. */
const SET_LISTS_FILE = ".set-lists.json";

/** Every file below `folder` (except the set lists) by relative path: its sha256. */
function snapshot(folder: string): Record<string, string> {
  const result: Record<string, string> = {};
  const entries = fs.readdirSync(folder, { withFileTypes: true, recursive: true }).filter((e) => e.isFile());
  for (const entry of entries) {
    const file = path.join(entry.parentPath, entry.name);
    const rel = path.relative(folder, file);
    if (rel === SET_LISTS_FILE) continue;
    result[rel] = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

const zipsIn = (folder: string) => fs.readdirSync(folder).filter((name) => name.startsWith("Markierungen-Backup"));
const legacyFilesIn = (folder: string) => fs.readdirSync(folder).filter((name) => name.startsWith(".") && name.endsWith(".data"));

/** The folders the profile remembers as migrated ([] without the file). */
function migratedFolders(profile: string): string[] {
  const file = path.join(profile, MIGRATED_FOLDERS);
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { folders: string[] }).folders;
}

/** Pages with our embedded markup (pdf-lib, like the main process reads it). */
async function embeddedPages(pdf: string): Promise<number[]> {
  const doc = await PDFDocument.load(fs.readFileSync(pdf), { updateMetadata: false });
  return readMarkup(doc).pages.map((p) => p.page);
}

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

const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);

if (corpus.length < 2) test.skip("Noten/ corpus with at least two .data files is missing");
else {
  test("the whole corpus passes the gate", { timeout: 45 * 60_000 }, async () => {
    const copy = newCopy();
    const profile = newProfile();
    // Every file the gate may change, with its bytes before the migration (zip entry name -> bytes).
    const original = new Map<string, Buffer>();
    for (const { pdfPath } of corpus) {
      const pdfFile = path.join(copy, pdfPath);
      original.set(pdfPath, fs.readFileSync(pdfFile));
      original.set(path.basename(legacyDataPath(pdfFile)), fs.readFileSync(legacyDataPath(pdfFile)));
    }

    const started = Date.now();
    const first = await runBulkMigration(app, copy, { profile });
    console.log(`whole corpus (${corpus.length} PDFs with .data), ${((Date.now() - started) / 1000).toFixed(1)} s: ${JSON.stringify(first)}`);
    expect(first.status).toBe("passed");
    expect(first.dialogShown, "migration dialog on the first start").toBe(true);
    expect(first.migrated, "migrated files").toBe(corpus.length);
    expect(first.zipName ?? "", "zip name in the summary").toMatch(ZIP_PATTERN);

    expect(legacyFilesIn(copy), "legacy files left").toEqual([]);
    expect(zipsIn(copy), "zips in the sheet folder").toEqual([first.zipName]);
    const zipped = await readZip(path.join(copy, first.zipName as string));
    expect([...zipped.keys()].sort(), "zip entries").toEqual([...original.keys()].sort());
    for (const [name, bytes] of original) {
      expect((zipped.get(name) as Buffer).equals(bytes), `zip entry ${name} byte-equal to the file before the migration`).toBe(true);
    }
    for (const { pdfPath, markedPages } of corpus) {
      expect(await embeddedPages(path.join(copy, pdfPath)), `${pdfPath}: pages with embedded markup`).toEqual(markedPages);
    }
    expect(migratedFolders(profile), "folders remembered as migrated").toEqual([path.resolve(copy)]);
    const after = snapshot(copy);

    // Second start with the same profile: the folder is remembered, nothing is shown or changed.
    const second = await runBulkMigration(app, copy, { profile });
    console.log(`second start: ${JSON.stringify(second)}`);
    expect(second.status).toBe("passed");
    expect(second.dialogShown, "migration dialog on the second start").toBe(false);
    expect(snapshot(copy), "sheet folder after the second start").toEqual(after);

    expect([...first.networkRequests, ...second.networkRequests], "http(s) requests of the app").toEqual([]);
  });

  test.skipIf(!canMakeReadOnly)(
    "prepared failures among the corpus: all listed, every file byte-equal, no zip",
    { timeout: 45 * 60_000 },
    async () => {
      const copy = newCopy();
      const profile = newProfile();
      const withMarkup = corpus.filter((e) => e.markedPages.length > 0);
      const [damaged, readOnly] = withMarkup;
      const damagedData = legacyDataPath(path.join(copy, damaged.pdfPath));
      const damagedBytes = fs.readFileSync(damagedData);
      fs.writeFileSync(damagedData, DAMAGED_DATA);
      const readOnlyPdf = path.join(copy, readOnly.pdfPath);
      fs.chmodSync(readOnlyPdf, 0o444);
      const encryptedPdf = path.join(copy, ENCRYPTED_PDF);
      fs.writeFileSync(encryptedPdf, makeEncryptedPdf());
      fs.writeFileSync(getSidecarPath(encryptedPdf), LEGACY_DATA);
      const before = snapshot(copy);

      const launched = await launchApp(app, copy, { bulkMigration: true, profile });
      cleanups.push(() => launched.close());
      const outcome = await settleBulkMigration(launched.page);
      expect(outcome.status).toBe("failed");
      expect(outcome.headline).toBe(failedHeadline(3, corpus.length + 1));
      expect([...outcome.failures].sort(byPath)).toEqual(
        [
          { path: damaged.pdfPath, text: damagedText(path.basename(damagedData)) },
          { path: readOnly.pdfPath, text: READ_ONLY_TEXT },
          { path: ENCRYPTED_PDF, text: ENCRYPTED_TEXT },
        ].sort(byPath),
      );
      expect(snapshot(copy), "sheet folder after the failed check").toEqual(before);
      expect(zipsIn(copy), "zips in the sheet folder").toEqual([]);

      await launched.page.getByTestId("migration-close").click();
      expect(await launched.waitForExit(30_000), "app ended by Schließen").toBe(true);
      await launched.close();
      expect(snapshot(copy), "sheet folder after Schließen").toEqual(before);
      expect(migratedFolders(profile), "folders remembered as migrated").toEqual([]);

      // Fix all three: the original `.data`, writable again, the PDF without its password.
      fs.writeFileSync(damagedData, damagedBytes);
      fs.chmodSync(readOnlyPdf, 0o644);
      fs.writeFileSync(encryptedPdf, await makePdf({ xref: "table" }));

      const fixed = await runBulkMigration(app, copy, { profile });
      console.log(`after fixing: ${JSON.stringify(fixed)}`);
      expect(fixed.status).toBe("passed");
      expect(fixed.migrated, "migrated files").toBe(corpus.length + 1);
      expect(legacyFilesIn(copy), "legacy files left").toEqual([]);
      expect(zipsIn(copy), "zips in the sheet folder").toEqual([fixed.zipName]);
      expect(await embeddedPages(path.join(copy, damaged.pdfPath)), `${damaged.pdfPath}: pages with embedded markup`).toEqual(
        damaged.markedPages,
      );
      expect(await embeddedPages(readOnlyPdf), `${readOnly.pdfPath}: pages with embedded markup`).toEqual(readOnly.markedPages);
      expect(await embeddedPages(encryptedPdf), `${ENCRYPTED_PDF}: pages with embedded markup`).toEqual([1]);
      expect(migratedFolders(profile), "folders remembered as migrated").toEqual([path.resolve(copy)]);
      expect([...launched.networkRequests(), ...fixed.networkRequests], "http(s) requests of the app").toEqual([]);
    },
  );
}

test.skipIf(!canMakeReadOnly)(
  "a read-only sheet folder: every file is listed as read-only, nothing changes",
  { timeout: 5 * 60_000 },
  async () => {
    const folder = newFolder();
    const profile = newProfile();
    const pdfBytes = await makePdf({ xref: "table" });
    for (const name of ["a.pdf", "b.pdf"]) {
      fs.writeFileSync(path.join(folder, name), pdfBytes);
      fs.writeFileSync(getSidecarPath(path.join(folder, name)), LEGACY_DATA);
    }
    const before = snapshot(folder);
    fs.chmodSync(folder, 0o555);

    const launched = await launchApp(app, folder, { bulkMigration: true, profile });
    cleanups.push(() => launched.close());
    const outcome = await settleBulkMigration(launched.page);
    expect(outcome.status).toBe("failed");
    expect(outcome.headline).toBe(failedHeadline(2, 2));
    expect(outcome.failures).toEqual([
      { path: "a.pdf", text: READ_ONLY_TEXT },
      { path: "b.pdf", text: READ_ONLY_TEXT },
    ]);
    await launched.close();
    expect(snapshot(folder), "sheet folder").toEqual(before);
    expect(migratedFolders(profile), "folders remembered as migrated").toEqual([]);
    expect(launched.networkRequests(), "http(s) requests of the app").toEqual([]);
  },
);
