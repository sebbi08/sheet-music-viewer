import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { _electron, type CDPSession, type ElectronApplication, type Page } from "playwright-core";
import { repoRoot } from "./corpus";
import { decodePng, type Img } from "./imageCompare";

/** Directory with a built app: `.vite/build/main.cjs` exists. */
export interface AppUnderTest {
  root: string;
}

/**
 * A page captured with and without its markup layer. The images have the page canvas's CSS size
 * rounded down to whole pixels; `cssSize` is the unrounded CSS size the page is drawn at.
 */
export interface Capture {
  with: Img;
  without: Img;
  cssSize: { width: number; height: number };
}

export interface SheetSession {
  gotoPage(page: number): Promise<void>;
  captureView(page: number): Promise<Capture>;
  captureEdit(page: number): Promise<Capture>;
  toggleEdit(): Promise<void>;
  /**
   * In edit mode: adds a text object through the text dialog (an empty `text` draws nothing, but changes
   * the page's data, so leaving edit mode saves it).
   */
  addText(text: string): Promise<void>;
  /** Leaves the sheet with the app bar's back button (the SheetViewer unmounts). */
  leaveSheet(): Promise<void>;
  /** Opens the same sheet again (after `leaveSheet`) and waits until it is rendered. */
  reopenSheet(): Promise<void>;
  /**
   * Replaces the native "unsaved markup" dialog of the main process: every call is recorded and answered
   * with the button at `response` (0 retry, 1 discard and close, 2 cancel). Headless runs cannot click it.
   */
  stubMessageBox(response: number): Promise<void>;
  /** Messages of the stubbed dialogs shown so far. */
  messageBoxCalls(): Promise<string[]>;
  /** Asks the main process to close the window, like the title bar's close button. */
  requestWindowClose(): Promise<void>;
  /**
   * Makes the renderer's close guard hang: the markup queue reports unsaved changes and its flush never
   * settles (like a save stuck on an unreachable share). Only the main process can end a close then.
   */
  hangCloseSave(): Promise<void>;
  /** Waits until the Electron process has exited; false after `timeoutMs`. */
  waitForExit(timeoutMs: number): Promise<boolean>;
  /** Number of open app windows (devtools excluded). */
  windowCount(): Promise<number>;
  /**
   * Sets the window's content size and waits until the sheet and its markup are rendered again. In edit
   * mode only with `whileEditing` (and only on a sheet without markup overlays).
   */
  resizeContent(width: number, height: number, options?: { whileEditing?: boolean }): Promise<void>;
  /** In edit mode: the zoom of the edit canvas (`data-edit-zoom` of the sheet; 1 when absent). */
  editZoom(): Promise<number>;
  /** In edit mode: the view of the edit canvas, screen = canvas point * zoom + (x, y) (`data-edit-view`). */
  editView(): Promise<{ zoom: number; x: number; y: number }>;
  /** In edit mode: the CSS size of the edit canvas (= its canvas coordinates at 1x). */
  editCanvasSize(): Promise<{ width: number; height: number }>;
  /** In edit mode: switches the edit canvas to drawing (pencil) if it is in the hand mode. */
  startDrawing(): Promise<void>;
  /** In edit mode: switches the edit canvas to the hand mode (moving and selecting) if it is drawing. */
  setHandMode(): Promise<void>;
  /**
   * Touch input through the DevTools protocol (`Input.dispatchTouchEvent`), real touch events in the
   * renderer. `points` are all fingers on the screen after the event (CSS px relative to the edit canvas,
   * `id` per finger) for "touchStart" and "touchMove": a new id lands, a changed position moves (a missing
   * one stays down). "touchEnd" lifts the fingers in `points` (CDP releases the listed points), with no
   * points every finger; "touchCancel" cancels every finger (`points` must be empty).
   */
  touch(
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    points: { x: number; y: number; id: number }[],
  ): Promise<void>;
  /**
   * Two fingers on a horizontal line through `center` (CSS px relative to the edit canvas), `fromDistance`
   * apart, land one right after the other, spread (or pinch) to `toDistance` in `steps` moves and lift.
   */
  pinch(center: { x: number; y: number }, fromDistance: number, toDistance: number, steps?: number): Promise<void>;
  /**
   * Pen input through the DevTools protocol (`Input.dispatchMouseEvent` with `pointerType: "pen"`): pointer
   * events of a pen plus mouse events, as Chromium delivers a pen. CSS px relative to the edit canvas.
   */
  pen(type: "down" | "move" | "up", at: { x: number; y: number }): Promise<void>;
  /**
   * Pen input as Chromium delivers it on Windows: a pen pointer event, then a touch event at the same point
   * (Chromium's touches carry no `touchType`), both dispatched in the page (not trusted). CSS px relative to
   * the edit canvas.
   */
  stylusTouch(type: "down" | "move" | "up", at: { x: number; y: number }): Promise<void>;
  /** Mouse wheel with Ctrl held (like a trackpad pinch) at `at`, CSS px relative to the edit canvas. */
  ctrlWheel(at: { x: number; y: number }, deltaY: number): Promise<void>;
  /** Mouse wheel without modifiers over the centre of the edit canvas. */
  wheel(dx: number, dy: number): Promise<void>;
  /**
   * One wheel event with Shift held over the centre of the edit canvas, through the DevTools protocol
   * (`Input.dispatchMouseEvent` "mouseWheel"): the deltas arrive in the page as given.
   */
  shiftWheel(deltaX: number, deltaY: number): Promise<void>;
  /** Whether the text dialog („Add Text“) is open. */
  textDialogShown(): Promise<boolean>;
  /** Clicks the edit mode's „ganze Seite“ button. */
  zoomFit(): Promise<void>;
  /** Whether the edit mode's „ganze Seite“ button is shown. */
  zoomFitShown(): Promise<boolean>;
  /** Whether the zoomed page picture (`.zoomPageCanvas`) is shown. */
  zoomPictureShown(): Promise<boolean>;
  /**
   * The zoomed page picture: its pixel size, the zoom it shows sharply (`data-zoom`, null while it is only
   * scaled) and its CSS size.
   */
  zoomPicture(): Promise<{ width: number; height: number; zoom: number | null; cssWidth: number; cssHeight: number }>;
  /**
   * RGBA pixels of the zoomed page picture in the given rectangle (its device px), and where the picture
   * lies relative to the edit canvas (CSS px of its left/top edge minus those of the edit canvas).
   */
  zoomPicturePixels(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<{ data: number[]; offsetX: number; offsetY: number }>;
  /**
   * How the zoomed page picture is stacked: whether the topmost element at `at` (CSS px relative to the edit
   * canvas) is the edit canvas's upper canvas, the computed z-indices of the picture and of the edit canvas's
   * container, and whether the picture comes before that container in the DOM.
   */
  zoomPictureStacking(at: { x: number; y: number }): Promise<{
    editCanvasOnTop: boolean;
    pictureZ: number;
    containerZ: number;
    pictureBeforeContainer: boolean;
  }>;
  /** Mouse down at the first point, moves through the others, mouse up; CSS px relative to the edit canvas. */
  drawStroke(points: { x: number; y: number }[]): Promise<void>;
  /** RGBA pixels of the edit canvas's lower canvas (device px) in the given rectangle. */
  editCanvasPixels(x: number, y: number, width: number, height: number): Promise<number[]>;
  /** The app's own zoom: device pixel ratio, layout width of the document and the window's zoom factor. */
  appZoom(): Promise<{ devicePixelRatio: number; clientWidth: number; zoomFactor: number }>;
  networkRequests(): string[];
  /**
   * Proves that the network log is armed: the renderer requests a unique https URL, which must show
   * up in `networkRequests()` (the request is cancelled). Returns the URL, so a test can exclude it.
   */
  probeNetworkLog(): Promise<string>;
  /** Text of the open snackbar, "" if none is shown. */
  snackbarText(): Promise<string>;
  /**
   * Paragraphs of the open "no markup possible" dialog (src/components/WriteBlockDialog.vue), joined by
   * a space; null if it is not shown.
   */
  writeBlockText(): Promise<string | null>;
  /** Confirms that dialog with its button and waits until it is gone. */
  confirmWriteBlock(): Promise<void>;
  /** Whether the app bar's edit button (pencil) can be clicked. */
  editButtonEnabled(): Promise<boolean>;
  /** Whether the page canvas of `page` has a size and any non-white pixel. */
  pageRendered(page: number): Promise<boolean>;
  /** Number of markup overlay canvases in the view (0: no markup shown on any page). */
  markupLayerCount(): Promise<number>;
  /**
   * The cut of the half step `turn + 0.5` as drawn: ratio from the clip-path of its page canvas (1 without
   * one), backdrop height in CSS px, page height in CSS px, and the red marks' top (null when hidden), in
   * CSS px from the top of the sheet area. The marks belong to the page shown now, not to `turn`.
   */
  cutState(turn: number): Promise<{ ratio: number; backdropPx: number; pageHeightPx: number; marksTopPx: number | null }>;
  /** The page shown now (n + 0.5 in the first step of the turn n -> n+1). */
  currentPage(): Promise<number>;
  /** Clicks the app bar's divider button (no waiting: the mode may refuse to start). */
  clickDividerButton(): Promise<void>;
  /** Clicks the app bar's divider button and waits until the divider line appears (or disappears). */
  toggleDividerMode(): Promise<void>;
  /** Whether the app bar's divider button can be clicked. */
  dividerButtonEnabled(): Promise<boolean>;
  /** Whether the divider mode shows its line. */
  dividerModeOn(): Promise<boolean>;
  /**
   * In divider mode: mouse down `grabOffset` CSS px below the centre of the line (default 0), moves by `dy`
   * CSS px in steps, mouse up. With `dy` 0 there is no move at all: a press without movement.
   */
  dragDivider(dy: number, grabOffset?: number): Promise<void>;
  /** In divider mode: the label naming the turn shown, e.g. "Seite 1 → 2". */
  dividerLabel(): Promise<string>;
  /** In divider mode: clicks one of its controls (‹, ›, „Zur Mitte“). */
  clickDividerControl(control: "prev" | "next" | "reset"): Promise<void>;
  /** In divider mode: whether one of its controls can be clicked. */
  dividerControlEnabled(control: "prev" | "next" | "reset"): Promise<boolean>;
  /** Presses a key in the app window (no waiting). */
  pressKey(key: string): Promise<void>;
  /** Clicks the window at a share of its width and height (no waiting). */
  clickAt(xShare: number, yShare: number): Promise<void>;
  /** Closes the open snackbar with its OK button and waits until it is gone. */
  dismissSnackbar(): Promise<void>;
  /** Computed font of the app bar title and whether Roboto (all weights the UI uses) is loaded. */
  fontStatus(): Promise<{ appBarFamily: string; robotoLoaded: boolean }>;
  /** What the migration gate reported before the sheet opened; null unless started with `bulkMigration: true`. */
  bulkMigration(): BulkMigrationOutcome | null;
  close(): Promise<void>;
}

export const WINDOW = { width: 1200, height: 1600 };
const RESIZE_DEBOUNCE_MS = 600;
const STABLE_FOR_MS = 1000;
const MARKUP_GRACE_MS = 6000; // > fontfaceobserver's default 3 s timeout before fabric loads objects
const WAIT_TIMEOUT_MS = 120_000;
/** How long `close()` waits for the app to quit before it kills it. */
const CLOSE_TIMEOUT_MS = 60_000;
const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

/** Runs a build tool in `cwd`; throws with the end of its output if it fails. */
function runTool(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: isWindows, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    const reason = result.error?.message ?? (result.signal ? `signal ${result.signal}` : `exit code ${result.status}`);
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd} (${reason}):\n${output.slice(-8000)}`);
  }
}

/** What `electron-forge package` must leave behind for `electron <root>` to show the app. */
const buildOutputs = (root: string) => [
  path.join(root, ".vite", "build", "main.cjs"),
  path.join(root, ".vite", "renderer", "main_window", "index.html"),
];
/** A failed or interrupted build can leave main.cjs without the renderer: that is not a build. */
const isBuilt = (root: string) => buildOutputs(root).every((file) => fs.existsSync(file));

function forgePackage(root: string): AppUnderTest {
  runTool(npx, ["electron-forge", "package"], root);
  const missing = buildOutputs(root).filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    throw new Error(`electron-forge package did not produce ${missing.map((f) => path.relative(root, f)).join(", ")} in ${root}`);
  }
  return { root };
}

const INSTALL_MARKER = ".smv-visual-installed";

/**
 * Gives the worktree at `root` its own node_modules from its own lockfile (`npm ci`), so dependencies
 * removed on the current branch cannot break the old app's build. Install scripts are skipped: the
 * apps run with the Electron binary of the current node_modules. Returns true if it installed.
 */
function installOwnDependencies(root: string): boolean {
  const modules = path.join(root, "node_modules");
  const marker = path.join(modules, INSTALL_MARKER);
  const lockHash = createHash("sha256").update(fs.readFileSync(path.join(root, "package-lock.json"))).digest("hex");
  const entry = fs.lstatSync(modules, { throwIfNoEntry: false });
  if (entry?.isSymbolicLink()) {
    // Older runs linked the current node_modules here: remove only the link, never its target.
    fs.unlinkSync(modules);
  } else if (entry && fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === lockHash) {
    return false;
  }
  // npm ci replaces an incomplete node_modules; the marker is written only after it succeeded.
  runTool(isWindows ? "npm.cmd" : "npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], root);
  fs.writeFileSync(marker, lockHash);
  return true;
}

/** Builds the app as of `ref` in a reusable git worktree below test-results/visual/worktrees/. */
export async function buildAppAtRef(ref: string): Promise<AppUnderTest> {
  const root = path.join(repoRoot, "test-results", "visual", "worktrees", ref);
  if (!fs.existsSync(path.join(root, ".git"))) {
    fs.mkdirSync(path.dirname(root), { recursive: true });
    git("worktree", "add", "--detach", root, ref);
  }
  // New dependencies: whatever was built before was built with others.
  if (installOwnDependencies(root)) fs.rmSync(path.join(root, ".vite"), { recursive: true, force: true });
  if (isBuilt(root)) return { root };
  return forgePackage(root);
}

/** Builds the current working tree the same way. */
export async function currentApp(): Promise<AppUnderTest> {
  return forgePackage(repoRoot);
}

/** Electron binary from node_modules (the packaged binary's fuses forbid remote debugging). */
const electronBinary = createRequire(import.meta.url)("electron") as unknown as string;

/**
 * Preloaded into the main process (`-r`) so its `ready` listener runs before the app's own and
 * sees every http(s) request of the default session, including the first page load. The app
 * is built (no Vite dev server), so every such request counts. Requests are logged and
 * cancelled, so a test run never downloads anything.
 */
const NETWORK_LOG_SCRIPT = `
const { app, session } = require("electron");
const log = (globalThis.__smvRequests = []);
app.once("ready", () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    log.push(details.url);
    callback({ cancel: true });
  });
  globalThis.__smvNetworkLogArmed = true;
});
`;

// --- functions below run inside the renderer (serialized by Playwright) ---

/** Highest visible page canvas = SheetViewer's `currentPage` (at N.5 both N and N.5 are visible). */
function rendererCurrentPage(): number {
  const visible = [...document.querySelectorAll<HTMLCanvasElement>("canvas.pageVisible[data-page]")];
  return Math.max(0, ...visible.map((c) => parseFloat(c.dataset.page ?? "0")));
}

/**
 * Composites `layerSelectors` (in order, all optional except the first) at CSS size into one PNG.
 * Every layer is drawn where it sits on screen relative to the first one, so a misplaced
 * overlay shows up in the image. `ink` tells whether the topmost layer has any visible pixel.
 * Returns null while a layer is missing or empty-sized.
 */
function rendererComposite(
  layerSelectors: string[],
): { url: string; ink: boolean; cssWidth: number; cssHeight: number } | null {
  const layers = layerSelectors.map((s) => document.querySelector<HTMLCanvasElement>(s));
  const base = layers[0];
  if (!base || layers.some((l) => !l)) return null;
  const baseRect = base.getBoundingClientRect();
  if (baseRect.width === 0 || baseRect.height === 0) return null;
  const out = document.createElement("canvas");
  out.width = Math.floor(baseRect.width);
  out.height = Math.floor(baseRect.height);
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  for (const layer of layers as HTMLCanvasElement[]) {
    const r = layer.getBoundingClientRect();
    ctx.drawImage(layer, Math.round(r.left - baseRect.left), Math.round(r.top - baseRect.top), r.width, r.height);
  }
  const top = layers[layers.length - 1] as HTMLCanvasElement;
  const pixels = top.getContext("2d")?.getImageData(0, 0, top.width, top.height).data ?? new Uint8ClampedArray();
  let ink = false;
  for (let i = 3; i < pixels.length && !ink; i += 4) ink = pixels[i] !== 0;
  return { url: out.toDataURL("image/png"), ink, cssWidth: baseRect.width, cssHeight: baseRect.height };
}

/** See `SheetSession.cutState`. */
function rendererCutState(turn: number): {
  ratio: number;
  backdropPx: number;
  pageHeightPx: number;
  marksTopPx: number | null;
} {
  const wrapper = document.querySelector<HTMLElement>("#sheetViewerWrapper");
  const half = document.querySelector<HTMLCanvasElement>(`#sheetViewerWrapper canvas[data-page="${turn + 0.5}"]`);
  const next = document.querySelector<HTMLCanvasElement>(`#sheetViewerWrapper canvas[data-page="${turn + 1}"]`);
  const backdrop = document.querySelector<HTMLElement>(`#sheetViewerWrapper div[data-page-backdrop="${turn + 0.5}"]`);
  if (!wrapper || !half || !next || !backdrop) throw new Error(`no half step ${turn + 0.5}`);
  const pageHeightPx = parseFloat(next.style.height);
  // Chromium serializes `inset(0 0 30% 0)` in its shortest form, e.g. `inset(0px 0px 30%)`.
  const clip = getComputedStyle(half).clipPath;
  let ratio = 1;
  if (clip !== "none") {
    const values = /^inset\(([^)]*)\)$/.exec(clip)?.[1].split(/\s+/);
    const bottom = values ? (values[2] ?? values[0]) : undefined;
    if (!bottom) throw new Error(`unexpected clip-path ${clip}`);
    ratio = bottom.endsWith("%") ? 1 - parseFloat(bottom) / 100 : 1 - parseFloat(bottom) / pageHeightPx;
  }
  const mark = document.querySelector<HTMLElement>("#sheetViewerWrapper .splitIndicator .indicatorLeft");
  return {
    ratio,
    backdropPx: parseFloat(backdrop.style.height),
    pageHeightPx,
    marksTopPx: mark ? mark.getBoundingClientRect().top - wrapper.getBoundingClientRect().top : null,
  };
}

