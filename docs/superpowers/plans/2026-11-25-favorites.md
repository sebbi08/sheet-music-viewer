# Favorites and move-proof sheet settings – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sheets can be marked as favorites (viewer, folder view, main page), stored in `.config.json`, and every
per-sheet entry (favorite, page dividers) follows a moved or renamed PDF via a content fingerprint.

**Architecture:** Main process: a fingerprint module (pure byte search + SHA-256), `folderConfig.ts` learns the
new fields and a "patch computed from the fresh state" write, and a new `sheetSettings.ts` holds the move rules
and the operations behind new tRPC procedures. Renderer: a small Pinia store for favorites, a heart in the app
bar, on sheet cards and a favorites section on the main page.

**Tech Stack:** Electron main (Node, zod, `node:crypto`), tRPC (`electron-trpc`), Vue 3 + Vuetify 4 + Pinia,
vitest (unit), Playwright `_electron` (visual, headless).

**Spec:** `docs/superpowers/specs/2026-11-25-favorites-design.md` (German). Read it before any task; section
names below refer to it.

## Global Constraints

- Main-process modules have **no Electron imports** and are unit-tested in Node.
- `.config.json` rules from `src/folderConfig.ts`: read fresh, change only the own part, atomic write with
  read-back, **no write without a real change**, `unreadable` never overwritten, unknown fields kept,
  `version` stays `1`.
- Opening a sheet, the folder view or the main page **without a change never writes** `.config.json`. Writes
  happen only on mark/unmark, divider save, and an entry move.
- No PDF ever changes (not one byte).
- Keys are `sheetKey(folder, pdfPath)` (path relative to the sheet folder, `/`-separated, exact spelling).
- Fingerprint definition is fixed (spec „Fingerabdruck“): last match of `/OriginalLength <n> … /UpdateStart <m>`
  with `isValidSectionEnd(bytes, n)` and `n ≤ m ≤ length`, else whole file; SHA-256 hex lowercase + length.
- User-facing texts in German; icons `mdi-heart` (favorite) / `mdi-heart-outline` (not); main page heading
  „Favoriten“, empty hint „Noch keine Favoriten. Markiere Blätter mit dem Herz.“
- Visual tests headless, synthetic folders below `test-results/visual/work/`, never inside `Noten/`.
- Conventional Commits (`feat:`, `test:`, `docs:`); commit only with the user's go-ahead for this plan.

## Review Focus

1. **Sheet folder unreachable or `stat` fails with anything but ENOENT/ENOTDIR** → nothing counts as orphaned,
   nothing moves, nothing is written, no favorite disappears from the config. (Task 3 test.)
2. **Two quick presses on the same heart** → the saved state and the shown heart equal the last press.
   (Task 6 visual test.)
3. **A favorite whose PDF was deleted for good** → the main page does not re-hash the whole folder on every
   visit (once per app run). (Task 3 test.)
4. **Another PC changed `.config.json` meanwhile** (different sheet favorited) → a write keeps it. (Task 2 test.)
5. **PDF locked/unreadable when toggling** → favorite still saved; an existing fingerprint stays. (Task 3 test.)

---

### Task 1: Fingerprint of a PDF

**Files:**
- Create: `src/pdfFingerprint.ts`
- Test: `tests/pdfFingerprint.test.ts`

**Interfaces:**
- Consumes: `isValidSectionEnd(bytes, length)` from `src/pdfMarkup/fileStructure.ts`.
- Produces:
  - `export interface Fingerprint { sha256: string; length: number }`
  - `export function originalLength(bytes: Uint8Array): number`
  - `export function fingerprintOf(bytes: Uint8Array): Fingerprint`
  - `export async function fingerprintFile(file: string): Promise<Fingerprint>` (throws on I/O errors)
  - `export function clearFingerprintCache(): void` (tests)

