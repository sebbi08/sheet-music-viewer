# Blätter Seite für Seite laden – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Page 1 of a sheet shows as early as possible, the other pages follow in order, a progress bar sits in the app bar, the pencil waits for all pages and the write check, and the write check's trial build is remembered per file content in the app profile.

**Architecture:** Main: `loadMarkup` only parses (no trial build, no read-only check, no repair); a new `checkMarkupOnOpen` runs the full check (trial build through a content-keyed cache in `userData/markup-write-check.json`) and then repairs orphans; saving records `ok` for the written bytes. Renderer: `SheetViewer.vue` starts loadMarkup, pdf.js and the sheet settings in parallel, renders pages one after another (each with its markup), runs the check in the background; the store carries the loading state, `App.vue` shows a `v-progress-linear` in the app bar and keeps the pencil off while loading.

**Tech Stack:** TypeScript, Electron, Vue 3 + Vuetify 4, Pinia, tRPC, pdf.js, pdf-lib, vitest, Playwright `_electron` (headless).

**Spec:** `docs/superpowers/specs/2026-11-26-progressive-sheet-loading-design.md`

## Global Constraints

- Cache file: `markup-write-check.json` in `app.getPath("userData")`, format `{ "version": 1, "entries": { "<sha256>:<length>": { "ok": true } | { "ok": false, "message": "…" } } }`; key = SHA-256 (hex, lowercase) and length of the **whole** bytes the check read; at most **1000** entries, oldest dropped on insert; unreadable/broken file = empty, replaced on the next insert; written atomically; a write failure is logged, never thrown.
- Only the trial build's outcome is cached. `encrypted`/`unparseable` come from the parse, `readOnly` (incl. the folder probe) is checked on every open.
- `src/pdfMarkup/` stays free of Electron imports; the cache is injected.
- `checkMarkupWritable` (migration pass 1) still writes nothing but the folder probe — no repair there.
- `.config.json` is never written for the check.
- pdf.js keeps `disableRange`/`disableStream`/`disableAutoFetch`.
- Pages render strictly one after another starting at page 1; leaving the sheet or a new render run stops further pages.
- The write-block dialog still shows on **every** open when markup cannot be saved.
- GUI tests headless only; nothing in `Noten*/` is opened or changed.

## Review Focus

- A PDF whose bytes change between two opens (another program, Nextcloud sync): must be checked again — Task 1 test „a changed file misses the cache“.
- Leaving the sheet while pages render or the check runs: no further page renders, no dialog or pencil state for the next sheet — Task 3 step (guards) and Task 4 visual test „leaving during the load“.
- A resize during the load: the running pass stops, a new pass renders all pages in order, the bar reflects the new pass — Task 3 (render run counter) and Task 4 visual test „resize during the load“.
- A read-only PDF with a cache hit `ok`: still blocked as `readOnly` — Task 2 test.
- An encrypted PDF: hint at once, stamps stay visible, no background check — Task 2 test (loadMarkup) and Task 4 visual test.

---

### Task 1: Content-keyed write-check cache

**Files:**
- Create: `src/pdfMarkup/writeCheckCache.ts`
- Test: `tests/pdfMarkup/writeCheckCache.test.ts`

**Interfaces:**
- Produces:
  - `type CachedWriteCheck = { ok: true } | { ok: false; message: string }`
  - `interface WriteCheckCache { get(key: string): Promise<CachedWriteCheck | undefined>; set(key: string, value: CachedWriteCheck): Promise<void> }`
  - `contentKey(bytes: Uint8Array): string` → `` `${sha256hex}:${bytes.length}` ``
  - `createFileWriteCheckCache(file: string, maxEntries = 1000): WriteCheckCache` — reads the file on each `get`/`set` (or keeps it in memory after the first read; either is fine), entries kept in insertion order, `set` of an existing key moves it to the end, writes atomically (temp file + rename in the same folder), creates the folder if missing.

- [ ] **Step 1: Write the failing tests** (temp dir per test):
  - `contentKey`: equals `createHash("sha256")` hex + `":" + length`; different bytes → different key.
  - „round trip“: `set(k, {ok:true})`, new instance on the same file → `get(k)` is `{ok:true}`; `{ok:false,message:"x"}` likewise; file content `{ version: 1, entries: { [k]: … } }`.
  - „a changed file misses the cache“: `get(contentKey(other bytes))` → `undefined`.
  - „broken file counts as empty and is replaced“: file `"{ not json"` → `get` undefined, `set` writes a valid file with only the new entry; same for `{ "version": 2, … }`? → treat any version ≠ 1 as empty.
  - „oldest dropped beyond maxEntries“: `createFileWriteCheckCache(file, 3)`, set k1..k4 → k1 gone, k2..k4 kept.
  - „write failure is swallowed“: cache file path inside a read-only dir (skip as root) → `set` resolves, `get` returns undefined.

