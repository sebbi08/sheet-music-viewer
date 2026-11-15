import fs from "node:fs";
import path from "node:path";
import { afterAll, expect, test } from "vitest";
import { OCG_NAME } from "../../src/models/markupConstants";
import { baselineCssSize, baselineImagePath, type CaptureLayer, ensureBaseline } from "./baseline";
import { copyCorpus, legacyDataPath, listCorpus, repoRoot } from "./corpus";
import { type AppUnderTest, type Capture, currentApp, openSheet, type SheetSession, WINDOW } from "./electronDriver";
import {
  decodePng,
  diffRatio,
  encodePng,
  type Img,
  markupMask,
  markupCoverage,
  maskMetrics,
  maxObjectOffset,
  sideBySide,
} from "./imageCompare";
import { renderPdfPageAsCaptured } from "./pdfRender";

/**
 * Spec section 8: the new app against the old app (reference = the old app's edit mode), per corpus
 * PDF, on a copy of the corpus (the new app migrates on open):
 *   A  V1.with ↔ R.with                         view right after the migration
 *   B  V2.with ↔ R.with                         view after saving every marked page and reopening
 *   C  mask(P_on − P_off) ↔ mask(R.with − R.without)   pdf.js ("another viewer") with our layer shown;
 *      Sebastian's decision of 2026-11-15: position per object, i.e. the largest coverage-weighted
 *      centroid offset of a single markup object ≤ 1.5 px (not the global centroid, which moves when
 *      objects far apart gain or lose a few resampled edge pixels each); IoU reported as info only
 *   D  P_off ↔ P_orig                           pdf.js with our layer hidden ↔ the original PDF
 *   E  V1.without ↔ R.without                   page canvas alone: no stamp drawn twice
 *   Ar, Er  like A and E after saving and resizing the window (smaller, then back)
 * plus: no http(s) request in any session of the new app (offline proof).
 */
const BASELINE_REF = process.env.VISUAL_BASELINE_REF ?? "8301b5d";
/** Write every composite, not only those of violations (to look at them). */
const WRITE_ALL = process.env.VISUAL_DIFF_ALL === "1";
/** Keep a copy of each migrated PDF (e.g. to open it in Acrobat or another viewer). */
const KEEP_MIGRATED = process.env.VISUAL_KEEP_MIGRATED === "1";

// Thresholds of spec section 8 (task 8 brief). Not to be relaxed without Sebastian's consent.
const PIXEL_RATIO_MAX = 0.001;
const IOU_MIN_APP = 0.98;
const CENTROID_MAX_PX = 1;
/**
 * Check C ("another viewer"): Sebastian's decision of 2026-11-15 ("Lage ≤ 1,5 px, Überlappung als Info").
 * Fails only when one markup object's coverage-weighted centroid is more than 1.5 px off. The IoU
 * (formerly ≥ 0.90) is reported as information only: thin strokes resampled into the stamp PNG and
 * rendered by pdf.js over its own page render cannot reach it, even when they are in the right place.
 */
const OBJECT_OFFSET_MAX_PX_OTHER_VIEWER = 1.5;

const RESIZED = { width: 1000, height: 1400 };
const visualDir = path.join(repoRoot, "test-results", "visual");
const workDir = path.join(visualDir, "work");
const diffDir = path.join(visualDir, "diff");
const migratedDir = path.join(visualDir, "migrated");

type CheckId = "A" | "B" | "C" | "D" | "E" | "Ar" | "Er";

interface Check {
  id: CheckId;
  ratio?: number;
  iou?: number;
  centroidOffsetPx?: number;
  /** Largest coverage-weighted centroid offset of a single markup object (checked for C, reported for A/B). */
  objectOffsetPx?: number;
  /** Which centroid the position check used. */
  position?: "global" | "perObject";
  areaRef?: number;
  areaNew?: number;
  violation?: string;
}

