import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeAll, expect, test } from "vitest";
import { getSidecarPath } from "../../src/pdfMarkup/legacySidecar";
import { saveMarkupToFile } from "../../src/pdfMarkup/markupFile";
import { readMarkup } from "../../src/pdfMarkup/readMarkup";
import { makeEncryptedPdf, makePdf, makePng } from "../pdfMarkup/fixtures";
import { repoRoot } from "./corpus";
import { type AppUnderTest, currentApp, openSheet, type SheetSession } from "./electronDriver";
import { markupMask } from "./imageCompare";

/**
 * The check on open (spec 2026-11-20) end to end, headless, on synthetic folders below
 * test-results/visual/work/ (no corpus needed): a PDF that cannot take markup shows why on every open,
 * stays readable and keeps editing off, and markup already in it stays visible; the viewer neither shows nor
 * touches a `.data` file (old or v1 format).
 * The driver's default `SMV_DISABLE_BULK_MIGRATION=1` lets every folder count as migrated.
 */
const workDir = path.join(repoRoot, "test-results", "visual", "work");
const READABLE = "Die Noten lassen sich trotzdem anzeigen.";
const READ_ONLY_DIALOG =
  "In „a.pdf“ können keine Markierungen gespeichert werden: Die PDF oder ihr Ordner ist schreibgeschützt. " +
  `Bitte den Schreibschutz entfernen. ${READABLE}`;
const ENCRYPTED_DIALOG =
  "In „a.pdf“ können keine Markierungen gespeichert werden: Die PDF ist verschlüsselt. " +
  `Bitte den Kennwortschutz entfernen. ${READABLE}`;
/** chmod-based read-only files do not work as root or on Windows. */
const canMakeReadOnly = process.getuid?.() !== 0 && process.platform !== "win32";

/** A legacy `.data` file (old app) with one rectangle on page 1. */
const rect = { type: "rect", left: 100, top: 200, width: 50, height: 40, angle: 0, scaleX: 1, scaleY: 1, fill: "red" };
const LEGACY_DATA = JSON.stringify([{ page: 1, data: { version: "7", objects: [rect] }, drawWidth: 300, drawHeight: 400 }]);
/** The same rectangle in a v1 `.data` file (the sidecar fallback of earlier test builds, `sidecarV1Schema`). */
const V1_DATA = JSON.stringify({
  version: 1,
  pages: [{ page: 1, payload: { version: 1, width: 595, height: 842, fabric: { version: "7", objects: [rect] } } }],
});

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
}, 3 * 60_000); // closing an app may take the driver's full close timeout