- [ ] **Step 2: Run** `npx vitest run tests/pdfMarkup/writeCheckCache.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/pdfMarkup/writeCheckCache.ts` (node `crypto`, `fs`, `path` only).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat: content-keyed cache for the markup write check`

### Task 2: Split load and check in the main process

**Files:**
- Modify: `src/pdfMarkup/markupFile.ts` (`loadNow`, `checkMarkupWritable`, `writeBlockOf`, `saveNow`, new `checkMarkupOnOpen`, `setWriteCheckCache`), `src/models/markup.ts` (doc of `LoadMarkupResult.writeBlock`), `src/trcpRouter.ts` (procedure `checkMarkupOnOpen`, cache wiring)
- Test: `tests/pdfMarkup/markupFile.test.ts`

**Interfaces:**
- Consumes: Task 1 `WriteCheckCache`, `contentKey`, `createFileWriteCheckCache`.
- Produces:
  - `setWriteCheckCache(cache: WriteCheckCache | null): void` (module-level; default `null` = no cache).
  - `loadMarkupFromFile(pdfPath)` → `LoadMarkupResult` with `writeBlock` only `{reason:"encrypted"}`, `{reason:"unparseable", message}` or `null`; no trial build, no read-only check, no repair, never writes.
  - `checkMarkupOnOpen(pdfPath: string): Promise<WriteBlock | null>` — serialized per file; reads the file itself; parse → encrypted/unparseable; `isWritable` → readOnly; trial build via the cache (hit `{ok:false,message}` → `{reason:"structure", message}`, hit `{ok:true}` → no build; miss → build, store result); when the result is `null` and the PDF has orphans, repair them (as `loadNow` did) and record `ok` for the repaired bytes. Never throws.
  - `checkMarkupWritable(pdfPath)` — same check through the cache, **no repair**.
  - tRPC `checkMarkupOnOpen: publicProcedure.input(pdfPathSchema).query(...)`.
  - Wiring: in `src/trcpRouter.ts` next to the other `userData` use, `setWriteCheckCache(createFileWriteCheckCache(path.join(app.getPath("userData"), "markup-write-check.json")))` once at module load.

- [ ] **Step 1: Update and add tests** in `tests/pdfMarkup/markupFile.test.ts` (an in-memory `WriteCheckCache` helper recording `get`/`set` calls; `setWriteCheckCache(null)` in `afterEach`):
  - Rename „orphans are repaired on load“ → „orphans are repaired by the check on open, not by the load“: after `loadMarkupFromFile`, orphans still `toHaveLength(1)` and the file is byte-identical; after `checkMarkupOnOpen` → `null`, orphans `[]`, same annotation assertion as today. Same change for „orphans of a PDF whose data and metadata are gone…“ (`loadMarkupFromFile` → `{source:"none", pages:[], writeBlock:null}`, repair after `checkMarkupOnOpen`).
  - „a PDF with an orphan and a broken structure is not repaired on load“ → `loadMarkupFromFile(...).writeBlock` is `null`; `checkMarkupOnOpen` → `{reason:"structure"}`; file byte-identical, folder only `q.pdf`.
  - „a writable PDF has no write block“: `loadMarkupFromFile(...).writeBlock` and `checkMarkupOnOpen` both `null`; `checkMarkupWritable` unchanged.
  - Encrypted / unparseable tests: `loadMarkupFromFile` still reports them (`encrypted`, `unparseable` with message).
  - New „load does no trial build and no read-only check“: read-only PDF (chmod 0o444, skip as root) → `loadMarkupFromFile(...).writeBlock` is `null`, `checkMarkupOnOpen` → `{reason:"readOnly"}`.
  - New „a cached structure result skips the trial build“: writable PDF, cache pre-filled `{ [contentKey(bytes)]: {ok:false, message:"cached"} }` → `checkMarkupOnOpen` → `{reason:"structure", message:"cached"}` and `checkMarkupWritable` the same.
  - New „a miss stores the trial result“: empty cache → `checkMarkupOnOpen` → `null`, cache has `{ [contentKey(bytes)]: {ok:true} }`; broken-structure PDF → entry `{ok:false, message: <same message as the returned block>}`.
  - New „readOnly despite a cached ok“ (skip as root).
  - New „a save records ok for the written bytes“: `saveMarkupToFile` → cache has `{ [contentKey(fs.readFileSync(pdf))]: {ok:true} }`.
  - New „checkMarkupWritable never repairs“: orphan PDF → `checkMarkupWritable` → `null`, orphans still 1, bytes identical.
- [ ] **Step 2: Run** `npx vitest run tests/pdfMarkup/markupFile.test.ts` — Expected: the new/changed tests FAIL.
- [ ] **Step 3: Implement** in `markupFile.ts` and `trcpRouter.ts` as in Interfaces; `writeBlockOf` takes the bytes' key and uses the cache around `trialBuild`; `saveNow` calls `cache?.set(contentKey(marked), {ok:true})` after `atomicReplace` succeeded (errors from `set` are already swallowed). Update doc comments and the `LoadMarkupResult.writeBlock` doc in `src/models/markup.ts`.
- [ ] **Step 4: Run** `npx vitest run tests/pdfMarkup` then `npm test` — Expected: PASS (the viewer still compiles: it reads `loaded.writeBlock` as before; Task 3 adds the check call).
- [ ] **Step 5: Commit** `feat: load markup without the write check; check on open through a remembered result`

### Task 3: Viewer loads page by page; bar in the app bar; pencil waits

**Files:**
- Modify: `src/views/SheetViewer.vue` (template top, `onMounted`, `renderPdf`, `populateOverlayCanvas`, edit-mode watch, `onBeforeUnmount`), `src/store/index.ts` (state `sheetLoading`), `src/App.vue` (bar, pencil), `tests/visual/electronDriver.ts` and `tests/visual/favorites.visual.ts` (wait for the new marker instead of `.overlay`)

**Interfaces:**
- Consumes: Task 2 `client.checkMarkupOnOpen.query(sheetPath): Promise<WriteBlock | null>`; `LoadMarkupResult.writeBlock` now only encrypted/unparseable.
- Produces:
  - Store state `sheetLoading: { loaded: number; total: number; checking: boolean } | null` (null = nothing loading / not in the viewer).
  - DOM markers: `canvas[data-page="<n>"][data-rendered]` once page n (and its half-step copy and its markup overlays) is done; `#sheetViewerWrapper[data-sheet-loaded="true"]` once all pages are done and the check returned (i.e. `sheetLoading === null` after a load); the bar `[data-testid="sheet-loading"]` inside `header`.

