# Nicht gefundene Favoriten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The main page lists favorites whose PDF is gone (after this run's search found nothing) and lets the user remove them, which also ends their search on every start.

**Architecture:** Main: `loadFavorites` returns the not-found favorites instead of a count; `relinkMissingFavorites` also reports how many favorites it searched completely without a hit. Renderer: the favorites store keeps `notFound`, reloads after a search that completed any, and `Overview.vue` shows a collapsible line; removing goes through the existing `favorites.set(pdfPath, false, true)`.

**Tech Stack:** TypeScript, Vue 3 + Vuetify 4, Pinia, tRPC, vitest, Playwright `_electron` (headless).

**Spec:** `docs/superpowers/specs/2026-11-25-favorites-design.md`, section „Nachtrag: nicht gefundene Favoriten“.

## Global Constraints

- Not found = PDF `stat` says missing (`pathState(...) === "missing"`; behind an unreachable link it is "unknown" and does not count) **and** (no `fingerprint` **or** searched completely in this process, i.e. `searchedFavorites` holds `folder + "\0" + key`).
- Texts verbatim: `1 Favorit nicht gefunden`, `N Favoriten nicht gefunden` (N ≥ 2), buttons `Anzeigen` / `Ausblenden`, `Entfernen`, `Alle entfernen`. A list entry reads `<name> – <dir>` (en dash; only `<name>` when `dir` is `""`).
- List sorted like the cards (`byName` on name, then dir).
- Removing never writes anything new: it is `favorites.set(pdfPath, false, true)` (the entry keeps `pageDividers` with its fingerprint; an entry left with only `fingerprint` is removed, as before).
- The hint „Noch keine Favoriten. Markiere Blätter mit dem Herz.“ shows only when there are neither cards nor not-found favorites.
- `loadFavorites` never writes and never reads a PDF; opening the main page without a press never writes `.config.json`.
- GUI tests headless only (no visible windows). Never touch `Noten/`.

## Review Focus

- A favorite without fingerprint whose PDF is missing: listed at once (it can never be found) — unit test in Task 1.
- A missing PDF behind an offline link: never listed — covered by the existing `pathState` "unknown" path; Task 1 asserts `notFound: []` in the existing offline-link test.
- A removal that fails to save: the entry comes back (store `apply` with `revert` reloads the list) and a notice shows — Task 2 store wiring; the existing save-failure path is reused.
- A folder change while the line is open: the line of the previous folder never shows — `forgetOtherFolder` clears `notFound` with `list` (Task 2).
- Search cut short (unreadable folder, locked PDF): not listed until a complete search — unit test in Task 1.

---

### Task 1: Main process — not-found list and search report

**Files:**
- Modify: `src/sheetSettings.ts` (`LoadFavoritesResult`, `loadFavorites`, `relinkMissingFavorites`)
- Test: `tests/sheetSettings.test.ts`, `tests/favoritesIpc.test.ts` (update expectations only)

**Interfaces:**
- Produces: `LoadFavoritesResult` ok-branch `{ kind: "ok"; favorites: FavoriteSheet[]; notFound: FavoriteSheet[] }` (field `missing` removed); `relinkMissingFavorites(folder): Promise<{ moved: number; searched: number }>` where `searched` = favorites newly recorded as searched completely by this call (found-and-moved ones are not counted).

- [ ] **Step 1: Update and add tests in `tests/sheetSettings.test.ts`**
  - Rename „loadFavorites: sorted, missing ones counted, not shown, mark kept“ to „loadFavorites: sorted; a missing one without fingerprint is not found at once, one with fingerprint only after its search“. Keep its fixture, add `"Pop/Old.pdf": { favorite: true }` (no PDF, no fingerprint). Expect `notFound: [{ key: "Pop/Old.pdf", pdfPath: full("Pop/Old.pdf"), name: "Old", dir: "Pop" }]` (Zebra not yet: it has a fingerprint and was not searched). Then `await relinkMissingFavorites(dir)` → `{ moved: 0, searched: 1 }`, and `loadFavorites` → `notFound` holds `Pop/Old.pdf` then `Zebra.pdf` (`name: "Zebra", dir: ""`), in that order (byName: "Old" < "Zebra").
  - Every other `missing: 0` → `notFound: []`; every `{ moved: N }` → `{ moved: N, searched: S }` with S: renamed/moved test `0`; „searches a deleted favorite once per run“ `1` then `0`; „cut short by an error“ `0` then `1`; „walk that skipped an unreadable folder“ `0`, `0`, `1`, `0`; „same name first…“ `1`; the offline-link test `0`.
  - New test „a search cut short is not listed as not found“: config `"A/gone.pdf": { favorite: true, fingerprint: { sha256: "0".repeat(64), length: 10 } }`, `writePdf("B/other.pdf", pdfB)`, `fingerprintMock.mockRejectedValueOnce(errorWithCode("EBUSY"))`; after relink `loadFavorites` → `notFound: []`; after a second relink → `notFound` has `A/gone.pdf`.
  - In `tests/favoritesIpc.test.ts` replace any `missing` expectation by `notFound: []`.

- [ ] **Step 2: Run** `npx vitest run tests/sheetSettings.test.ts tests/favoritesIpc.test.ts` — expected: the changed tests FAIL (`missing` present, `searched` absent).

