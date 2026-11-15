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

export interface SheetSession {
  gotoPage(page: number): Promise<void>;
  captureView(page: number): Promise<{ with: Img; without: Img }>;
  captureEdit(page: number): Promise<{ with: Img; without: Img }>;
  toggleEdit(): Promise<void>;
  networkRequests(): string[];
  close(): Promise<void>;
}

const WINDOW = { width: 1200, height: 1600 };
const RESIZE_DEBOUNCE_MS = 600;
const STABLE_FOR_MS = 1000;
const MARKUP_GRACE_MS = 6000; // > fontfaceobserver's default 3 s timeout before fabric loads objects
const WAIT_TIMEOUT_MS = 120_000;
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
function rendererComposite(layerSelectors: string[]): { url: string; ink: boolean } | null {
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
  return { url: out.toDataURL("image/png"), ink };
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
async function captureStable(page: Page, what: string, layers: string[]): Promise<Img> {
  const expectMarkup = layers.length > 1;
  let last = "";
  let stableSince = 0;
  const dataUrl = await waitFor(what, async () => {
    const shot = await page.evaluate(rendererComposite, layers);
    if (!shot) return null;
    if (shot.url !== last) {
      last = shot.url;
      stableSince = Date.now();
      return null;
    }
    const stableFor = Date.now() - stableSince;
    const needed = expectMarkup && !shot.ink ? MARKUP_GRACE_MS : STABLE_FOR_MS;
    return stableFor >= needed ? shot.url : null;
  });
  return decodePng(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}

/** Starts the app with an isolated profile, shows `pdfPath` (absolute or relative to `folder`) in the SheetViewer. */
export async function openSheet(app: AppUnderTest, folder: string, pdfPath: string): Promise<SheetSession> {
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
    env: { ...(headed ? inherited : withoutDisplay), IS_TEST: "1" } as Record<string, string>,
    cwd: app.root,
  }).catch((error: unknown) => {
    removeProfile();
    throw error;
  });
  let requests: string[] = [];
  const refreshRequests = async () => {
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
        const result = {
          with: await captureStable(page, `view of page ${pageNumber}`, [
            `#sheetViewerWrapper canvas[data-page="${pageNumber}"]`,
            `#sheetViewerWrapper canvas[data-page-overlay="${pageNumber}"]`,
          ]),
          without: await captureStable(page, `page ${pageNumber}`, [`#sheetViewerWrapper canvas[data-page="${pageNumber}"]`]),
        };
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
        const result = {
          with: await captureStable(page, `edit view of page ${pageNumber}`, [
            `#sheetViewerWrapper canvas[data-page="${pageNumber}"]`,
            "#sheetViewerWrapper .canvas-container canvas.lower-canvas",
          ]),
          without: await captureStable(page, `page ${pageNumber}`, [`#sheetViewerWrapper canvas[data-page="${pageNumber}"]`]),
        };
        await refreshRequests();
        return result;
      },
      async toggleEdit() {
        const wasEditing = (await page.locator("#sheetViewerWrapper .canvas-container").count()) > 0;
        await editButton.click();
        await page.waitForSelector("#sheetViewerWrapper .canvas-container", { state: wasEditing ? "detached" : "attached" });
        await refreshRequests();
      },
      networkRequests: () => [...requests],
      async close() {
        // Quitting does not leave edit mode, so nothing is saved.
        await refreshRequests();
        await electronApp.close();
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
