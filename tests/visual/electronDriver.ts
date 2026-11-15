import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
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
  /** Sets the window's content size and waits until the sheet and its markup are rendered again. */
  resizeContent(width: number, height: number): Promise<void>;
  networkRequests(): string[];
  /**
   * Proves that the network log is armed: the renderer requests a unique https URL, which must show
   * up in `networkRequests()` (the request is cancelled). Returns the URL, so a test can exclude it.
   */
  probeNetworkLog(): Promise<string>;
  /** Text of the open snackbar, "" if none is shown. */
  snackbarText(): Promise<string>;
  /** Computed font of the app bar title and whether Roboto (all weights the UI uses) is loaded. */
  fontStatus(): Promise<{ appBarFamily: string; robotoLoaded: boolean }>;
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

function forgePackage(root: string): AppUnderTest {
  execFileSync(npx, ["electron-forge", "package"], { cwd: root, stdio: "ignore", shell: isWindows });
  if (!fs.existsSync(path.join(root, ".vite", "build", "main.cjs"))) {
    throw new Error(`electron-forge package did not produce .vite/build/main.cjs in ${root}`);
  }
  return { root };
}

/** Builds the app as of `ref` in a reusable git worktree below test-results/visual/worktrees/. */
export async function buildAppAtRef(ref: string): Promise<AppUnderTest> {
  const root = path.join(repoRoot, "test-results", "visual", "worktrees", ref);
  if (!fs.existsSync(path.join(root, ".git"))) {
    fs.mkdirSync(path.dirname(root), { recursive: true });
    git("worktree", "add", "--detach", root, ref);
  }
  const modules = path.join(root, "node_modules");
  if (!fs.existsSync(modules)) {
    fs.symlinkSync(path.join(repoRoot, "node_modules"), modules, "junction");
  }
  if (fs.existsSync(path.join(root, ".vite", "build", "main.cjs"))) return { root };
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

export interface OpenSheetOptions {
  /** Extra environment variables for the app (e.g. `SMV_EXIT_GUARD_TIMEOUT_MS`). */
  env?: Record<string, string>;
}

/** Starts the app with an isolated profile, shows `pdfPath` (absolute or relative to `folder`) in the SheetViewer. */
export async function openSheet(
  app: AppUnderTest,
  folder: string,
  pdfPath: string,
  options: OpenSheetOptions = {},
): Promise<SheetSession> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "smv-visual-profile-"));
  // IS_TEST keeps the unpackaged app from installing Vue devtools (a download). An inherited
  // ELECTRON_RUN_AS_NODE (set e.g. by VS Code terminals) would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...inherited } = process.env;
  const { DISPLAY: _x11, WAYLAND_DISPLAY: _wayland, ...withoutDisplay } = inherited;
  const headed = process.env.VISUAL_HEADED === "1";
  const networkLog = path.join(profile, "network-log.cjs");
  fs.writeFileSync(networkLog, NETWORK_LOG_SCRIPT);
  const removeProfile = () => fs.rmSync(profile, { recursive: true, force: true });
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
    env: { ...(headed ? inherited : withoutDisplay), ...options.env, IS_TEST: "1" } as Record<string, string>,
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

    // The store reads the folder from localStorage once at startup, hence the reload.
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate((f) => localStorage.setItem("sheetMusicFolder", f), folder);
    await page.reload();
    await page.waitForFunction(() => (document.querySelector("#app") as { __vue_app__?: unknown } | null)?.__vue_app__);
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
      async waitForExit(timeoutMs) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        });
        try {
          return await Promise.race([exited.then(() => true), timedOut]);
        } finally {
          clearTimeout(timer);
        }
      },
      windowCount: () =>
        electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.webContents.getURL().startsWith("devtools:")).length,
        ),
      async resizeContent(width, height) {
        const size = { width, height };
        const hasSize = () => page.evaluate((s) => window.innerWidth === s.width && window.innerHeight === s.height, size);
        if (await hasSize()) return;
        if ((await page.locator("#sheetViewerWrapper .canvas-container").count()) > 0) {
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
      networkRequests: () => [...requests],
      async probeNetworkLog() {
        // https: the app's own scheme is secure, so Chromium would block plain http as mixed content
        // before it reaches the session. The log cancels the request, so the fetch fails.
        const url = `https://smv-network-canary.invalid/${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await page.evaluate((u) => fetch(u).then(() => "loaded", () => "failed"), url);
        await refreshRequests();
        if (!requests.includes(url)) {
          throw new Error(`network log not armed: canary ${url} missing from ${JSON.stringify(requests)}`);
        }
        return url;
      },
      snackbarText: () =>
        page.evaluate(() => (document.querySelector(".v-snackbar .v-snackbar__content")?.textContent ?? "").trim()),
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
      async close() {
        // Quitting does not leave edit mode; an open edit canvas with changes would be saved first (and
        // a failing save would ask through the native dialog, which a headless run cannot answer).
        await refreshRequests();
        if (!hasExited) {
          // A close the app keeps blocking (e.g. a broken close guard) must not hang the run.
          const closing = electronApp.close().catch(() => undefined);
          if (!(await session.waitForExit(CLOSE_TIMEOUT_MS))) {
            electronApp.process().kill("SIGKILL");
            await closing;
            throw new Error(`the app did not quit within ${CLOSE_TIMEOUT_MS} ms and was killed`);
          }
        }
        removeProfile();
      },
    };
    return session;
  } catch (error) {
    await electronApp.close().catch(() => undefined);
    removeProfile();
    throw error;
  }
}