// --- node side ---

async function waitFor<T>(what: string, probe: () => Promise<T | null | undefined | false>): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Composites the layers once their pixels have stopped changing (fabric loads objects
 * asynchronously, after a font check). With a markup layer on top, an image without any markup
 * is only accepted after it has stayed unchanged for MARKUP_GRACE_MS (e.g. a page whose only
 * object is an empty text box).
 */
async function captureStable(
  page: Page,
  what: string,
  layers: string[],
): Promise<{ img: Img; cssSize: { width: number; height: number } }> {
  const expectMarkup = layers.length > 1;
  let last = "";
  let stableSince = 0;
  const shot = await waitFor(what, async () => {
    const current = await page.evaluate(rendererComposite, layers);
    if (!current) return null;
    const key = `${current.cssWidth}x${current.cssHeight}:${current.url}`;
    if (key !== last) {
      last = key;
      stableSince = Date.now();
      return null;
    }
    const stableFor = Date.now() - stableSince;
    const needed = expectMarkup && !current.ink ? MARKUP_GRACE_MS : STABLE_FOR_MS;
    return stableFor >= needed ? current : null;
  });
  return {
    img: decodePng(Buffer.from(shot.url.slice(shot.url.indexOf(",") + 1), "base64")),
    cssSize: { width: shot.cssWidth, height: shot.cssHeight },
  };
}

