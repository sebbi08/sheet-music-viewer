# AGENTS.md

## Build & Run

```bash
npm start              # dev mode (hot-reload)
npm run make           # build distributables (all platforms, x64 only)
npm run package        # package only (no installer)
npm run lint           # eslint --ext .ts,.tsx .
npm test               # vitest unit tests (tests/**/*.test.ts); Noten/ cases skip without the corpus
npm run test:visual    # visual comparison new app vs old app (see below)
```

### Visual tests (`npm run test:visual`)

- Compares the new app against the old app (commit `8301b5d`, override with
  `VISUAL_BASELINE_REF`) on every `Noten/*.pdf` that has a legacy `.data` file (spec section 8).
  Needs the local `Noten/` corpus with `.data` files; without it the corpus tests are skipped. The
  tests on synthetic folders below `test-results/visual/work/` run without it: `migrationGate.visual.ts`
  (the gate's flow), `writeBlock.visual.ts` (the check on open), `folderSetup.visual.ts` (choosing a new
  sheet folder shows the current one and the folder dialog opens at it), `singleInstance.visual.ts`,
  `folderConfig.visual.ts` (`.config.json`), `pageDivider.visual.ts` (the movable page divider),
  `editZoom.visual.ts` (zooming in edit mode), `iconHitbox.visual.ts` (the box of a music symbol),
  `whitePen.visual.ts` (the white pen below other marks), `favorites.visual.ts` (favorites, see
  "Favoriten"), `sheetLoading.visual.ts` (loading a sheet page by page and the remembered write check, see
  "Loading a sheet") and the read-only folder case of
  `bulkMigration.visual.ts`;
  see "Markup storage" for what each file checks ("Page divider" for `pageDivider.visual.ts`, "Zoom in
  edit mode" for `editZoom.visual.ts`).
- Never opens anything inside `Noten/`: every run works on a copy (the new app migrates on start).
- The comparison reaches the migration through the **migration gate**: per PDF a copy with only that PDF
  and its `.data` (`copyCorpusFiles`), the app starts with `bulkMigration: true` (the gate migrates the
  file), then the sheet is opened. The viewer itself never migrates. Without `bulkMigration: true` the
  driver sets `SMV_DISABLE_BULK_MIGRATION=1`, so the folder counts as migrated and the gate does nothing.
- Builds both apps (`electron-forge package`; the old one in a git worktree below
  `test-results/visual/worktrees/`). The old app's reference images are cached in
  `test-results/visual/baseline/<ref>/` and recaptured when the PDF, its `.data` or the commit
  change. An uncached run takes several minutes.
- The old app's build runs `npm ci --ignore-scripts` in its nested worktree (its own lockfile), so the
  first uncached run needs the network.
- Outputs go to `test-results/visual/` (gitignored): `diff/<pdf>/<page>-<check>.png`
  (reference | new | diff | markup masks) for every violation, `compare-summary.md` with all
  numbers. `VISUAL_DIFF_ALL=1` writes the images of passing checks, too.
  `VISUAL_KEEP_MIGRATED=1` keeps a copy of every migrated PDF in `test-results/visual/migrated/`
  (e.g. to check the markup in Acrobat or another viewer).
- Headless by default on Linux (`--ozone-platform=headless`, no display needed);
  `VISUAL_HEADED=1` shows the windows for debugging. **Windows:** Ozone is Linux-only, so Chromium
  ignores that flag and the driver does not hide the windows: each app start shows a 1200×1600
  window for a few seconds. Do not click into or resize them during the run. Not yet tried on
  Windows: if the OS keeps the window smaller than 1200×1600 (small screen), the run stops with
  `timed out waiting for window content 1200x1600`.

## Architecture

- **Electron Forge** + **Vite** (3 separate configs: main, preload, renderer)
- **Vue 3** + **Vuetify 4** + **Pinia** + **Vue Router** (hash mode)
- **tRPC** (`electron-trpc`) for type-safe IPC between main and renderer
- Entry points: `src/main.ts` (main), `src/preload.ts` (preload), `src/renderer.ts` (renderer)
- Vite build output goes to `.vite/`, Electron Forge output to `out/`
- ASAR packaging enabled; fuses: RunAsNode=false, CookieEncryption, AsarIntegrity

## Markup storage (spec: `docs/superpowers/specs/2026-11-15-markup-in-pdf-design.md`)

- Markup is stored **inside the PDF**: per page one Stamp annotation (`/NM (smv-markup-page)`) with a
  PNG appearance, the fabric JSON (in PDF points, plus the page's display rotation) in a hidden
  `/SMV_Data` stream, catalog metadata `/SMV_Markup`. Code: `src/pdfMarkup/` (main process, no
  Electron imports, unit-tested), constants in `src/models/markupConstants.ts`.
- Saved as an **incremental update** that is **replaced** on every save while it is the last one
  (the original bytes stay a prefix; the file does not grow); updates of other programs are kept.
  Written atomically (temp file, read-back verification, rename; retried ~3 s while Windows reports
  the file as locked).
- Our stamps belong to an **OCG** ("Sheet Music Viewer – Markierungen"); the app hides it in pdf.js and
  draws the markup with fabric instead only when it could read the markup data (for an encrypted or
  unreadable PDF the stamps stay visible); other viewers show and print the stamp.
- Markup is stored **only in the PDF** (spec: `docs/superpowers/specs/2026-11-20-strict-markup-migration-design.md`).
  A PDF that cannot be written (encrypted, unparseable, read-only, a structure the writer cannot update,
  still locked after the retries) is a save **error** with a reason; the PDF stays byte-identical and no
  `.data` file is ever written. `loadMarkup` never reads a `.data` file.
- **Check on open:** every open determines whether markup can be saved into the PDF (encrypted,
  unparseable, read-only incl. a folder probe file, or a trial build in memory that fails) and, if not,
  shows a dialog with the reason on **every** open (`src/components/WriteBlockDialog.vue`); the sheet stays
  readable, the pencil is off (spec: `docs/superpowers/specs/2026-11-26-progressive-sheet-loading-design.md`).
  It runs in two steps (`src/pdfMarkup/markupFile.ts`):
  - `loadMarkup` (tRPC, `loadMarkupFromFile`) only parses: markup plus `LoadMarkupResult.writeBlock`, which
    is only `encrypted` or `unparseable` (markup not readable, the stamps stay visible), else `null`. No
    read-only check, no trial build, never writes. With a block the viewer shows the dialog at once and
    checks nothing more.
  - Otherwise the viewer starts `checkMarkupOnOpen` (tRPC query) in the background: it reads the file
    itself, checks read-only freshly on every open and takes the trial build's result from a cache in the
    profile (a miss builds it and remembers `ok` or the `structure` message), **`markup-write-check.json`** in userData (`src/pdfMarkup/writeCheckCache.ts`, set in
    `src/trcpRouter.ts` via `setWriteCheckCache`): `{ "version": 1, "entries": { "<sha256 hex>:<length>":
    { "ok": true } | { "ok": false, "message": "…" } } }`, keyed by the content of the whole file
    (`contentKey`, so a moved but identical PDF hits and any change misses), at most 1000 entries (the oldest
    go), written atomically; an unreadable or broken file counts as empty, a failed write is logged. Only
    when the PDF can be written does it repair orphaned stamps (`ok` is remembered for the repaired bytes).
    A successful save remembers `ok` for the bytes it wrote. Its result is ignored once the sheet was left.
  - `checkMarkupWritable` (migration pass 1) runs the same check through the same cache but never repairs.
  Nothing of this is written into the sheet folder (`.config.json` stays untouched).
- Unsaved changes live in the renderer's `markupSaves` store (`src/markup/saveQueue.ts`), survive
  leaving the sheet, are retried every 30 s, and closing the window asks before discarding them
  (renderer: `src/markup/closeGuard.ts`; main: `src/exitGuardMachine.ts` + `src/exitGuard.ts`). Main
  shows the dialog itself if the renderer has not reported within 10 s, on a second close while the
  save runs, or when the renderer hangs; a crashed renderer never blocks closing.
- **Migration gate** for legacy `.data` files: on start and after a folder change, a sheet folder that is
  not yet marked as migrated runs the gate behind a blocking dialog before any sheet can be opened
  (`src/components/MigrationDialog.vue`, store `src/store/bulkMigration.ts`, flow `src/migration/gate.ts`,
  logic in `src/migration/`, no Electron imports). Main scans like the sheet list (recursive, links to
  folders and PDFs followed, each real path once; an unreadable folder or link target is a failure); a
  candidate is a PDF with a `.data` file next to it. **Pass 1** converts and checks every candidate without
  writing anything (`migrateSidecarToFile` with `dryRun`). Only if all pass, main writes
  **`Markierungen-Backup YYYY-MM-DD HH-MM.zip`** (local time; ` (2)` … on a collision) into the sheet
  folder with every candidate PDF and `.data` and verifies it (size + CRC-32 per entry); an incomplete
  backup migrates nothing. **Pass 2** writes each PDF (read-back), then deletes its `.data` (a `.data`
  without markup, or one the PDF already holds, is only deleted). Any failure shows the full list
  (relative path, cause, what to do) with "Erneut prüfen", "Anderen Notenordner wählen" and "Schließen";
  "Abbrechen" during a run closes the app. A cancelled run that leaves the app open (its close was
  cancelled) shows "Die Übernahme wurde abgebrochen. …" with the same three buttons. A run without any
  failure writes **`markupMigrated`** into `.config.json` in the sheet folder (shared between PCs, so a
  fresh copy of the folder without that file runs the gate again); `.data` files in a marked folder are
  ignored from then on. An unreadable `.config.json` is a `configUnreadable` failure in the gate's list.
  The old `markup-migrated-folders.json` in the profile is deleted at start, its entries are not carried
  over (every folder passes the gate once more). A single-instance lock (per userData,
  `src/main.ts`) keeps a second start from running a second gate; it focuses the running window. `SMV_DISABLE_BULK_MIGRATION=1` makes the app
  treat every folder as migrated, so the gate is skipped and `.data` files are ignored; it is honoured
  only together with `IS_TEST=1` (tests only: the visual driver sets both, the first unless
  `bulkMigration: true`).
- Visual tests (`npm run test:visual`, see above): `compare.visual.ts` compares the markup the gate
  migrated against the old app (checks A–Er, per PDF); `bulkMigration.visual.ts` runs the whole corpus
  through the gate (no `.data` left, one backup zip with the original bytes, embedded pages, folder
  marked, no dialog on the second start) and prepared failures among the corpus (all listed, nothing
  changed, passes once fixed), plus a read-only folder; `migrationGate.visual.ts` checks the gate's
  flow on synthetic folders (failure list, "Erneut prüfen", folder change, also during a run, reload,
  "Abbrechen", no corpus needed); `writeBlock.visual.ts` checks the check on open (dialog on every open, pencil off, markup
  already in the PDF stays visible, a `.data` next to a PDF is ignored); `singleInstance.visual.ts`
  checks the single-instance lock; `folderConfig.visual.ts` checks `.config.json` (set lists stay in their
  folder on a folder change, takeover of `.set-lists.json`, no write on a start without changes, a broken
  file or one of a newer app shows a notice and is not overwritten, a save on set lists another PC changed
  meanwhile is refused and reloads them).

- **`.config.json`** in the sheet folder (`src/folderConfig.ts`, spec:
  `docs/superpowers/specs/2026-11-22-folder-config-design.md`) holds the set lists (`setLists`, formerly
  `.set-lists.json`), `markupMigrated` and per sheet (`sheets["<sheetKey>"]`) the page dividers
  (`pageDividers`, see "Page divider"), the favorite (`favorite`) and the PDF's fingerprint (`fingerprint`,
  see "Favoriten"). On the first
  load of a folder without it, `.set-lists.json` is taken over: `.config.json` is written and read back,
  only then the old file is deleted. Writes change
  one part, atomically and only on a real change; reads are retried while the file is locked. An
  unreadable file is never overwritten (set lists show a notice and are not saved; the gate lists it), and
  a sheet folder that does not exist is unreadable, not empty. A set-list save sends the set lists it was
  based on and writes only while the file still holds them; otherwise the store reloads them and asks to
  repeat the change. A file of a newer app (`version` above 1 or `setLists.version` above 2) is a
  `configNewer` failure in the gate and a set-list notice asking to update the app; unknown fields
  (also inside set lists, `markupMigrated` and a sheet's `fingerprint`) survive every write.

## Loading a sheet

- Spec: `docs/superpowers/specs/2026-11-26-progressive-sheet-loading-design.md`. On open
  (`src/views/SheetViewer.vue`) `loadMarkup`, pdf.js loading the whole file and `loadSheetSettings` start at
  the same time; once PDF and markup are there, the pages are drawn **one after another from page 1**, each
  with its half step, its cut and its markup overlays, and a page shows once it is done (pages can be turned
  meanwhile; a page not done yet stays white). Dividers that arrive later re-cut the pages already drawn.
  The write check (`checkMarkupOnOpen`, see "Check on open") runs in parallel.
- Progress: store `sheetLoading: { loaded, total, checking } | null` (`src/store/index.ts`), shown as a thin
  bar at the bottom of the app bar (`data-testid="sheet-loading"`, `src/App.vue`): share of pages done,
  indeterminate once all pages are done while the check still runs, gone afterwards. The pencil is disabled
  until every page is done **and** the check returned without a block; the divider button waits for every
  page. Leaving the sheet sets `sheetLoading` to null and draws no further page.
- A resize starts a new run (counter `renderRun`; a newer run or leaving stops the old one before its next
  page): again page by page with the bar; the markup overlays of a page stay until that page is drawn again.
- Markers for tests: `canvas[data-page="<n>"][data-rendered]` per page done in the current run (integer
  pages), `#sheetViewerWrapper[data-sheet-loaded="true"]` once every page with its markup is done and the
  check returned (`SHEET_LOADED` in `tests/visual/electronDriver.ts`; removed while a run is going).
- `tests/visual/sheetLoading.visual.ts` (synthetic folders, no corpus needed, a heavy 40-page PDF with markup
  on page 1 and the last page): page 1 with its markup shows before the last page is done (bar in the app
  bar, pencil off), pages finish in order, a second open takes the check from `markup-write-check.json`
  (prepared with another result), an encrypted PDF shows its hint without a check (no cache file), leaving
  during the load (no console error, no dialog, `sheetLoading` null, the check's result remembered), a resize
  during the first load and during a redraw (every page again in order; the last page's old overlays stay
  until it is redrawn); every case checks the PDF stays byte-identical and no network request.

## Page divider

- Spec: `docs/superpowers/specs/2026-11-23-page-divider-design.md`. The page-turn view shows a page in two
  half steps; the divider decides where the page is cut. Per page turn n → n+1 it is a **ratio of page
  n+1's height** (key = the page on the left, default 0.5, range 0.05–0.95, 3 decimals; logic in
  `src/pageDivider.ts`).
- Stored in `.config.json` → `sheets["<path relative to the sheet folder, />"].pageDividers["<n>"]`
  (`sheetKey`/`pageDivider` in `src/folderConfig.ts`; tRPC `loadSheetSettings`/`savePageDivider` in
  `src/trcpLib.ts`): only values other than 0.5, empty levels are removed, written only on a real change.
  Never stored in the PDF.
- The cut is a CSS `clip-path` on the half-step copy of the page and on its markup overlays, plus the
  backdrop height (`dividers`, `applyCut`, `getSplitIndicatorStyle` in `src/views/SheetViewer.vue`).
- The app-bar button `mdi-arrow-split-horizontal` (`src/App.vue`) starts the divider mode (`dividerTurn`
  in `src/views/SheetViewer.vue`): each page turn shows its divider, which can be moved; the button
  becomes `mdi-check` and the app bar teal. The mode excludes the pencil mode.
- Failures: an unreadable `.config.json` (also one of a newer app) leaves every cut in the middle; the
  button stays enabled, a press keeps the mode off and shows the reason. A failed save shows a notice; the
  value holds until the sheet is closed. A sheet outside the sheet folder has no dividers and no mode
  (`loadSheetSettings` returns `outside`).
- `tests/visual/pageDivider.visual.ts` (synthetic folders, no corpus needed) checks the cut with and
  without a stored divider (page image, backdrop, red marks, after a resize) and the mode: a drag relative
  to the grab saves 3 decimals and leaves the PDF byte-identical, a press without movement, keys and
  clicks write nothing, restart and „Zur Mitte“, a broken `.config.json`, a failed save (read-only
  folder), a single-page PDF, the exclusion with the pencil.

## Zoom in edit mode

- Spec: `docs/superpowers/specs/2026-11-23-edit-zoom-design.md`. In pen mode the edit canvas zooms
  1–20× (`MIN_ZOOM`/`MAX_ZOOM`); view math in `src/markup/editZoom.ts` (`ZoomView` = zoom + offset,
  `zoomAt`, `panBy`, `pinchView`, `wheelZoomFactor`, `viewForWheel`, `viewToApply`, `viewCenter`). Zoom only
  goes through fabric's `viewportTransform`; the save path is unchanged (markup stays in PDF points). No zoom
  before the sharp page picture exists (`viewToApply`); back to the whole page always works.
- Input (`src/views/SheetViewer.vue`, mapping in `viewForWheel`): Ctrl+wheel (also a trackpad pinch) zooms
  around the pointer, the plain wheel pans, Shift+wheel pans sideways only (by deltaX, as Chromium delivers
  it on Windows, else by deltaY), only in pen mode. Two fingers pinch and pan. The edit-toolbar
  button `mdi-fit-to-page-outline` (`data-testid="zoom-fit"`) shows while zoomed and resets to the whole
  page. Zoom also resets on leaving edit mode and on resize.
- Gesture rules (`src/markup/editGestures.ts`, pure tracker; `src/markup/editTouchInput.ts` connects
  touch and pen events on `.canvas-container`, capture phase, to it): two touch pointers make a gesture;
  the pen never starts one and a pen stroke is never discarded; touches that land while the pen is down
  are ignored (blocked); the mouse never counts as a finger. Chromium on Windows delivers a pen on the
  page as pen pointer events plus touch events (no `touchType`): the touch that starts within 2 px and
  100 ms of a pen's pointerdown is the pen's, goes to fabric untouched and is never a finger. When the second finger lands, the first
  finger's input is discarded (stroke or drag undone) if it is younger than 300 ms
  (`DISCARD_WINDOW_MS`), otherwise it is ended and kept. That end is a synthetic touchend; the controls'
  mouse-up actions (delete, clone, edit text) ignore it (`isEndingFabricTouch`). A cancelled finger
  (`touchcancel`) ends fabric's input the same way. When one finger of a gesture lifts, the other stays
  blocked; a finger that lands beside it (no other finger, the pen neither down nor down meanwhile)
  resumes the pinch with it (`resume`, no fabric input to end).
- Sharp page: `src/markup/zoomPageRenderer.ts` draws the visible page area as a picture below
  `.canvas-container`, laid out with the same mapping as the saved markup (the edit canvas size). It
  renders about 200 ms after the last view change; a newer view cancels an older render.
- New symbols and texts are placed at the centre of the visible area (`viewCenter`). Object caching is off
  on the edit canvas, recursively for groups (a cached object turns blurry when zoomed); the global fabric
  config is untouched.
- `tests/visual/editZoom.visual.ts` (synthetic folders, no corpus needed) checks the zoom in edit mode
  (see the file for the cases).

## Symbol boxes on the edit canvas

- Music symbols are `FabricText` with font size 1 scaled ×50. fabric's box around them is far larger than the
  glyph (line height, the minimum text width of 2 units for combining marks like the accent „>“, and the
  default `strokeWidth` 1 although there is no stroke): the accent's box was ~150×106 px around a ~21×13 px
  glyph. `tightenIconBounds` (`src/markup/iconBounds.ts`, called on `object:added` of the edit canvas, so also
  for symbols saved before) measures the ink on a scratch canvas and gives the symbol a box around it plus
  `ICON_HIT_PADDING` (8 screen px) for hitting, border, controls and multi-selection. The glyph stays where it
  was. `toObject` restores fabric's own box (width, height, strokeWidth, left/top), so the saved markup is
  unchanged (older app versions, the PNG and the read-only overlay are unaffected). User texts (`__isText`)
  and `IText` are left alone.
- Unit tests: `tests/markup/iconBounds.test.ts` (fabric's node build, saved JSON identical, same pixels);
  `tests/visual/iconHitbox.visual.ts` checks the real app (a tap beside the glyph inside fabric's box does not
  grab it, one on the glyph does, saved box unchanged).
- Font: symbols use `fontFamily: "noto-icons"` (`MUSIC_FONT_FAMILY` in `src/models/markupConstants.ts`).
  `loadMarkupFonts` (`src/markup/renderPng.ts`) registers the bundled Noto Music under that name with the
  FontFace API, so old and new symbols draw with it (edit canvas, read-only overlay, PNG). Before 2026-11-25
  no font had that name and the system fallback was used (on Windows a different look, e.g. spaced „m f“);
  the old app still draws them that way, so `compare.visual.ts` can show differences on symbols. The
  `notoIcons` `@font-face` in `SheetViewer.vue` is only for the symbol dialog. Note names (CIS, F, …) are not
  in Noto Music and still use the default font.

## White pen

- The white pen (pen mode only, stroke `rgba(255,255,255,1)`) covers printed notes and always lies **below
  every other mark** (`src/markup/whiteout.ts`, pure): `whiteoutFirst` orders the objects when markup is
  shown or loaded for editing (`fabricJsonForDisplay`) and when the PNG is rendered (`renderMarkupPng`), so
  markup saved with white on top shows it below as well; a new white stroke (or clone) on the edit canvas is
  moved right above the other white ones (`whiteoutIndex`, `object:added`). Saving writes that order. White
  can no longer cover the user's own marks (delete those instead).
- Pen sizes: `PEN_SIZES` in `src/views/SheetViewer.vue` (1, 6, 18 canvas px; the first is the default).
- `tests/markup/whiteout.test.ts`, `tests/visual/whitePen.visual.ts` (new white stroke across a black one,
  markup saved with white on top; edit mode, view, saved order).

## Favoriten

- Spec: `docs/superpowers/specs/2026-11-25-favorites-design.md`. A sheet is marked as a favorite in the
  viewer (app-bar heart `data-testid="favorite-current"`, `src/App.vue`) or on its card in the folder view
  and the search results (`data-testid="favorite-toggle"`, `@click.stop`, `src/views/SheetSelection.vue`);
  the main page (`src/views/Overview.vue`) lists them below the two cards under „Favoriten“
  (`data-testid="favorite-card"`, name and folder, sorted by name then folder, German, ignoring case; a click
  opens the sheet, the heart unmarks and removes the card; none: „Noch keine Favoriten. Markiere Blätter mit
  dem Herz.“; an unreadable `.config.json`, also one of a newer app: the reason instead, the other cards work).
  Icons `mdi-heart` / `mdi-heart-outline`.
- Stored in `.config.json` → `sheets["<sheetKey>"].favorite: true` (unmarking removes the field) next to
  `pageDividers`, plus `fingerprint: { sha256, length }`; never in the PDF. Every write of an entry (favorite,
  divider) stores the PDF's current fingerprint (an unreadable PDF is saved without, a stored one stays; a
  stored one with the same sha256 and length is kept as it is, unknown fields included); an entry left with
  only `fingerprint` is removed. Opening and saving use the key spelled as on disk (`diskSpelling`: each part
  as listed, else the single name differing only in case, taken only when both spellings reach the same
  file), so a set list with an older spelling (Windows, case-only rename) finds the entry. Main:
  `src/sheetSettings.ts` (`loadSheetSettings`, `saveSheetSetting`, `loadFavorites`, `loadFavoriteKeys`,
  `relinkMissingFavorites`, `findMoveSource`, `diskSpelling`), tRPC in `src/trcpLib.ts`/`src/trcpRouter.ts`;
  renderer store `src/store/favorites.ts` (optimistic, saves serialized per sheet by `src/favoriteSaves.ts`,
  the last press counts, a failure reverts and shows a notice; keys and list remember their sheet folder and
  are dropped before a view renders another folder, `forgetOtherFolder`). Folder-view hearts look up
  `keySet` with keys built once per listing (`folderCardKey`, search results via `rendererSheetKey`).
- Fingerprint (`src/pdfFingerprint.ts`, fixed definition): SHA-256 (hex, lowercase) and length of the first
  *n* bytes, *n* from the last `/OriginalLength n … /UpdateStart m` with `%%EOF` before *n* and
  `n ≤ m ≤ length`, else the whole file (saving our markup does not change it); cached per real path by size
  and mtime.
- Move rules (all settings of the entry follow, not set lists): an entry is an **orphan** when it has a
  fingerprint and `stat` reports its PDF missing (`ENOENT`/`ENOTDIR`; any other error, an unreachable sheet
  folder or a missing PDF behind an offline link counts as unknown, nothing moves). It moves from A to B when
  A is an orphan, B exists without an entry of its own, B's fingerprint equals A's and no other orphan has it
  (a copy, whose original is still there, gets nothing); or when A is B renamed only in case (same file, A's
  spelling no longer listed). The move is a write like any other (rules checked again on the fresh file).
  When: on every write of an entry without its own entry (first move, then the requested state: the UI sends
  the wanted state, not a toggle), on opening a sheet without an entry (the PDF is read only when there are
  orphans), and from the main page for missing favorites (background search `relinkMissingFavorites` over
  `walkSheetPdfs`: same file name first, then same folder, then the rest; each missing favorite searched
  completely at most once per app run; a walk that skipped a folder or link, or an unreadable PDF, counts as
  incomplete and is searched again). The folder view never moves (a moved favorite shows an empty heart until
  opened or pressed). Opening a sheet, the folder view or the main page without a change never writes
  `.config.json`; a missing favorite keeps its mark and gets no card until its PDF is back. Once it is **not
  found** (no fingerprint, or searched completely in this run without a hit; `loadFavorites` → `notFound`,
  `relinkMissingFavorites` → `searched`, the main page reloads after such a search) the main page lists it under
  „N Favoriten nicht gefunden“ (collapsed, „Anzeigen“) with „Entfernen“ / „Alle entfernen“, which unmark it like
  the heart (dividers stay with the fingerprint); a missing PDF behind an unreachable link is never listed.
- Tests: `tests/sheetSettings.test.ts`, `tests/pdfFingerprint.test.ts`, `tests/favoritesIpc.test.ts`,
  `tests/favoriteSaves.test.ts`, `tests/favoriteKey.test.ts`; `tests/visual/favorites.visual.ts` (synthetic
  folders, no corpus needed): marking in the viewer and on cards (also search results), a card's heart never
  opens the sheet, quick presses, opening without a change writes nothing, an unreadable `.config.json`, a
  moved favorite on open, the main page (sorted cards open the sheet, the hint, unmarking, a moved and a
  renamed favorite found by the background search with the new keys in the file, a missing favorite hidden and
  back, favorites not found listed and removed („Entfernen“, „Alle entfernen“), a copy is no favorite, the reason for an unreadable file); every case checks the PDFs stay
  byte-identical.

## Auto-Update

- Uses `update-electron-app` which points at GitHub Releases via `update.electronjs.org`
- Disabled in dev (`!app.isPackaged`); configured in `src/main.ts` with `repo: "sebbi08/sheet-music-viewer"`
- Update events exposed to renderer via tRPC subscriptions in `src/trcpRouter.ts`
- `electron-squirrel-startup` handles Windows install/uninstall shortcuts in `src/main.ts`

## Release Process

- **Manual only**: pushes to `master` do **not** create a release. Run the `release` workflow
  (`.github/workflows/release.yml`) via Actions → "Run workflow" on `master`
  (or `gh workflow run release.yml --ref master`)
- The `release` job runs semantic-release: analyzes all commits since the last tag, bumps the
  version, updates `CHANGELOG.md`, creates the `v*` tag and **GitHub Release**, and commits back
  with `[skip ci]`. It fails if there is nothing to release (no feat/fix/breaking commits)
- The `publish` job then checks out that tag and uploads build artifacts (Windows) to the GitHub
  Release via `@electron-forge/publisher-github`
- `build.yml` (push to `master`/`renovate/**`, PRs) builds (`build` job) and runs `npm run lint` and
  `npm test` (`test` job, unit tests only; the `Noten/` cases skip); it never publishes. The visual tests
  do not run in CI (they need the local corpus and take about half an hour)
- `test-build.yml` (manual, any branch): Windows test build uploaded as workflow artifacts only
  (installer + portable ZIP); no tag, no GitHub Release, so auto-update and semantic-release ignore it
- Locally, `npm run semantic-release` runs `semantic-release --no-ci`; needs `GH_TOKEN`
  (or `GITHUB_TOKEN`) in the environment
- Only `master` branch is used

## Key Dependencies

- `fabric` (canvas manipulation), `pdfjs-dist` (PDF rendering)
- `pdf-lib` (1.17.1, exact pin) to parse and serialize PDF objects for the markup update; the
  incremental writer is our own (`src/pdfMarkup/incrementalWriter.ts`), pdf-lib never re-saves a file
- `lodash`, `fs-extra`, `glob`, `zod`, `superjson`
- `semantic-release` plugins: commit-analyzer, release-notes-generator, npm (publish disabled), changelog, git, github
- `@electron-forge/publisher-github` for publishing artifacts to GitHub Releases

## Commit Convention

- Follows [Conventional Commits](https://www.conventionalcommits.org/) for semantic-release
- Enforced via `commitlint` on `commit-msg` hook (managed by `simple-git-hooks`)
- Format: `<type>[(scope)]: <description>` — types: feat, fix, chore, docs, refactor, etc.

## Notes

- The `Noten/` folder (local sheet music data) and `.env` are gitignored
- The publisher TS file lives in `publisher/` and is compiled separately (not part of the main tsconfig)
- Windows-only Squirrel maker; ZIP for macOS; RPM/DEB for Linux
- `opencode.json` has nothing besides MCP chrome-devtools config