- [ ] **Step 1: Write the failing tests** (`tests/pdfFingerprint.test.ts`, use `makePdf` from
  `tests/pdfMarkup/fixtures` and `saveMarkupToFile` from `src/pdfMarkup/markupFile` on temp files):
  - `"a PDF without our markup: the whole file"` → `originalLength(bytes) === bytes.length`, `fingerprintOf`
    equals `{ sha256: createHash("sha256").update(bytes).digest("hex"), length: bytes.length }`.
  - `"saving markup keeps the fingerprint"` → fingerprint before save === after first save === after a second
    save with different markup; `originalLength(after) === before.length`.
  - `"an update of another program that keeps our metadata keeps it"` → after a markup save, append
    `"\n99 0 obj\n<< /OriginalLength " + n + " /UpdateStart " + m + " >>\nendobj\n%%EOF\n"` (n/m from the
    saved file's metadata); fingerprint unchanged.
  - `"an invalid OriginalLength is ignored"` → bytes of a plain PDF plus appended
    `"<< /OriginalLength 7 /UpdateStart 9 >>"` (no `%%EOF` before 7) → whole file.
  - `"the last valid match wins"` → two appended valid metadata blocks, expect the later one's `n`.
  - `"different PDFs differ"` → `makePdf({ pages: 1 })` vs `makePdf({ pages: 2 })`.
  - `"fingerprintFile caches by real path, size and mtime"` → spy on `fs.promises.readFile` (or count reads via
    a wrapper): two calls read once; after rewriting the file with other bytes the result changes.

- [ ] **Step 2: Run** `npx vitest run tests/pdfFingerprint.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/pdfFingerprint.ts`: latin1 regex over the bytes
  `/\/OriginalLength\s+(\d+)\s*\/UpdateStart\s+(\d+)/g`, iterate all matches, keep the last that passes the
  rules; hash with `node:crypto`. `fingerprintFile`: `fs.promises.stat` + `realpath`, cache
  `Map<realpath, {size, mtimeMs, fingerprint}>`, then `readFile` and `fingerprintOf`.

- [ ] **Step 4: Run** the test file → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit** `feat: fingerprint of a PDF's original bytes`.

---

### Task 2: `.config.json` learns favorite, fingerprint and entry moves

**Files:**
- Modify: `src/folderConfig.ts` (schema ~l.28-37, `FolderConfigPatch` ~l.71-76, `updateFolderConfig` ~l.332-363,
  next to `applyPageDivider`)
- Test: `tests/folderConfig.test.ts` (new `describe("sheet entries")`)

**Interfaces:**
- Consumes: `Fingerprint` (Task 1).
- Produces:
  - Schema: sheet entry gets `favorite: z.boolean().optional()` and
    `fingerprint: z.object({ sha256: z.string(), length: z.number() }).loose().optional()`.
  - `export type SheetEntry = NonNullable<FolderConfig["sheets"]>[string]`
  - `FolderConfigPatch.sheet?: { key: string; moveFrom?: string; favorite?: boolean; fingerprint?: Fingerprint }`
  - `updateFolderConfig(folder, patch: FolderConfigPatch | ((current: FolderConfig | null) => Promise<FolderConfigPatch | null> | FolderConfigPatch | null), options?)`
    — a function is called inside the serialized step with the freshly read config (`null` = missing file);
    returning `null` writes nothing.
  - Apply order for one write: `sheet.moveFrom` (rename the key `moveFrom` → `key`, entry unchanged; only if
    `moveFrom` exists and `key` has no entry, otherwise ignored) → `pageDivider` → `sheet.favorite` (`true`
    sets, `false` deletes the field) → `sheet.fingerprint` (set only on an entry that exists at this point) →
    cleanup: an entry whose keys are a subset of `{fingerprint}` is removed, then an empty `sheets`.

- [ ] **Step 1: Write the failing tests:**
  - `"favorite true is stored and false removes the field"`
  - `"an entry left with only a fingerprint is removed, one with an unknown field stays"`
  - `"a fingerprint is stored only next to a setting"` (patch with only `fingerprint` on a key without entry
    → no write, file unchanged).
  - `"moveFrom moves the whole entry"` (favorite + dividers + fingerprint + unknown field under the new key, old
    key gone) and `"moveFrom is ignored when the target has an entry"`.
  - `"a patch function sees the fresh state; null writes nothing"` (mtime unchanged).
  - `"a favorite write keeps another sheet's favorite written meanwhile"` (write file with sheet X favorite
    between two calls; after favoriting Y both are present). *(Review Focus 4)*
  - `"favorite of the wrong type makes the file unreadable"` (`"favorite": "yes"` → `loadFolderConfig` kind
    `unreadable`).

- [ ] **Step 2: Run** `npx vitest run tests/folderConfig.test.ts` → new tests FAIL.

- [ ] **Step 3: Implement** the schema, patch type and `applySheetPatch(merged, patch.sheet)` beside
  `applyPageDivider`; resolve a function patch after `readDisk` inside `serialized`, with
  `state.kind === "ok" | "legacy" ? state.config : null`.

- [ ] **Step 4: Run** the file → PASS (old tests unchanged).

- [ ] **Step 5: Commit** `feat: favorite, fingerprint and entry moves in .config.json`.

---

### Task 3: Move rules and sheet-setting operations (main)

**Files:**
- Create: `src/sheetSettings.ts`
- Modify: `src/sheetFiles.ts` (add `listSheetPdfs`)
- Test: `tests/sheetSettings.test.ts`, `tests/sheetFiles.test.ts` (one test for `listSheetPdfs`)

**Interfaces:**
- Consumes: Task 1, Task 2, `sheetKey`, `loadFolderConfig`, `FolderConfigUnreadableError`, `PageDividers`
  (`src/pageDivider.ts`).
- Produces:
  - `export async function listSheetPdfs(root: string): Promise<{ key: string; file: string }[]>` — like the
    sheet list: recursive, hidden entries skipped, links followed, every real folder and real PDF once (first
    way in `localeCompare(…, "de")` order); unreadable folders skipped silently.
  - `export type PathState = "exists" | "missing" | "unknown"`; `export async function pathState(file: string): Promise<PathState>` (missing only for ENOENT/ENOTDIR).
  - `export async function findMoveSource(folder: string, sheets: Record<string, SheetEntry>, target: string, targetFingerprint: () => Promise<Fingerprint | null>): Promise<string | null>` — rules of spec „Umzug eines Eintrags“, in this order: target has an entry → null; folder not a reachable directory → null; case-only rename (keys equal ignoring case, `stat` of both gives same `dev`+`ino`, old basename not in `readdir` of its folder) → that key; orphans = entries with `fingerprint` whose `pathState` is `missing`; none → null **without calling `targetFingerprint`**; exactly one orphan with equal `sha256`+`length` → its key; else null.
  - `export type LoadSheetSettingsResult = { kind: "ok"; dividers: PageDividers; favorite: boolean } | { kind: "unreadable"; file: string; message: string; newerVersion?: true } | { kind: "outside" }`
  - `export async function loadSheetSettings(input: { folder: string; pdfPath: string }): Promise<LoadSheetSettingsResult>` — never throws; moves on open (spec case 1) via a function patch; a failed move write is logged and the entry read without it.
  - `export type SheetSettingChange = { favorite: boolean } | { page: number; ratio: number | null }`
  - `export async function saveSheetSetting(input: { folder: string; pdfPath: string; change: SheetSettingChange }): Promise<{ ok: true } | { ok: false; message: string }>` — fingerprint first (`null` on error), then one function patch: `moveFrom` from `findMoveSource` when the key has no entry (spec case 0), the change, `fingerprint` if computed. Messages as `savePageDivider` builds them today.
  - `export interface FavoriteSheet { key: string; pdfPath: string; name: string; dir: string }` (`name` without `.pdf`, `dir` = `/`-separated folder, `""` on top level)
  - `export type LoadFavoritesResult = { kind: "ok"; favorites: FavoriteSheet[]; missing: number } | { kind: "unreadable"; file: string; message: string; newerVersion?: true }`
  - `export async function loadFavorites(folder: string): Promise<LoadFavoritesResult>` — `exists` and `unknown` shown, `missing` counted; sort `name` with `localeCompare(…, "de", { sensitivity: "base" })`, then `dir`.
  - `export async function loadFavoriteKeys(folder: string): Promise<{ kind: "ok"; keys: string[] } | { kind: "unreadable"; file: string; message: string; newerVersion?: true }>` — no `stat`, no PDF reads.
  - `export async function relinkMissingFavorites(folder: string): Promise<{ moved: number }>` — spec case 2; candidates from `listSheetPdfs` without own entry, ordered same basename → same folder → rest, skipping files smaller than `fingerprint.length`; each favorite key searched at most once per process (module `Set` of `folder + "\0" + key`); the move itself through a function patch that re-runs `findMoveSource`; never throws.

- [ ] **Step 1: Write the failing tests** (temp folders, real files from `makePdf`):
  - `"a moved PDF takes its entry on open"` (favorite+dividers at `A/a.pdf` with fingerprint, file moved to
    `B/a.pdf` → `loadSheetSettings(B)` returns them, config key is `B/a.pdf`).
  - `"open without an orphan reads no PDF and writes nothing"` (spy `fingerprintFile`; mtime of config
    unchanged).
  - `"a copy gets nothing"` (old path still exists) and `"two orphans with the same fingerprint: nothing"`.
  - `"the target's own entry wins"`.
  - `"stat errors other than ENOENT and an unreachable folder move nothing"` (mock `fs.promises.stat` to throw
    `EACCES` for the old path; folder path pointing at a missing drive dir). *(Review Focus 1)*
  - `"a case-only rename moves the entry"` — `test.skipIf(!caseInsensitiveFs)` where the helper probes the
    temp dir.
  - `"saving a favorite on a moved PDF moves first and keeps the requested state"` (old entry `favorite: true`;
    `saveSheetSetting(new, { favorite: true })` → one entry at the new key, favorite true, dividers kept).
  - `"a locked PDF: the favorite is saved, an old fingerprint stays"` (mock `fingerprintFile` to reject).
    *(Review Focus 5)*
  - `"saving a divider stores the fingerprint"`.
  - `"loadFavorites: sorted, missing ones counted, not shown, mark kept"`; `"unknown stat shows the card"`.
  - `"relinkMissingFavorites finds a renamed PDF in the same folder and a moved one elsewhere"`.
  - `"relinkMissingFavorites searches a deleted favorite once per run"` (second call: no `fingerprintFile`
    calls). *(Review Focus 3)*
  - `listSheetPdfs`: hidden skipped, link to a folder followed once, keys `/`-separated.

- [ ] **Step 2: Run** `npx vitest run tests/sheetSettings.test.ts tests/sheetFiles.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/sheetSettings.ts` and `listSheetPdfs`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat: sheet settings follow a moved PDF`.

---

### Task 4: tRPC procedures

**Files:**
- Modify: `src/trcpLib.ts` (~l.160-225: replace `loadPageDividers`, `savePageDivider` delegates to
  `saveSheetSetting`), `src/trcpRouter.ts` (~l.125-131)
- Modify: `tests/pageDividerIpc.test.ts` (calls `loadSheetSettings`; ok results gain `favorite: false`)
- Test: `tests/favoritesIpc.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces (router keys and zod inputs; `absoluteFolderSchema`, `pdfPathSchema`, `isInsideFolder` as used today):
  - `loadSheetSettings` (query, input `pageDividersInputSchema` renamed `sheetInputSchema`) → `LoadSheetSettingsResult`
  - `savePageDivider` (mutation, unchanged input) → unchanged result
  - `setFavorite` (mutation, input `{ folder, pdfPath, favorite: boolean }` with the inside-folder refine) → `{ ok: true } | { ok: false; message: string }`
  - `loadFavorites` (query, input `absoluteFolderSchema`) → `LoadFavoritesResult`
  - `loadFavoriteKeys` (query, input `absoluteFolderSchema`)
  - `relinkMissingFavorites` (mutation, input `absoluteFolderSchema`) → `{ moved: number }`

- [ ] **Step 1: Write the failing tests** in `tests/favoritesIpc.test.ts` (same Electron mock as
  `pageDividerIpc.test.ts`): `"setFavorite then loadFavorites and loadSheetSettings show it"`,
  `"setFavorite rejects a PDF outside the folder"`, `"an unreadable file: setFavorite fails with the reason and
  writes nothing"`; adapt `pageDividerIpc.test.ts`.
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement** the procedures (thin wrappers).
- [ ] **Step 4: Run** `npm test` → all PASS; `npm run lint`.
- [ ] **Step 5: Commit** `feat: favorites over tRPC`.

---

### Task 5: Renderer store and key helper

**Files:**
- Create: `src/favoriteKey.ts`, `src/store/favorites.ts`, `src/store/favoriteTexts.ts`
- Test: `tests/favoriteKey.test.ts`

**Interfaces:**
- Consumes: Task 4 procedures via `client` (`src/trcpClient.ts`), `notices` store (`src/store/notices.ts`),
  `useStore().sheetMusicFolder`.
- Produces:
  - `export function rendererSheetKey(folder: string, pdfPath: string, p: { relative(a: string, b: string): string; sep: string } = window.path): string | null` — same result as `sheetKey` for paths below the folder, `null` otherwise.
  - `useFavorites` (Pinia id `"favorites"`): state `keys: string[]`, `keysError: string | null`,
    `list: FavoriteSheet[]`, `listError: string | null`, `current: { pdfPath: string; state: "ok" | "outside" | "unreadable"; favorite: boolean; error: string | null } | null`;
    actions `loadKeys(): Promise<void>`, `loadList(): Promise<void>` (loads, then `relinkMissingFavorites` and
    reloads if `moved > 0`), `setCurrent(pdfPath: string, result: LoadSheetSettingsResult): void`,
    `isFavorite(pdfPath: string): boolean`, `set(pdfPath: string, favorite: boolean): Promise<void>` —
    optimistic update of `keys`/`list`/`current`, saves serialized per key (last press wins), on failure
    reverts and shows `favoriteSaveFailedText(message)`.
  - `src/store/favoriteTexts.ts`: `favoriteSaveFailedText(message: string): string` („Der Favorit konnte nicht
    gespeichert werden: …“), `favoritesUnreadableText(file: string, message: string, newerVersion: boolean): string`
    (wording like `setListsUnreadableText`/`setListsNewerVersionText` in `src/store/setListTexts.ts`).

- [ ] **Step 1: Write the failing tests** `tests/favoriteKey.test.ts` with `path.win32` and `path.posix` passed
  as `p`: below the folder → `"Pop/Abba Gold.pdf"`; the folder itself, `..`, other drive → `null`; equals
  `sheetKey` for a set of paths.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** helper, texts and store. **Step 4: Run** `npm test`, lint → PASS.
- [ ] **Step 5: Commit** `feat: favorites store`.

---

### Task 6: Heart in the viewer and in the folder view

**Files:**
- Modify: `src/views/SheetViewer.vue` (`loadDividers` ~l.423 → `client.loadSheetSettings`, then
  `favorites.setCurrent(sheetPath, result)`; type alias ~l.209), `src/App.vue` (button next to the `mdi-plus`
  dialog, ~l.53), `src/views/SheetSelection.vue` (card template, `loadPath`, search watch)
- Test: `tests/visual/favorites.visual.ts` (new; helpers local to the file, using `launchApp` from
  `tests/visual/electronDriver.ts` and router pushes as `openSheet` does)

**Interfaces:**
- Consumes: Task 5 store.
- Produces (selectors used by the visual tests): app-bar button `data-testid="favorite-current"`; card button
  `data-testid="favorite-toggle"`; card root keeps `v-card`, the name stays in `.itemName`.

- [ ] **Step 1: Write the failing visual tests:**
  - `"mark in the viewer, heart shows in the folder view and in search results"` (config has
    `sheets["a.pdf"].favorite === true` and a `fingerprint`; folder card icon `mdi-heart`; search result for
    `"a"` also `mdi-heart`).
  - `"unmark on the card does not open the sheet"` (route stays `SheetSelection`, field removed).
  - `"two quick presses: the last one counts"` *(Review Focus 2)*.
  - `"opening a sheet without a change writes nothing"` (config mtime and bytes unchanged; PDF byte-identical).
  - `"unreadable .config.json: no hearts on cards; the viewer button shows the reason and writes nothing"`.
  - `"a moved favorite: its card shows an empty heart until opened, then it is a favorite"`.
- [ ] **Step 2: Run** `npx vitest run -c vitest.visual.config.mts tests/visual/favorites.visual.ts` → FAIL.
- [ ] **Step 3: Implement**: viewer button (icon by `current.favorite`, disabled when `state === "outside"`,
  press with `unreadable` shows `current.error` via `notices`, else `set`); card heart only for
  `item.isFile`, `@click.stop`, pdfPath built like `selectItem`; `loadKeys()` in `onMounted`, on route change
  and when search results change.
- [ ] **Step 4: Run** the visual file and `tests/visual/pageDivider.visual.ts` → PASS.
- [ ] **Step 5: Commit** `feat: mark favorites in the viewer and the folder view`.

---

### Task 7: Favorites on the main page, docs

**Files:**
- Modify: `src/views/Overview.vue`, `AGENTS.md` (section „Favoriten“ + visual test list),
  `docs/superpowers/specs/2026-11-23-page-divider-design.md` (non-goal „folgen einer verschobenen PDF“ marked
  as lifted by the favorites spec)
- Test: `tests/visual/favorites.visual.ts` (extend)

**Interfaces:**
- Consumes: Task 5 (`loadList`, `list`, `listError`, `set`).
- Produces: favorite card `data-testid="favorite-card"`, its heart `data-testid="favorite-toggle"`.

- [ ] **Step 1: Write the failing visual tests:**
  - `"the main page shows favorites sorted, a click opens the sheet"`.
  - `"no favorites: the hint"` (exact text from Global Constraints).
  - `"unmark on the main page removes the card"`.
  - `"a moved and a renamed favorite show at their new place; the config has the new keys"`.
  - `"a missing favorite is hidden, its mark stays; back in place it shows again"`.
  - `"a copy of a favorite is no favorite"`.
  - `"unreadable .config.json: the reason instead of favorites, other cards work"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the section (cards in the existing card style; name, `dir`
  below; heart `@click.stop`). **Step 4: Run** the visual file, `folderConfig.visual.ts`, `npm test`, lint → PASS.
- [ ] **Step 5: Commit** `feat: favorites on the main page`, then `docs: favorites` for AGENTS.md and the spec note.