- [ ] **Step 1: Driver first.** In `tests/visual/electronDriver.ts` (the two `.overlay` waits, lines ~757 and ~905) and `tests/visual/favorites.visual.ts` (~120, ~398) wait for `#sheetViewerWrapper[data-sheet-loaded="true"]` instead (the resize wait: the marker is reset to absent when a render run starts, so wait for it again). Run `npx vitest run -c vitest.visual.config.mts tests/visual/favorites.visual.ts -t "mark in the viewer"` — Expected: FAIL (marker never appears).
- [ ] **Step 2: Store and app bar.** `sheetLoading` in `src/store/index.ts`. In `src/App.vue` inside `v-app-bar`: `<v-progress-linear v-if="store.sheetLoading && route is SheetViewer" data-testid="sheet-loading" absolute location="bottom" :model-value="loaded/total*100" :indeterminate="loaded === total" color="white" height="3" />` (indeterminate once all pages are done and only the check runs). Pencil `:disabled` additionally `|| store.sheetLoading !== null` (keeps `mdi-close` enabled while already editing: only when `!store.editMode`).
- [ ] **Step 3: Viewer.**
  - Remove the `v-progress-circular.loader` and `div.overlay` (and their CSS).
  - `onMounted`: set `store.sheetLoading = { loaded: 0, total: 0, checking: true }`; start `client.loadMarkup.query`, `pdfJs.getDocument(...)` and `loadDividers()` at once; await loadMarkup and the pdf (not the dividers). Then as today: failed load → `markupEditDisabled`, notice `LOAD_FAILED`, `checking: false`; `loaded.writeBlock` (encrypted/unparseable) → disabled, dialog at once, `checking: false`; otherwise start `client.checkMarkupOnOpen.query(sheetPath)` without awaiting: on result, return if `unmounted`; a block → `markupEditDisabled`, `writeBlock`, dialog; finally `checking: false` (also on a rejected call: treat like a failed load → disabled + `LOAD_FAILED`). OCG hiding exactly as today (based on `loaded.writeBlock`). `applyLoadedMarkup`, then `renderPdf()`.
  - `loadDividers()` resolving after pages were rendered: call `applyAllCuts()` (cuts of rendered pages follow).
  - `renderPdf()`: `const run = ++renderRun`; `pageNumbers`, `pagesLoaded = 0`; remove `data-sheet-loaded` and every `data-rendered`; clear overlays; `sheetLoading.loaded = 0`, `total = n` (keep `checking`). After the DOM has the canvases (`nextTick`/`setTimeout 0` as today), `for i = 1..n` sequentially: `if (unmounted || run !== renderRun) return`; `await renderPage(i, …)`; draw the overlays of page i (and its half step) via a function extracted from `populateOverlayCanvas` (`drawPageOverlays(pageNumber)`); set `data-rendered`; `pagesLoaded++`, `sheetLoading.loaded++`; `setOverlayVisible()`. After the loop: `applyAllCuts()`.
  - `sheetLoading` becomes `null` when `pagesLoaded === pageNumbers && !checking` (a watch); then set `data-sheet-loaded="true"` on `#sheetViewerWrapper`.
  - Edit-mode watch guard: replace `pagesLoaded.value !== pageNumbers.value` by `store.sheetLoading !== null`.
  - `onBeforeUnmount`: `store.sheetLoading = null`, `renderRun++`.
  - Leaving edit mode still calls `populateOverlayCanvas()` (all pages) — keep it, built on `drawPageOverlays`.