- [ ] **Step 3: Implement in `src/sheetSettings.ts`**
  - `loadFavorites`: a missing favorite goes into `notFound` (same `FavoriteSheet` shape as the cards) when `sheets[key].fingerprint === undefined || searchedFavorites.has(\`${folder}\0${key}\`)`; otherwise it is skipped as now. Sort `notFound` like `favorites`. Move the `searchedFavorites` declaration above `loadFavorites` if needed. Update the doc comment.
  - `relinkMissingFavorites`: count `searched` where `searchedFavorites.add` runs, only for keys not moved; return it in every return path (`{ moved, searched }`).

- [ ] **Step 4: Run** `npx vitest run tests/sheetSettings.test.ts tests/favoritesIpc.test.ts` — PASS; then `npm test` — all pass (TS errors in the renderer surface in Task 2's `vue-tsc`/lint, not here).

- [ ] **Step 5: Commit** `feat: report favorites not found after the search`

### Task 2: Renderer — store, main page line, visual test, docs

**Files:**
- Modify: `src/store/favorites.ts`, `src/store/favoriteTexts.ts`, `src/views/Overview.vue`, `AGENTS.md` (section „Favoriten“)
- Test: `tests/favoriteTexts.test.ts` (create), `tests/visual/favorites.visual.ts`

**Interfaces:**
- Consumes: Task 1's `notFound` and `searched`.
- Produces: store state `notFound: FavoriteSheet[]`; `favoritesNotFoundText(n: number): string` in `src/store/favoriteTexts.ts`; test ids `favorites-not-found` (the line), `favorites-not-found-toggle` (Anzeigen/Ausblenden), `favorite-not-found` (one entry, text `<name> – <dir>`), `favorite-not-found-remove` (its Entfernen), `favorites-not-found-remove-all`.

- [ ] **Step 1: Unit test** `favoritesNotFoundText(1) === "1 Favorit nicht gefunden"`, `favoritesNotFoundText(3) === "3 Favoriten nicht gefunden"`.

- [ ] **Step 2: Visual test** in `tests/visual/favorites.visual.ts`, new test „favorites not found are listed after the search; Entfernen and Alle entfernen unmark them“:
  - Folder with `b.pdf` (pdfB). Config: `"a.pdf": { favorite: true, pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfA) }` (no `a.pdf` on disk), `"c.pdf": { favorite: true }` (no PDF), `"d.pdf": { favorite: true, fingerprint: fingerprintOf(pdfA) }` (no PDF), `"b.pdf": { favorite: true, fingerprint: fingerprintOf(pdfB) }`.
  - Overview: cards `[{ name: "b", dir: "" }]`; poll the line text → `3 Favoriten nicht gefunden`; no `favorites-empty` hint; `.config.json` unchanged (`configState`).
  - Click `favorites-not-found-toggle` → entries `["a", "c", "d"]`; toggle text `Ausblenden`.
  - Click the `favorite-not-found-remove` of `a` → entries poll to `["c", "d"]`, line `2 Favoriten nicht gefunden`; config `a.pdf` → `{ pageDividers: { "1": 0.3 }, fingerprint: fingerprintOf(pdfA) }`.
  - Click `favorites-not-found-remove-all` → line gone; config sheets `{ "a.pdf": {…as above}, "b.pdf": {…unchanged} }` (`c.pdf` and `d.pdf` entries removed); `b.pdf` bytes unchanged; cards still `[b]`.
  - Leave the existing „a missing favorite is hidden…“ test as is.

- [ ] **Step 3: Implement**
  - `favoriteTexts.ts`: `favoritesNotFoundText`.
  - `favorites.ts`: state `notFound: [] as FavoriteSheet[]`; `forgetOtherFolder` clears it with `list`; `load()` sets `this.notFound = r.notFound` (ok) or `[]` (unreadable/error); the relink run resolves to `r` and the starter reloads when `moved > 0 || searched > 0`; the `apply` callback, on `!favorite`, also filters `store.notFound`.
  - `Overview.vue`: below the cards (inside the `listError === null` branch, also when there are no cards) the line `<v-icon>mdi-alert-outline</v-icon> {{ favoritesNotFoundText(n) }}` with the toggle button (`Anzeigen`/`Ausblenden`, local `ref(false)`), then when open a list of entries each with an `Entfernen` text button, and an `Alle entfernen` button. Removing = `favorites.set(f.pdfPath, false, true)`; all = each entry of a copy of `notFound`. The empty hint condition becomes `list.length === 0 && notFound.length === 0`.
  - `AGENTS.md` „Favoriten“: replace „a missing favorite keeps its mark and is hidden on the main page until its PDF is back“ with: hidden as a card; once not found (no fingerprint, or searched completely in this run) listed under „N Favoriten nicht gefunden“ with „Entfernen“/„Alle entfernen“ (unmarks). Add the new visual case to the test list.

- [ ] **Step 4: Verify** `npm test`, `npm run lint`, `npx vue-tsc --noEmit` (ignore the known tsconfig/`import.meta` errors), then headless `npx vitest run -c vitest.visual.config.mts tests/visual/favorites.visual.ts` — all favorites cases pass.

- [ ] **Step 5: Commit** `feat: list and remove favorites that were not found`