const isBelow = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** A fresh folder below workDir, removed after the test (read-only files made writable first). */
function newFolder(): string {
  fs.mkdirSync(workDir, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workDir, "write-block-"));
  cleanups.push(() => {
    if (!isBelow(fs.realpathSync(workDir), fs.realpathSync(folder))) throw new Error(`not a work folder: ${folder}`);
    for (const name of fs.readdirSync(folder)) fs.chmodSync(path.join(folder, name), 0o644);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

/** Opens `pdf` in a fresh app (temporary profile); the app is closed after the test. */
async function open(folder: string, pdf: string): Promise<SheetSession> {
  const session = await openSheet(app, folder, pdf);
  cleanups.push(() => session.close());
  return session;
}

/** Leaves the sheet and opens it again in the same app. */
async function reopen(session: SheetSession): Promise<void> {
  await session.leaveSheet();
  await session.reopenSheet();
}

async function waitUntil(what: string, probe: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function embeddedMarkup(pdf: string) {
  const doc = await PDFDocument.load(fs.readFileSync(pdf), { updateMetadata: false });
  return readMarkup(doc).pages;
}

test.skipIf(!canMakeReadOnly)(
  "a read-only PDF: dialog on every open, sheet visible, pencil off; gone once it is writable",
  { timeout: 5 * 60_000 },
  async () => {
    const folder = newFolder();
    const pdf = path.join(folder, "a.pdf");
    fs.writeFileSync(pdf, pdfBytes);
    fs.chmodSync(pdf, 0o444);

    const session = await open(folder, "a.pdf");
    expect(await session.writeBlockText()).toBe(READ_ONLY_DIALOG);
    await session.confirmWriteBlock();
    expect(await session.writeBlockText(), "dialog after Verstanden").toBeNull();
    expect(await session.pageRendered(1), "page 1 rendered").toBe(true);
    expect(await session.editButtonEnabled(), "edit button").toBe(false);

    // Nothing is remembered: the next open says it again.
    await reopen(session);
    expect(await session.writeBlockText(), "dialog on the second open").toBe(READ_ONLY_DIALOG);
    await session.confirmWriteBlock();
    expect(await session.editButtonEnabled(), "edit button on the second open").toBe(false);

    fs.chmodSync(pdf, 0o644);
    await reopen(session);
    expect(await session.writeBlockText(), "dialog once the PDF is writable").toBeNull();
    expect(await session.pageRendered(1), "page 1 rendered").toBe(true);
    expect(await session.editButtonEnabled(), "edit button once the PDF is writable").toBe(true);
    expect(session.networkRequests()).toEqual([]);
  },
);

test.skipIf(!canMakeReadOnly)(
  "a read-only PDF with markup inside: dialog, pencil off, the markup is still shown",
  { timeout: 5 * 60_000 },
  async () => {
    const folder = newFolder();
    const pdf = path.join(folder, "a.pdf");
    fs.writeFileSync(pdf, pdfBytes);
    // The same rectangle in PDF points, saved the way the app saves it.
    const saved = await saveMarkupToFile({
      path: pdf,
      pages: [
        {
          page: 1,
          payload: { version: 1, width: 595, height: 842, fabric: { version: "7", objects: [{ ...rect, type: "Rect" }] } },
          pngBase64: Buffer.from(makePng(50, 40)).toString("base64"),
        },
      ],
    });
    expect(saved).toEqual({ status: "pdf" });
    fs.chmodSync(pdf, 0o444);

    const session = await open(folder, "a.pdf");
    expect(await session.writeBlockText()).toBe(READ_ONLY_DIALOG);
    await session.confirmWriteBlock();
    expect(await session.pageRendered(1), "page 1 rendered").toBe(true);
    expect(await session.editButtonEnabled(), "edit button").toBe(false);
    expect(await session.markupLayerCount(), "markup layers").toBe(1);
    const view = await session.captureView(1);
    expect(markupMask(view.with, view.without).reduce((sum, v) => sum + v, 0), "markup pixels on page 1").toBeGreaterThan(0);
    expect(session.networkRequests()).toEqual([]);
  },
);

test("a sheet whose name holds # and % opens, renders and can be edited", { timeout: 5 * 60_000 }, async () => {
  // A `#` in a file URL starts the fragment, a `%` an escape: the PDF must still be read.
  const folder = newFolder();
  const name = "#Bob-Omb 100% Score.pdf";
  fs.writeFileSync(path.join(folder, name), pdfBytes);

  const session = await open(folder, name);
  expect(await session.pageRendered(1), "page 1 rendered").toBe(true);
  expect(await session.editButtonEnabled(), "edit button").toBe(true);
  expect(session.networkRequests()).toEqual([]);
});

test("an encrypted PDF: dialog with the encrypted text, the page is rendered", { timeout: 5 * 60_000 }, async () => {
  const folder = newFolder();
  fs.writeFileSync(path.join(folder, "a.pdf"), makeEncryptedPdf());

  const session = await open(folder, "a.pdf");
  expect(await session.writeBlockText()).toBe(ENCRYPTED_DIALOG);
  await session.confirmWriteBlock();
  expect(await session.pageRendered(1), "page 1 rendered").toBe(true);
  expect(await session.editButtonEnabled(), "edit button").toBe(false);
  expect(session.networkRequests()).toEqual([]);
});

test.each([
  ["old", LEGACY_DATA],
  ["v1", V1_DATA],
])(
  "a .data in the %s format next to a PDF is neither shown nor touched; an edit goes into the PDF",
  { timeout: 5 * 60_000 },
  async (_format, data) => {
    const folder = newFolder();
    const pdf = path.join(folder, "a.pdf");
    fs.writeFileSync(pdf, pdfBytes);
    const dataFile = getSidecarPath(pdf);
    fs.writeFileSync(dataFile, data);
    const legacyBytes = fs.readFileSync(dataFile);

    const session = await open(folder, "a.pdf");
    expect(await session.writeBlockText(), "dialog").toBeNull();
    expect(await session.markupLayerCount(), "markup layers").toBe(0);
    expect(await session.editButtonEnabled(), "edit button").toBe(true);

    await session.toggleEdit();
    await session.addText("into the PDF");
    await session.toggleEdit();
    await waitUntil("save into the PDF", async () => (await embeddedMarkup(pdf)).length > 0);

    const pages = await embeddedMarkup(pdf);
    expect(pages.map((p) => p.page)).toEqual([1]);
    // Only the new text: the rectangle of the `.data` file was never taken over.
    const objects = pages[0].payload.fabric.objects as { type?: string; text?: string }[];
    expect(objects.map((o) => o.text)).toEqual(["into the PDF"]);
    expect(fs.readFileSync(dataFile).equals(legacyBytes), ".data bytes unchanged").toBe(true);
    const markupFiles = fs.readdirSync(folder).filter((f) => f.endsWith(".data") || f.includes("smv-tmp"));
    expect(markupFiles, ".data and temp files in the folder").toEqual([".a.data"]);
    expect(session.networkRequests()).toEqual([]);
  },
);