/** One page with (page canvas + markup layer) and without (page canvas alone) its markup. */
async function capturePair(page: Page, what: string, pageLayer: string, markupLayer: string): Promise<Capture> {
  const withMarkup = await captureStable(page, `${what} with markup`, [pageLayer, markupLayer]);
  const without = await captureStable(page, `${what} without markup`, [pageLayer]);
  if (withMarkup.cssSize.width !== without.cssSize.width || withMarkup.cssSize.height !== without.cssSize.height) {
    throw new Error(`${what}: the page size changed between the two captures`);
  }
  return { with: withMarkup.img, without: without.img, cssSize: without.cssSize };
}

export interface LaunchOptions {
  /** Extra environment variables for the app (e.g. `SMV_EXIT_GUARD_TIMEOUT_MS`). */
  env?: Record<string, string>;
  /**
   * Lets the markup migration gate run on start. Off by default: the driver sets
   * `SMV_DISABLE_BULK_MIGRATION=1`, so every folder counts as migrated (nothing is stored).
   */
  bulkMigration?: boolean;
  /**
   * Electron profile (userData) to use and keep, e.g. to start the app twice with the same profile or to
   * put a file into it before the start (the migration mark is kept in the sheet folder's `.config.json`).
   * Default: a fresh temporary profile, removed on close.
   */
  profile?: string;
}