- [ ] **Step 4: Run** `npm test`, `npm run lint`, `npx vue-tsc --noEmit` (only the known `tsconfig.json` deprecation errors), then headless `npx vitest run -c vitest.visual.config.mts tests/visual/favorites.visual.ts tests/visual/pageDivider.visual.ts tests/visual/writeBlock.visual.ts tests/visual/whitePen.visual.ts tests/visual/editZoom.visual.ts tests/visual/iconHitbox.visual.ts` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat: show sheet pages one by one with a progress bar in the app bar`

### Task 4: Visual test of the loading, docs

**Files:**
- Create: `tests/visual/sheetLoading.visual.ts`
- Modify: `AGENTS.md` („Check on open“, new section „Loading a sheet“, visual test list), `tests/visual/writeBlock.visual.ts` only if its expectations about timing break

**Interfaces:**
- Consumes: Task 3 markers and bar; driver `launchApp(app, folder, { profile })` (profile kept, files can be put in before the start).

- [ ] **Step 1: Write the tests** (synthetic folder below `test-results/visual/work/`, a PDF with enough pages that rendering takes visibly long, e.g. 40 pages from `makePdf({ pages: 40, xref: "table" })` — raise the count if the first assertion is flaky; markup saved on page 1 and on the last page with `saveMarkupToFile`):
  - „page 1 shows before the last page is done“: right after opening, poll quickly until `canvas[data-page="1"][data-rendered]` exists; at that moment: fewer than 40 `canvas[data-page][data-rendered]` (integer pages), `[data-testid="sheet-loading"]` visible in `header`, the pencil button disabled, page 1's overlay canvas exists. Then wait for `data-sheet-loaded` → bar gone, pencil enabled, every page and both overlays present.
  - „pages are done in order“: record the order in which `data-rendered` appears (MutationObserver installed via `page.evaluate` before navigation, or a timestamp attribute) → `1, 2, …, 40`.
  - „second open uses the remembered check“: profile kept between two starts; before the second start, rewrite `markup-write-check.json` in the profile so the PDF's key (`contentKey` of its current bytes) is `{ ok: false, message: "aus dem Merker" }` → opening shows the write-block dialog with that message and the pencil stays off; after the first start the file holds `{ ok: true }` for that key.
  - „encrypted PDF: hint at once, no check“ — reuse the encrypted fixture used by `writeBlock.visual.ts`: dialog shows, pencil off, `markup-write-check.json` not created.
  - „leaving during the load“: open, leave with the back button as soon as page 1 is rendered → no error in the console, no write-block dialog afterwards on the folder view, the store's `sheetLoading` is null (bar gone).
  - „resize during the load“: resize while loading → `data-sheet-loaded` arrives, all pages rendered, order of the second pass again 1..n.
  - Every case: PDF bytes unchanged except where a save is part of the setup; `networkRequests()` empty.
- [ ] **Step 2: Run** `npx vitest run -c vitest.visual.config.mts tests/visual/sheetLoading.visual.ts` — Expected: PASS (the behaviour exists since Task 3; this task pins it). If a case fails, fix the cause in the viewer, not the test.
- [ ] **Step 3: AGENTS.md**: in „Check on open“ say `loadMarkup` only parses, `checkMarkupOnOpen` runs in the background (cache file, key, 1000 entries, repair of orphans there, save records ok), `checkMarkupWritable` (migration) never repairs; new section „Loading a sheet“ (parallel start, pages in order with their markup, bar `data-testid="sheet-loading"`, pencil off until all pages and the check, markers `data-rendered`/`data-sheet-loaded`); add `sheetLoading.visual.ts` to the visual test list.
- [ ] **Step 4: Verify** `npm test`, `npm run lint`, and the full synthetic visual set headless: `npx vitest run -c vitest.visual.config.mts tests/visual/{migrationGate,writeBlock,folderSetup,singleInstance,folderConfig,pageDivider,editZoom,iconHitbox,whitePen,favorites,sheetLoading}.visual.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `test: page-by-page loading and the remembered write check; docs`