interface PageResult {
  pdfPath: string;
  page: number;
  checks: Check[];
}

const results: PageResult[] = [];
const corpus = listCorpus();
let appUnderTest: Promise<AppUnderTest> | undefined;

/** Black where both masks are set, red only in the reference, blue only in the new image. */
function maskComparison(ref: Uint8Array, img: Uint8Array, width: number, height: number): Img {
  const data = new Uint8Array(width * height * 4).fill(255);
  for (let i = 0; i < ref.length; i++) {
    if (!ref[i] && !img[i]) continue;
    const both = ref[i] && img[i];
    data.set(both ? [0, 0, 0] : ref[i] ? [220, 0, 0] : [0, 0, 220], i * 4);
  }
  return { width, height, data };
}

const sameSize = (a: Img, b: Img) => a.width === b.width && a.height === b.height;
const sizeOf = (img: Img) => `${img.width}x${img.height}`;

class PageChecker {
  readonly checks: Check[] = [];

  constructor(
    private readonly pdfPath: string,
    private readonly page: number,
  ) {}

  private write(id: CheckId, composite: Img) {
    const dir = path.join(diffDir, this.pdfPath.replace(/\.pdf$/i, ""));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${this.page}-${id}.png`), encodePng(composite));
  }

  private finish(check: Check, problems: string[], composite: () => Img) {
    if (problems.length) check.violation = problems.join(", ");
    this.checks.push(check);
    if (problems.length || WRITE_ALL) this.write(check.id, composite());
  }

  /** Share of differing pixels (pixelmatch, threshold 0.1). */
  pixels(id: CheckId, ref: Img, img: Img) {
    if (!sameSize(ref, img)) {
      this.finish({ id }, [`size ${sizeOf(img)} instead of ${sizeOf(ref)}`], () => sideBySide(ref, img));
      return;
    }
    const { ratio, diff } = diffRatio(ref, img);
    const problems = ratio > PIXEL_RATIO_MAX ? [`${(ratio * 100).toFixed(4)} % pixels differ (max ${PIXEL_RATIO_MAX * 100} %)`] : [];
    this.finish({ id, ratio }, problems, () => sideBySide(ref, img, diff));
  }

  /**
   * Position of the markup: mask (with − without) of both, IoU and centroid distance; optionally pixels,
   * too. "global" criteria (A, B) check the IoU and the centroid of the whole mask; "perObject" criteria
   * (C) check only the largest coverage-weighted centroid offset of a single object. Every other value
   * is reported, but never fails.
   */
  markup(
    id: CheckId,
    ref: { with: Img; without: Img },
    img: { with: Img; without: Img },
    withPixels: boolean,
    criteria: { position: "global"; iouMin: number; centroidMaxPx: number } | { position: "perObject"; objectOffsetMaxPx: number },
  ) {
    const { position } = criteria;
    const sizes = [ref.with, ref.without, img.with, img.without];
    if (!sizes.every((s) => sameSize(s, ref.with))) {
      this.finish({ id }, [`sizes ${sizes.map(sizeOf).join(" / ")} differ`], () => sideBySide(ref.with, img.with));
      return;
    }
    const refMask = markupMask(ref.with, ref.without);
    const imgMask = markupMask(img.with, img.without);
    const m = maskMetrics(imgMask, refMask, ref.with.width);
    const objectOffsetPx = maxObjectOffset(imgMask, refMask, ref.with.width, {
      weightA: markupCoverage(img.with, img.without),
      weightB: markupCoverage(ref.with, ref.without),
    }).maxOffsetPx;
    const check: Check = {
      id,
      iou: m.iou,
      centroidOffsetPx: m.centroidOffsetPx,
      objectOffsetPx,
      position,
      areaNew: m.areaA,
      areaRef: m.areaB,
    };
    const problems: string[] = [];
    if (criteria.position === "global") {
      if (m.iou < criteria.iouMin) problems.push(`markup IoU ${m.iou.toFixed(4)} < ${criteria.iouMin}`);
      if (!(m.centroidOffsetPx <= criteria.centroidMaxPx)) {
        problems.push(`markup centroid offset ${m.centroidOffsetPx.toFixed(2)} px > ${criteria.centroidMaxPx} px`);
      }
    } else if (!(objectOffsetPx <= criteria.objectOffsetMaxPx)) {
      problems.push(
        `markup object centroid offset ${objectOffsetPx.toFixed(2)} px > ${criteria.objectOffsetMaxPx} px ` +
          `(info: IoU ${m.iou.toFixed(4)}, global centroid ${m.centroidOffsetPx.toFixed(2)} px)`,
      );
    }
    let diff: Img | undefined;
    if (withPixels) {
      const pixels = diffRatio(ref.with, img.with);
      diff = pixels.diff;
      check.ratio = pixels.ratio;
      if (pixels.ratio > PIXEL_RATIO_MAX) {
        problems.push(`${(pixels.ratio * 100).toFixed(4)} % pixels differ (max ${PIXEL_RATIO_MAX * 100} %)`);
      }
    }
    this.finish(check, problems, () => {
      const masks = maskComparison(refMask, imgMask, ref.with.width, ref.with.height);
      return diff ? sideBySide(ref.with, img.with, diff, masks) : sideBySide(ref.with, img.with, masks);
    });
  }

  violations(): string[] {
    return this.checks.filter((c) => c.violation).map((c) => `${this.pdfPath} p${this.page} ${c.id}: ${c.violation}`);
  }
}

async function waitUntil(what: string, probe: () => boolean, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Opens a session, proves its network log works, runs `body`, proves it again and closes it. */
async function withSession(
  app: AppUnderTest,
  folder: string,
  pdfPath: string,
  requests: string[],
  body: (session: SheetSession) => Promise<void>,
): Promise<void> {
  const session = await openSheet(app, folder, pdfPath);
  const canaries: string[] = [];
  try {
    canaries.push(await session.probeNetworkLog());
    await body(session);
    canaries.push(await session.probeNetworkLog());
  } finally {
    await session.close();
    // Exactly the canary requests are excluded, every other request counts.
    const log = session.networkRequests();
    for (const canary of canaries) {
      const index = log.indexOf(canary);
      if (index >= 0) log.splice(index, 1);
    }
    requests.push(...log);
  }
}

const fmt = (v: number | undefined, digits: number) => (v === undefined ? "-" : v === Infinity ? "inf" : v.toFixed(digits));
function formatCheck(c: Check): string {
  const parts = [
    c.ratio !== undefined ? `${fmt(c.ratio * 100, 3)}%` : "",
    c.iou === undefined
      ? ""
      : c.position === "perObject"
        ? `obj ${fmt(c.objectOffsetPx, 2)}px (info: IoU ${fmt(c.iou, 3)}, global ${fmt(c.centroidOffsetPx, 2)}px)`
        : `IoU ${fmt(c.iou, 3)} ${fmt(c.centroidOffsetPx, 2)}px (obj ${fmt(c.objectOffsetPx, 2)}px)`,
  ].filter(Boolean);
  return `${c.id} ${parts.join(" ")}${c.violation ? " FAIL" : ""}`;
}

if (corpus.length === 0) test.skip("Noten/ corpus with .data files is missing");

for (const { pdfPath, markedPages } of corpus) {
  test(`new app against the old app: ${pdfPath}`, async () => {
    const started = Date.now();
    const dir = await ensureBaseline(BASELINE_REF, [pdfPath]);
    const baselineDone = Date.now();
    const app = await (appUnderTest ??= currentApp());
    fs.rmSync(path.join(diffDir, pdfPath.replace(/\.pdf$/i, "")), { recursive: true, force: true });

    const reference = (page: number) => {
      const read = (layer: CaptureLayer) => decodePng(fs.readFileSync(baselineImagePath(dir, pdfPath, page, "edit", layer)));
      return { with: read("with"), without: read("without"), cssSize: baselineCssSize(dir, pdfPath, page, "edit") };
    };

    // The new app writes into the PDF on open: only ever on a copy, never in Noten/.
    const folder = copyCorpus(workDir);
    try {
      const pdfFile = path.join(folder, pdfPath);
      const dataFile = legacyDataPath(pdfFile);
      const originalBytes = new Uint8Array(fs.readFileSync(pdfFile));
      expect(fs.existsSync(dataFile), dataFile).toBe(true);
      const requests: string[] = [];
      const v1 = new Map<number, Capture>();
      const v1Resized = new Map<number, Capture>();
      const v2 = new Map<number, Capture>();
      const smallMarkup = new Map<number, number>();

      // Session 1: migration on open (V1), save every marked page, resize.
      await withSession(app, folder, pdfPath, requests, async (session) => {
        await waitUntil("migration (.data removed)", () => !fs.existsSync(dataFile));
        expect(fs.statSync(pdfFile).size, "PDF size after the migration").toBeGreaterThan(originalBytes.length);
        for (const page of markedPages) {
          await session.gotoPage(page);
          v1.set(page, await session.captureView(page));
        }

        // Edit mode on and off saves the page again: fabric → payload → PDF.
        for (const page of markedPages) {
          await session.gotoPage(page);
          await session.toggleEdit();
          const before = fs.statSync(pdfFile).mtimeMs;
          await session.toggleEdit();
          await waitUntil(`save of page ${page}`, () => fs.statSync(pdfFile).mtimeMs !== before);
        }
        expect(await session.snackbarText(), "snackbar after saving").toBe("");

        // The window is resized after saving: the markup follows, and at the original size it is
        // exactly where it was.
        await session.resizeContent(RESIZED.width, RESIZED.height);
        for (const page of markedPages) {
          await session.gotoPage(page); // only visible pages have a size
          const small = await session.captureView(page);
          smallMarkup.set(page, markupMask(small.with, small.without).reduce((sum, v) => sum + v, 0));
        }
        await session.resizeContent(WINDOW.width, WINDOW.height);
        for (const page of markedPages) {
          await session.gotoPage(page);
          v1Resized.set(page, await session.captureView(page));
        }
      });

      // Session 2: reopened, the markup comes from the PDF (V2).
      await withSession(app, folder, pdfPath, requests, async (session) => {
        expect(fs.existsSync(dataFile), "legacy .data after reopening").toBe(false);
        for (const page of markedPages) {
          await session.gotoPage(page);
          v2.set(page, await session.captureView(page));
        }
      });

      const migratedBytes = new Uint8Array(fs.readFileSync(pdfFile));
      expect(
        Buffer.from(migratedBytes.subarray(0, originalBytes.length)).equals(Buffer.from(originalBytes)),
        "original bytes are a prefix of the migrated PDF",
      ).toBe(true);
      if (KEEP_MIGRATED) {
        fs.mkdirSync(migratedDir, { recursive: true });
        fs.copyFileSync(pdfFile, path.join(migratedDir, pdfPath));
      }
      const sessionsDone = Date.now();

      const violations: string[] = [];
      for (const page of markedPages) {
        const r = reference(page);
        const first = v1.get(page) as Capture;
        const checker = new PageChecker(pdfPath, page);
        if (first.cssSize.width !== r.cssSize.width || first.cssSize.height !== r.cssSize.height) {
          violations.push(`${pdfPath} p${page}: page drawn at ${JSON.stringify(first.cssSize)}, old app at ${JSON.stringify(r.cssSize)}`);
        }

        // pdf.js in Node, at exactly the geometry of the captures.
        const render = (bytes: Uint8Array, hideOurs: boolean) =>
          renderPdfPageAsCaptured(bytes, page, r.cssSize, { annotations: true, ...(hideOurs ? { hideOcgNamed: OCG_NAME } : {}) });
        const pOn = await render(migratedBytes, false);
        const pOff = await render(migratedBytes, true);
        const pOrig = await render(originalBytes, false);

        const app = { position: "global", iouMin: IOU_MIN_APP, centroidMaxPx: CENTROID_MAX_PX } as const;
        checker.markup("A", r, first, true, app);
        checker.markup("B", r, v2.get(page) as Capture, true, app);
        checker.markup("C", r, { with: pOn, without: pOff }, false, {
          position: "perObject",
          objectOffsetMaxPx: OBJECT_OFFSET_MAX_PX_OTHER_VIEWER,
        });
        checker.pixels("D", pOrig, pOff);
        checker.pixels("E", r.without, first.without);
        checker.markup("Ar", r, v1Resized.get(page) as Capture, true, app);
        checker.pixels("Er", r.without, (v1Resized.get(page) as Capture).without);

        const areaRef = checker.checks.find((c) => c.id === "A")?.areaRef ?? 0;
        if (areaRef > 0 && !(smallMarkup.get(page) ?? 0)) {
          violations.push(`${pdfPath} p${page}: no markup visible at ${RESIZED.width}x${RESIZED.height}`);
        }
        violations.push(...checker.violations());
        results.push({ pdfPath, page, checks: checker.checks });
        console.log(
          `${pdfPath} p${page}: ${checker.checks.map(formatCheck).join(" | ")} | ` +
            `markup px ref ${areaRef}, at ${RESIZED.width}x${RESIZED.height} ${smallMarkup.get(page)}`,
        );
      }
      console.log(
        `${pdfPath}: ${originalBytes.length} -> ${migratedBytes.length} bytes; ` +
          `baseline ${((baselineDone - started) / 1000).toFixed(1)} s, app sessions ${((sessionsDone - baselineDone) / 1000).toFixed(1)} s, ` +
          `compare ${((Date.now() - sessionsDone) / 1000).toFixed(1)} s`,
      );

      // Soft: a violation must not hide the offline result, and vice versa.
      expect.soft(violations, `diff images in ${diffDir}`).toEqual([]);
      expect.soft(requests, "http(s) requests of the new app").toEqual([]);
      console.log(`${pdfPath}: http(s) requests of the new app (canaries excluded): ${requests.length}`);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
}

afterAll(() => {
  if (results.length === 0) return;
  const ids: CheckId[] = ["A", "B", "C", "D", "E", "Ar", "Er"];
  const cell = (c: Check | undefined) => {
    if (!c) return "-";
    const parts = [
      c.ratio !== undefined ? `${fmt(c.ratio * 100, 3)}%` : "",
      c.iou === undefined
        ? ""
        : c.position === "perObject"
          ? `obj ${fmt(c.objectOffsetPx, 2)}px (info: IoU ${fmt(c.iou, 3)}, global ${fmt(c.centroidOffsetPx, 2)})`
          : `${fmt(c.iou, 3)}/${fmt(c.centroidOffsetPx, 2)}px (obj ${fmt(c.objectOffsetPx, 2)})`,
    ].filter(Boolean);
    return `${parts.join(" ")}${c.violation ? " **FAIL**" : ""}`;
  };
  const lines = [
    `| PDF | p | ${ids.join(" | ")} |`,
    `|---|---|${ids.map(() => "---").join("|")}|`,
    ...results.map((r) => `| ${r.pdfPath} | ${r.page} | ${ids.map((id) => cell(r.checks.find((c) => c.id === id))).join(" | ")} |`),
  ];
  fs.mkdirSync(visualDir, { recursive: true });
  fs.writeFileSync(path.join(visualDir, "compare-summary.md"), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(visualDir, "compare-summary.json"), JSON.stringify(results, null, 2));
  console.log(lines.join("\n"));
});