/** A started app (see `launchApp`): window at `WINDOW` size, `folder` set as the sheet music folder. */
export interface LaunchedApp {
  electronApp: ElectronApplication;
  page: Page;
  /** Updates `networkRequests()` from the main process (no-op once the app has exited). */
  refreshRequests(): Promise<void>;
  networkRequests(): string[];
  /** Waits until the Electron process has exited; false after `timeoutMs`. */
  waitForExit(timeoutMs: number): Promise<boolean>;
  /** Quits the app (killed after CLOSE_TIMEOUT_MS) and removes a temporary profile. */
  close(): Promise<void>;
}

/** Starts the app headless with an isolated profile and `folder` as its sheet music folder. */
export async function launchApp(app: AppUnderTest, folder: string, options: LaunchOptions = {}): Promise<LaunchedApp> {
  const keepProfile = options.profile !== undefined;
  const profile = options.profile ?? fs.mkdtempSync(path.join(os.tmpdir(), "smv-visual-profile-"));
  // IS_TEST keeps the unpackaged app from installing Vue devtools (a download). An inherited
  // ELECTRON_RUN_AS_NODE (set e.g. by VS Code terminals) would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, SMV_DISABLE_BULK_MIGRATION: _bulk, ...inherited } = process.env;
  const { DISPLAY: _x11, WAYLAND_DISPLAY: _wayland, ...withoutDisplay } = inherited;
  const headed = process.env.VISUAL_HEADED === "1";
  const networkLog = path.join(profile, "network-log.cjs");
  fs.writeFileSync(networkLog, NETWORK_LOG_SCRIPT);
  const removeProfile = () => {
    if (!keepProfile) fs.rmSync(profile, { recursive: true, force: true });
  };
  const electronApp: ElectronApplication = await _electron.launch({
    executablePath: electronBinary,
    args: [
      "-r",
      networkLog,
      app.root,
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      // Default: Chromium's Ozone headless backend, no window on the desktop and no display
      // server needed. VISUAL_HEADED=1 shows the window for debugging.
      ...(headed ? [] : ["--ozone-platform=headless", "--disable-gpu"]),
    ],
    env: {
      ...(headed ? inherited : withoutDisplay),
      ...(options.bulkMigration ? {} : { SMV_DISABLE_BULK_MIGRATION: "1" }),
      ...options.env,
      IS_TEST: "1",
    } as Record<string, string>,
    cwd: app.root,
  }).catch((error: unknown) => {
    removeProfile();
    throw error;
  });
  const exited = new Promise<void>((resolve) => {
    const child = electronApp.process();
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
  let hasExited = false;
  void exited.then(() => {
    hasExited = true;
  });
  let requests: string[] = [];
  const refreshRequests = async () => {
    if (hasExited) return;
    requests = await electronApp.evaluate(() => [...((globalThis as { __smvRequests?: string[] }).__smvRequests ?? [])]);
  };
  const waitForExit = async (timeoutMs: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([exited.then(() => true), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const actualProfile = await electronApp.evaluate(({ app: electron }) => electron.getPath("userData"));
    if (path.resolve(actualProfile) !== path.resolve(profile)) {
      throw new Error(`Electron profile not isolated: ${actualProfile}`);
    }

    // The devtools the unpackaged app opens are a window, too; it may even come first.
    const page = await waitFor("app window", async () =>
      electronApp.windows().find((w) => !w.url().startsWith("devtools:")),
    );
    if (!(await electronApp.evaluate(() => (globalThis as { __smvNetworkLogArmed?: boolean }).__smvNetworkLogArmed))) {
      throw new Error("network log preload did not run");
    }
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith("devtools:"));
      if (!win) throw new Error("app window not found");
      // The unpackaged app opens devtools (docked, shrinking the page); keep them closed.
      win.webContents.on("devtools-opened", () => win.webContents.closeDevTools());
      win.webContents.closeDevTools();
      win.unmaximize();
      win.setContentSize(size.width, size.height);
    }, WINDOW);
    await waitFor(`window content ${WINDOW.width}x${WINDOW.height}`, () =>
      page.evaluate((s) => window.innerWidth === s.width && window.innerHeight === s.height, WINDOW),
    );

    // The store reads the folder from localStorage once at startup, hence the reload. A kept profile
    // may have it already: then the app started with it (and with its migration, if enabled), which a
    // reload would interrupt.
    await page.waitForLoadState("domcontentloaded");
    if (!(await page.evaluate((f) => localStorage.getItem("sheetMusicFolder") === f, folder))) {
      await page.evaluate((f) => localStorage.setItem("sheetMusicFolder", f), folder);
      await page.reload();
    }
    await page.waitForFunction(() => (document.querySelector("#app") as { __vue_app__?: unknown } | null)?.__vue_app__);
    await refreshRequests();

    return {
      electronApp,
      page,
      refreshRequests,
      networkRequests: () => [...requests],
      waitForExit,
      async close() {
        // Quitting does not leave edit mode; an open edit canvas with changes would be saved first (and
        // a failing save would ask through the native dialog, which a headless run cannot answer).
        await refreshRequests();
        if (!hasExited) {
          // A close the app keeps blocking (e.g. a broken close guard) must not hang the run.
          const closing = electronApp.close().catch(() => undefined);
          if (!(await waitForExit(CLOSE_TIMEOUT_MS))) {
            electronApp.process().kill("SIGKILL");
            await closing;
            throw new Error(`the app did not quit within ${CLOSE_TIMEOUT_MS} ms and was killed`);
          }
        }
        removeProfile();
      },
    };
  } catch (error) {
    await electronApp.close().catch(() => undefined);
    removeProfile();
    throw error;
  }
}

/**
 * Starts the app a second time with `profile` (headless, without Playwright) while another instance may
 * hold it, and waits for that process to exit. Resolves with its exit code, or `null` if it was still
 * running after `timeoutMs` (it is killed then).
 */
export function startExtraInstance(app: AppUnderTest, profile: string, timeoutMs: number): Promise<number | null> {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, DISPLAY: _x11, WAYLAND_DISPLAY: _wayland, ...env } = process.env;
  const child = spawn(
    electronBinary,
    [app.root, `--user-data-dir=${profile}`, "--ozone-platform=headless", "--disable-gpu"],
    { cwd: app.root, env: { ...env, IS_TEST: "1", SMV_DISABLE_BULK_MIGRATION: "1" }, stdio: "ignore" },
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** What the migration gate reported (src/components/MigrationDialog.vue). */
export interface BulkMigrationOutcome {
  /** `document.documentElement.dataset.migrationGate` once it left "pending". */
  status: "passed" | "failed";
  /** `data-migrated` of the summary; 0 without one. */
  migrated: number;
  /** From the summary line "Sicherung: {zipName}"; null without it. */
  zipName: string | null;
  /** All paragraphs of the summary. */
  lines: string[];
  /** Headline of the failure list; null unless `failed`. */
  headline: string | null;
  /** The failure list: relative path ("" for an entry about no file) and text of each entry. */
  failures: { path: string; text: string }[];
  /** False: the gate settled without the window ever being seen (nothing to migrate, or already migrated). */
  dialogShown: boolean;
}

const MIGRATION_TIMEOUT_MS = 20 * 60_000;

/**
 * Waits until the migration gate has passed or failed for the current folder. A summary is read and
 * confirmed with OK; a failure list is read and left open (nothing is clicked).
 */
export async function settleBulkMigration(page: Page): Promise<BulkMigrationOutcome> {
  const dialog = page.getByTestId("migration-dialog");
  let dialogShown = false;
  const deadline = Date.now() + MIGRATION_TIMEOUT_MS;
  let status: string | undefined;
  for (;;) {
    if (await dialog.isVisible()) dialogShown = true;
    status = await page.evaluate(() => document.documentElement.dataset.migrationGate);
    if (status === "passed" || status === "failed") break;
    if (Date.now() > deadline) throw new Error(`timed out waiting for the migration gate (state ${status})`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (status === "failed") {
    const failed = page.getByTestId("migration-failed");
    await failed.waitFor({ state: "visible" });
    const headline = ((await page.getByTestId("migration-headline").textContent()) ?? "").trim();
    const failures: BulkMigrationOutcome["failures"] = [];
    for (const entry of await failed.getByTestId("migration-failure").all()) {
      const pathElement = entry.locator(".failure-path");
      failures.push({
        path: (await pathElement.count()) > 0 ? ((await pathElement.textContent()) ?? "").trim() : "",
        text: ((await entry.locator(".failure-text").textContent()) ?? "").trim(),
      });
    }
    console.log(`migration gate failed: ${headline} | ${failures.map((f) => `${f.path}: ${f.text}`).join(" | ")}`);
    return { status, migrated: 0, zipName: null, lines: [], headline, failures, dialogShown: true };
  }

  const summary = page.getByTestId("migration-summary");
  if (!(await summary.isVisible())) {
    return { status: "passed", migrated: 0, zipName: null, lines: [], headline: null, failures: [], dialogShown };
  }
  const migrated = Number(await summary.getAttribute("data-migrated"));
  const lines = (await summary.locator("p").allTextContents()).map((line) => line.trim());
  console.log(`migration summary: ${lines.join(" | ")}`);
  const zipName = lines.find((line) => line.startsWith("Sicherung: "))?.slice("Sicherung: ".length) ?? null;
  await page.getByTestId("migration-ok").click();
  await dialog.waitFor({ state: "hidden" });
  return { status: "passed", migrated, zipName, lines, headline: null, failures: [], dialogShown: true };
}

/**
 * Starts the app headless with the migration gate enabled, waits until it passed or failed (see
 * `settleBulkMigration`) and quits the app.
 */
export async function runBulkMigration(
  app: AppUnderTest,
  folder: string,
  options: Omit<LaunchOptions, "bulkMigration"> = {},
): Promise<BulkMigrationOutcome & { networkRequests: string[] }> {
  const launched = await launchApp(app, folder, { ...options, bulkMigration: true });
  let outcome: BulkMigrationOutcome;
  try {
    outcome = await settleBulkMigration(launched.page);
  } catch (error) {
    await launched.close().catch(() => undefined);
    throw error;
  }
  await launched.close();
  return { ...outcome, networkRequests: launched.networkRequests() };
}

export type OpenSheetOptions = LaunchOptions;

/**
 * Starts the app (see `launchApp`) and shows `pdfPath` (absolute or relative to `folder`) in the
 * SheetViewer once the migration gate passed. With `bulkMigration: true`, the gate runs and is settled
 * first (`SheetSession.bulkMigration`); a failed gate is an error.
 */
export async function openSheet(
  app: AppUnderTest,
  folder: string,
  pdfPath: string,
  options: OpenSheetOptions = {},
): Promise<SheetSession> {
  const launched = await launchApp(app, folder, options);
  const { electronApp, page, refreshRequests } = launched;
  try {
    // No sheet opens before the gate passed (App.vue's router guard). Without `bulkMigration` the folder
    // counts as migrated (SMV_DISABLE_BULK_MIGRATION), so the gate passes at once.
    const migration = options.bulkMigration ? await settleBulkMigration(page) : null;
    if (migration && migration.status !== "passed") {
      throw new Error(`the migration gate failed: ${migration.headline} ${JSON.stringify(migration.failures)}`);
    }
    if (!migration) {
      // The app sets the state while it mounts (launchApp waited for that); an app without the attribute
      // has no gate (the old app of the baseline, spec section 8).
      await page.waitForFunction(
        () => {
          const state = document.documentElement.dataset.migrationGate;
          return state === undefined || state === "passed";
        },
        undefined,
        { timeout: WAIT_TIMEOUT_MS },
      );
    }
    const showSheet = async () => {
      // Same route and path format as SheetSelection.selectItem.
      await page.evaluate((p) => {
        const app = (document.querySelector("#app") as unknown as {
          __vue_app__: { config: { globalProperties: { $router: { push(to: unknown): Promise<unknown> } } } };
        }).__vue_app__;
        return app.config.globalProperties.$router.push({ name: "SheetViewer", params: { path: p } });
      }, path.resolve(folder, pdfPath));
      await page.waitForSelector("#sheetViewerWrapper canvas[data-page]", { state: "attached" });
      await page.waitForSelector("#sheetViewerWrapper .overlay", { state: "detached", timeout: WAIT_TIMEOUT_MS });
      await page.waitForTimeout(RESIZE_DEBOUNCE_MS);
      await refreshRequests();
    };
    await showSheet();

    const currentPage = () => page.evaluate(rendererCurrentPage);
    const editButton = page.locator("header .v-btn").filter({ has: page.locator(".mdi-pencil, .mdi-close") });
    const dividerButton = page
      .locator("header .v-btn")
      .filter({ has: page.locator(".mdi-arrow-split-horizontal, .mdi-check") });
    const dividerLine = page.locator("#sheetViewerWrapper .dividerLine");
    const dividerControl = (control: "prev" | "next" | "reset" | "label") => page.getByTestId(`divider-${control}`);
    /** Where the edit canvas is (its upper canvas takes the input), in CSS px of the window. */
    const editCanvasBox = async () => {
      const box = await page.locator("#sheetViewerWrapper .canvas-container canvas.upper-canvas").boundingBox();
      if (!box) throw new Error("no edit canvas shown");
      return box;
    };
    /** DevTools session for touch input, opened on the first touch. */
    let cdp: CDPSession | undefined;
    /** The edit canvas's box at the last touchStart. */
    let touchBox: { x: number; y: number } | undefined;

    const session: SheetSession = {
      async gotoPage(target) {
        for (let current = await currentPage(); current !== target; ) {
          await page.keyboard.press(current < target ? "ArrowRight" : "ArrowLeft");
          const before = current;
          current = await waitFor(`page change from ${before}`, async () => {
            const now = await currentPage();
            return now !== before ? now : null;
          });
        }
        await refreshRequests();
      },
      async captureView(pageNumber) {
        const result = await capturePair(
          page,
          `view of page ${pageNumber}`,
          `#sheetViewerWrapper canvas[data-page="${pageNumber}"]`,
          `#sheetViewerWrapper canvas[data-page-overlay="${pageNumber}"]`,
        );
        await refreshRequests();
        return result;
      },
      async captureEdit(pageNumber) {
        const editing = (await page.locator("#sheetViewerWrapper .canvas-container").count()) > 0;
        if ((await currentPage()) !== pageNumber) {
          // Pages cannot be turned in edit mode, and leaving it would save.
          if (editing) throw new Error(`already editing another page, cannot capture page ${pageNumber}`);
          await session.gotoPage(pageNumber);
        }
        if (!editing) await session.toggleEdit();
        const result = await capturePair(
          page,
          `edit view of page ${pageNumber}`,
          `#sheetViewerWrapper canvas[data-page="${pageNumber}"]`,
          "#sheetViewerWrapper .canvas-container canvas.lower-canvas",
        );
        await refreshRequests();
        return result;
      },
      async toggleEdit() {
        const wasEditing = (await page.locator("#sheetViewerWrapper .canvas-container").count()) > 0;
        await editButton.click();
        await page.waitForSelector("#sheetViewerWrapper .canvas-container", { state: wasEditing ? "detached" : "attached" });
        await refreshRequests();
      },
      async addText(text) {
        await page.locator(".fabContainer .v-btn").filter({ has: page.locator(".mdi-format-text") }).click();
        const dialog = page.locator(".v-overlay--active .v-card").filter({ hasText: "Add Text" });
        await dialog.waitFor({ state: "visible" });
        await dialog.locator("input").fill(text);
        await dialog.getByRole("button", { name: "Ok" }).click();
        await dialog.waitFor({ state: "detached" });
        // The scrim fades out after the card is gone; until then it takes touches meant for the edit canvas.
        await page.waitForSelector(".v-overlay__scrim", { state: "detached" });
        await refreshRequests();
      },
      async leaveSheet() {
        await page.locator("header .v-btn").filter({ has: page.locator(".mdi-arrow-left") }).click();
        await page.waitForSelector("#sheetViewerWrapper", { state: "detached" });
        await refreshRequests();
      },
      reopenSheet: showSheet,
      async stubMessageBox(response) {
        await electronApp.evaluate(({ dialog }, r) => {
          const g = globalThis as { __smvMessageBoxes?: string[] };
          g.__smvMessageBoxes ??= [];
          const stub = async (...args: unknown[]) => {
            const options = args[args.length - 1] as { message?: string };
            g.__smvMessageBoxes?.push(options.message ?? "");
            return { response: r, checkboxChecked: false };
          };
          Object.defineProperty(dialog, "showMessageBox", { value: stub, configurable: true, writable: true });
        }, response);
      },
      messageBoxCalls: () =>
        electronApp.evaluate(() => [...((globalThis as { __smvMessageBoxes?: string[] }).__smvMessageBoxes ?? [])]),
      async requestWindowClose() {
        await electronApp.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()
            .find((w) => !w.webContents.getURL().startsWith("devtools:"))
            ?.close();
        });
      },
      async hangCloseSave() {
        await page.evaluate(() => {
          const app = (document.querySelector("#app") as unknown as {
            __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, { queue: object }> } } } };
          }).__vue_app__;
          const queue = app.config.globalProperties.$pinia._s.get("markupSaves")?.queue as
            | { flush: () => Promise<boolean>; hasPending: () => boolean }
            | undefined;
          if (!queue) throw new Error("markupSaves store not found");
          queue.hasPending = () => true;
          queue.flush = () => new Promise<boolean>(() => undefined);
        });
      },
      waitForExit: launched.waitForExit,
      windowCount: () =>
        electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.webContents.getURL().startsWith("devtools:")).length,
        ),
      async resizeContent(width, height, { whileEditing = false } = {}) {
        const size = { width, height };
        const hasSize = () => page.evaluate((s) => window.innerWidth === s.width && window.innerHeight === s.height, size);
        if (await hasSize()) return;
        if (!whileEditing && (await page.locator("#sheetViewerWrapper .canvas-container").count()) > 0) {
          throw new Error("cannot resize while editing");
        }
        // The resize handler renders every page again and then replaces all markup overlays.
        // Tagging the current overlays tells the new set apart from the old one.
        const overlays = await page.evaluate(() => {
          const all = document.querySelectorAll<HTMLCanvasElement>("#sheetViewerWrapper .overlayCanvas");
          all.forEach((c) => (c.dataset.smvStale = "1"));
          return all.length;
        });
        await electronApp.evaluate(({ BrowserWindow }, s) => {
          const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith("devtools:"));
          if (!win) throw new Error("app window not found");
          win.setContentSize(s.width, s.height);
        }, size);
        await waitFor(`window content ${width}x${height}`, hasSize);
        await page.waitForTimeout(RESIZE_DEBOUNCE_MS);
        await waitFor(`sheet rendered again at ${width}x${height}`, () =>
          page.evaluate((count) => {
            if (document.querySelector("#sheetViewerWrapper .overlay")) return false;
            const all = [...document.querySelectorAll<HTMLCanvasElement>("#sheetViewerWrapper .overlayCanvas")];
            return all.length === count && all.every((c) => c.dataset.smvStale === undefined);
          }, overlays),
        );
        await refreshRequests();
      },
      editZoom: async () =>
        Number((await page.evaluate(() => document.querySelector<HTMLElement>("#sheetViewerWrapper")?.dataset.editZoom)) ?? 1),
      async editView() {
        const view = await page.evaluate(() => document.querySelector<HTMLElement>("#sheetViewerWrapper")?.dataset.editView);
        if (!view) return { zoom: 1, x: 0, y: 0 };
        const [zoom, x, y] = view.split(",").map(Number);
        return { zoom, x, y };
      },
      async editCanvasSize() {
        const box = await editCanvasBox();
        return { width: box.width, height: box.height };
      },
      async startDrawing() {
        const hand = page.locator(".fabContainer .v-btn").filter({ has: page.locator(".mdi-hand-back-right-outline") });
        if ((await hand.count()) > 0) await hand.click();
        await page.locator(".fabContainer .v-btn .mdi-marker, .fabContainer .v-btn .mdi-pencil").first().waitFor();
      },
      async setHandMode() {
        const toggle = page.locator(".fabContainer .v-btn").filter({ has: page.locator(".mdi-hand-back-right-outline") });
        if ((await toggle.count()) === 0) await page.locator(".fabContainer:not(.dividerControls) > .v-btn").first().click();
        await toggle.waitFor();
      },
      async touch(type, points) {
        if (type === "touchCancel" && points.length > 0) throw new Error("touchCancel cancels every finger, pass no points");
        // Looked up once per touch sequence: the moves of a gesture follow each other quickly.
        if (type === "touchStart" || !touchBox) touchBox = await editCanvasBox();
        const box = touchBox;
        cdp ??= await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: points.map((p) => ({ x: box.x + p.x, y: box.y + p.y, id: p.id })),
        });
      },
      async pinch(center, fromDistance, toDistance, steps = 10) {
        const fingers = (distance: number) => [
          { x: center.x - distance / 2, y: center.y, id: 1 },
          { x: center.x + distance / 2, y: center.y, id: 2 },
        ];
        const [a] = fingers(fromDistance);
        await session.touch("touchStart", [a]);
        await session.touch("touchStart", fingers(fromDistance));
        for (let i = 1; i <= steps; i++) {
          await session.touch("touchMove", fingers(fromDistance + ((toDistance - fromDistance) * i) / steps));
        }
        await session.touch("touchEnd", []);
      },
      async pen(type, at) {
        const box = await editCanvasBox();
        cdp ??= await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchMouseEvent", {
          type: type === "down" ? "mousePressed" : type === "up" ? "mouseReleased" : "mouseMoved",
          x: box.x + at.x,
          y: box.y + at.y,
          button: "left",
          buttons: type === "up" ? 0 : 1,
          clickCount: type === "move" ? 0 : 1,
          pointerType: "pen",
        });
      },
      async stylusTouch(type, at) {
        const box = await editCanvasBox();
        await page.evaluate(
          ({ type, x, y }) => {
            const upper = document.querySelector("#sheetViewerWrapper .canvas-container canvas.upper-canvas");
            if (!upper) throw new Error("no edit canvas shown");
            const id = 7;
            const pointer = { pointerId: id, pointerType: "pen", clientX: x, clientY: y, bubbles: true, cancelable: true };
            const pointerType = { down: "pointerdown", move: "pointermove", up: "pointerup" }[type];
            upper.dispatchEvent(new PointerEvent(pointerType, { ...pointer, buttons: type === "up" ? 0 : 1 }));
            const touch = new Touch({ identifier: id, target: upper, clientX: x, clientY: y });
            const touchEventType = { down: "touchstart", move: "touchmove", up: "touchend" }[type];
            const touches = type === "up" ? [] : [touch];
            upper.dispatchEvent(
              new TouchEvent(touchEventType, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: [touch] }),
            );
          },
          { type, x: box.x + at.x, y: box.y + at.y },
        );
      },
      async ctrlWheel(at, deltaY) {
        const box = await editCanvasBox();
        await page.mouse.move(box.x + at.x, box.y + at.y);
        await page.keyboard.down("Control");
        try {
          await page.mouse.wheel(0, deltaY);
        } finally {
          await page.keyboard.up("Control");
        }
      },
      async wheel(dx, dy) {
        const box = await editCanvasBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(dx, dy);
      },
      async shiftWheel(deltaX, deltaY) {
        const box = await editCanvasBox();
        cdp ??= await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          deltaX,
          deltaY,
          modifiers: 8, // Shift
        });
      },
      textDialogShown: () => page.locator(".v-overlay--active .v-card").filter({ hasText: "Add Text" }).isVisible(),
      zoomFit: () => page.getByTestId("zoom-fit").click(),
      zoomFitShown: () => page.getByTestId("zoom-fit").isVisible(),
      zoomPictureShown: () => page.locator("#sheetViewerWrapper .zoomPageCanvas").isVisible(),
      zoomPicture: () =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>("#sheetViewerWrapper .zoomPageCanvas");
          if (!canvas) throw new Error("no zoomed page picture");
          const rect = canvas.getBoundingClientRect();
          const zoom = canvas.dataset.zoom;
          return {
            width: canvas.width,
            height: canvas.height,
            zoom: zoom ? Number(zoom) : null,
            cssWidth: rect.width,
            cssHeight: rect.height,
          };
        }),
      zoomPicturePixels: (x, y, width, height) =>
        page.evaluate(
          (r) => {
            const picture = document.querySelector<HTMLCanvasElement>("#sheetViewerWrapper .zoomPageCanvas");
            const edit = document.querySelector<HTMLCanvasElement>("#sheetViewerWrapper .canvas-container canvas.upper-canvas");
            const context = picture?.getContext("2d");
            if (!picture || !edit || !context) throw new Error("no zoomed page picture or edit canvas");
            const p = picture.getBoundingClientRect();
            const e = edit.getBoundingClientRect();
            return {
              data: [...context.getImageData(r.x, r.y, r.width, r.height).data],
              offsetX: p.left - e.left,
              offsetY: p.top - e.top,
            };
          },
          { x, y, width, height },
        ),
      zoomPictureStacking: (at) =>
        page.evaluate((point) => {
          const picture = document.querySelector<HTMLCanvasElement>("#sheetViewerWrapper .zoomPageCanvas");
          const container = document.querySelector<HTMLElement>("#sheetViewerWrapper .canvas-container");
          const upper = container?.querySelector<HTMLCanvasElement>("canvas.upper-canvas");
          if (!picture || !container || !upper) throw new Error("no zoomed page picture or edit canvas");
          const box = upper.getBoundingClientRect();
          return {
            editCanvasOnTop: document.elementFromPoint(box.left + point.x, box.top + point.y) === upper,
            pictureZ: Number(getComputedStyle(picture).zIndex),
            containerZ: Number(getComputedStyle(container).zIndex),
            pictureBeforeContainer: (picture.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          };
        }, at),
      async drawStroke(points) {
        const box = await editCanvasBox();
        const [first, ...rest] = points;
        await page.mouse.move(box.x + first.x, box.y + first.y);
        await page.mouse.down();
        for (const p of rest) await page.mouse.move(box.x + p.x, box.y + p.y, { steps: 10 });
        await page.mouse.up();
      },
      editCanvasPixels: (x, y, width, height) =>
        page.evaluate(
          (r) => {
            const canvas = document.querySelector<HTMLCanvasElement>("#sheetViewerWrapper .canvas-container canvas.lower-canvas");
            const context = canvas?.getContext("2d");
            if (!context) throw new Error("no edit canvas");
            return [...context.getImageData(r.x, r.y, r.width, r.height).data];
          },
          { x, y, width, height },
        ),
      async appZoom() {
        const zoomFactor = await electronApp.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith("devtools:"));
          if (!win) throw new Error("app window not found");
          return win.webContents.getZoomFactor();
        });
        const metrics = await page.evaluate(() => ({
          devicePixelRatio: window.devicePixelRatio,
          clientWidth: document.documentElement.clientWidth,
        }));
        return { ...metrics, zoomFactor };
      },
      networkRequests: launched.networkRequests,
      async probeNetworkLog() {
        // https: the app's own scheme is secure, so Chromium would block plain http as mixed content
        // before it reaches the session. The log cancels the request, so the fetch fails.
        const url = `https://smv-network-canary.invalid/${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await page.evaluate((u) => fetch(u).then(() => "loaded", () => "failed"), url);
        await refreshRequests();
        const requests = launched.networkRequests();
        if (!requests.includes(url)) {
          throw new Error(`network log not armed: canary ${url} missing from ${JSON.stringify(requests)}`);
        }
        return url;
      },
      snackbarText: () =>
        page.evaluate(() => (document.querySelector(".v-snackbar .v-snackbar__content")?.textContent ?? "").trim()),
      async writeBlockText() {
        const text = page.getByTestId("write-block-text");
        if (!(await text.isVisible())) return null;
        return (await text.locator("p").allTextContents()).map((line) => line.trim()).join(" ");
      },
      async confirmWriteBlock() {
        await page.getByTestId("write-block-ok").click();
        await page.getByTestId("write-block-dialog").waitFor({ state: "hidden" });
      },
      editButtonEnabled: () => editButton.isEnabled(),
      pageRendered: (pageNumber) =>
        page.evaluate((n) => {
          const canvas = document.querySelector<HTMLCanvasElement>(`#sheetViewerWrapper canvas[data-page="${n}"]`);
          if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
          const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
          if (!pixels) return false;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] !== 0 && (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250)) return true;
          }
          return false;
        }, pageNumber),
      markupLayerCount: () => page.locator("#sheetViewerWrapper canvas.overlayCanvas").count(),
      cutState: (turn) => page.evaluate(rendererCutState, turn),
      currentPage,
      async clickDividerButton() {
        await dividerButton.click();
        await refreshRequests();
      },
      async toggleDividerMode() {
        const wasOn = (await dividerLine.count()) > 0;
        await dividerButton.click();
        await dividerLine.first().waitFor({ state: wasOn ? "detached" : "attached" });
        await refreshRequests();
      },
      dividerButtonEnabled: () => dividerButton.isEnabled(),
      dividerModeOn: async () => (await dividerLine.count()) > 0,
      async dragDivider(dy, grabOffset = 0) {
        const box = await dividerLine.boundingBox();
        if (!box) throw new Error("no divider line shown");
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2 + grabOffset;
        if (Math.abs(grabOffset) >= box.height / 2) throw new Error(`grab offset ${grabOffset} misses the line`);
        const steps = dy === 0 ? 0 : 10;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 1; i <= steps; i++) await page.mouse.move(x, y + (dy * i) / steps);
        await page.mouse.up();
        await refreshRequests();
      },
      dividerLabel: async () => ((await dividerControl("label").textContent()) ?? "").trim(),
      async clickDividerControl(control) {
        await dividerControl(control).click();
        await refreshRequests();
      },
      dividerControlEnabled: (control) => dividerControl(control).isEnabled(),
      async pressKey(key) {
        await page.keyboard.press(key);
        await refreshRequests();
      },
      async clickAt(xShare, yShare) {
        const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        await page.mouse.click(size.width * xShare, size.height * yShare);
        await refreshRequests();
      },
      async dismissSnackbar() {
        const snackbar = page.locator(".v-snackbar .v-snackbar__wrapper");
        await snackbar.getByRole("button", { name: "OK" }).click();
        await page.waitForFunction(() => !document.querySelector(".v-snackbar .v-snackbar__content"));
      },
      fontStatus: () =>
        page.evaluate(async () => {
          const weights = [100, 300, 400, 500, 700, 900];
          await Promise.all(weights.map((w) => document.fonts.load(`${w} 16px Roboto`)));
          const title = document.querySelector("header .v-toolbar-title") ?? document.body;
          return {
            appBarFamily: getComputedStyle(title).fontFamily,
            robotoLoaded: weights.every((w) => document.fonts.check(`${w} 16px Roboto`)),
          };
        }),
      bulkMigration: () => migration,
      close: launched.close,
    };
    return session;
  } catch (error) {
    await launched.close().catch(() => undefined);
    throw error;
  }
}
