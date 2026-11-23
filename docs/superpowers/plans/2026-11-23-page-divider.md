# Seitenteiler verschieben – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Schnitt im ersten Blätterschritt (heute fest 50 %) lässt sich je Seitenwechsel in einem eigenen Teiler-Modus verschieben und wird in `.config.json` im Notenordner gespeichert, nie in der PDF.

**Architecture:** Ein reines Modul (`src/pageDivider.ts`, ohne `node:`-Importe, von Haupt- und Renderer-Prozess genutzt) kennt Standard, Grenzen und Rundung. `src/folderConfig.ts` bekommt den Teil `sheets` und ändert je Aufruf genau einen Teiler; zwei tRPC-Aufrufe laden und speichern. Im Viewer entsteht der Schnitt künftig per CSS `clip-path` auf der Kopie der nächsten Seite und ihrem Markierungs-Overlay (statt Pixel zu löschen), damit er beim Ziehen live folgen kann; der Teiler-Modus nutzt genau diese Darstellung.

**Tech Stack:** TypeScript, Electron/tRPC, Vue 3 + Vuetify + Pinia, zod 4, vitest, Playwright `_electron` (headless).

**Spec:** `docs/superpowers/specs/2026-11-23-page-divider-design.md`

## Global Constraints

- Standard `0.5`, erlaubt `0.05` … `0.95`, beim Loslassen auf drei Nachkommastellen gerundet; gerundet `0.5` = Eintrag entfernen.
- Schlüssel des Teilers ist die Seite, die man **verlässt** (n, Wechsel n → n+1); der Wert ist ein Anteil der Höhe von Seite n+1, von oben.
- Format: `.config.json` → `"sheets": { "<Pfad relativ zum Notenordner, Trenner />": { "pageDividers": { "<n>": <Anteil> } } }`; `version` bleibt 1; unbekannte Felder (auch im Blatt-Objekt) bleiben; leere Ebenen werden entfernt.
- Die PDF wird nie geschrieben; `.config.json` nur bei echter Änderung (Öffnen und Modus ohne Ziehen schreiben nichts). Eine `unreadable` Datei wird nie geschrieben.
- Ohne gespeicherten Teiler sieht das Blättern aus wie heute.
- Texte wörtlich (deutsch):
  - Anzeige im Modus: `Seite ${n} → ${n + 1}`; Knopf: `Zur Mitte`
  - Laden gescheitert: `Die Seitenteiler können nicht verschoben werden: „${file}“ kann nicht gelesen werden: ${message}`
  - Neuere Version: `Die Seitenteiler können nicht verschoben werden: „${file}“ stammt von einer neueren Version der App. Bitte die App aktualisieren.`
  - Speichern gescheitert: `Der Seitenteiler konnte nicht gespeichert werden: ${message}. Er gilt nur, bis das Blatt geschlossen wird.` (bei unlesbarer Datei ist `message` = `„${file}“ kann nicht gelesen werden: ${message}`, wie bei den Setlisten)
- `src/folderConfig.ts` und `src/pageDivider.ts` ohne Electron-Importe; `src/pageDivider.ts` zusätzlich ohne `node:`-Importe.
- Teiler-Knopf in der App-Leiste: Symbol `mdi-arrow-split-horizontal`, im Modus `mdi-check` (**nicht** `mdi-close`/`mdi-pencil`: der Testtreiber findet den Stift-Knopf über diese Symbole); Leistenfarbe im Modus `teal`.
- GUI-Tests nur headless; `Noten/` nie öffnen. Conventional Commits, Body-Zeilen ≤ 100 Zeichen. Prüfbefehle `npm test`, `npm run lint`, `npx vitest run -c vitest.visual.config.mts <datei>`.
- `SheetViewer.vue`: nur ändern, was der Teiler braucht, kein Umbau.

## Review Focus

1. **Fenstergröße ändern während des Modus oder nach dem Ziehen:** `renderPdf` läuft neu, der Schnitt muss danach am gespeicherten Anteil stehen (nicht in der Mitte, nicht in Pixeln von vorher). → Task 3, e2e „the cut follows the divider after a resize".
2. **Zwei PCs, ein Blatt:** PC B hat inzwischen den Teiler von Seite 4 gespeichert; PC A zieht Seite 2 → B's Eintrag bleibt (frisch von der Platte gelesen). → Task 1, Test „setting one divider keeps a divider someone else wrote for another page".
3. **Blatt in Unterordner, Windows-Pfade:** Schlüssel mit `/`, auch wenn `path.sep` `\` ist; ein Pfad außerhalb des Ordners wird abgelehnt. → Task 2, Test „sheetKey uses / and rejects a path outside the folder" (mit `path.win32`).
4. **Von Hand vertippter Wert (`1.7`, `"2.5": 0.3`, Seite 99):** Datei bleibt lesbar, Anzeige begrenzt bzw. ignoriert, Schreiben lässt solche Einträge stehen. → Task 1, Test „out-of-range values and odd keys are kept and do not make the file unreadable"; Task 2, Test „dividerFor clamps and ignores pages that do not exist".
5. **Pedal/Pfeiltaste und Klick im Modus:** wählen nur den Wechsel bzw. tun nichts, blättern nicht und verschieben keinen Teiler. → Task 4, e2e „keys and a click beside the line change no divider".

## Dateiübersicht

| Datei | Aufgabe |
|---|---|
| `src/pageDivider.ts` (neu) | Konstanten, `clampDivider`, `roundDivider`, `dividerFor`, Texte |
| `src/folderConfig.ts` | Schema `sheets`, Patch `pageDivider`, `sheetKey` |
| `src/trcpLib.ts`, `src/trcpRouter.ts` | `loadPageDividers`, `savePageDivider` |
| `src/views/SheetViewer.vue` | Teiler laden, Schnitt per `clip-path`, rote Marken, Teiler-Modus |
| `src/store/index.ts`, `src/App.vue` | `dividerMode`, `dividerModeAvailable`, Knopf, Leistenfarbe, Ausschluss mit dem Stift |
| `tests/visual/electronDriver.ts`, `tests/visual/pageDivider.visual.ts` (neu) | e2e |
| `AGENTS.md`, `docs/superpowers/specs/2026-11-22-folder-config-design.md` | Doku |

---

### Task 1: `sheets` in `.config.json`

**Files:**
- Modify: `src/folderConfig.ts` (Schema, `FolderConfigPatch`, Merge in `updateFolderConfig`, Kopfkommentar)
- Test: `tests/folderConfig.test.ts` (neuer `describe("page dividers")`)

**Interfaces:**
- Produces:
  ```ts
  // im folderConfigSchema, zusätzlich:
  sheets: z.record(z.string(), z.object({ pageDividers: z.record(z.string(), z.number()).optional() }).loose()).optional()
  export type FolderConfigPatch = {
    setLists?: SetListsWrapper;
    markupMigrated?: { at: string };
    /** Sets (`ratio` number) or removes (`ratio` null) one divider; `sheet` is a sheetKey, `page` the page left. */
    pageDivider?: { sheet: string; page: number; ratio: number | null };
  };
  ```

- [ ] **Step 1: Write the failing tests** in `tests/folderConfig.test.ts`:
  - `"setting a divider keeps set lists, the mark, unknown fields and other sheets"`: Datei `{ version: 1, setLists: setListsA, markupMigrated: mark, other: 1, sheets: { "b.pdf": { pageDividers: { "1": 0.3 } } } }`; `updateFolderConfig(dir, { pageDivider: { sheet: "A/a.pdf", page: 2, ratio: 0.62 } })` → `readConfig()` gleicht der Eingabe plus `sheets["A/a.pdf"] = { pageDividers: { "2": 0.62 } }`.
  - `"setting one divider keeps a divider someone else wrote for another page"`: Datei mit `"a.pdf": { pageDividers: { "4": 0.4 }, note: "x" }`; Seite 2 setzen → `{ pageDividers: { "2": 0.7, "4": 0.4 }, note: "x" }`.
  - `"removing the last divider removes empty levels but keeps unknown fields of the sheet"`: (a) nur `"a.pdf": { pageDividers: { "2": 0.7 } }` → nach `ratio: null` hat die Datei kein `sheets`; (b) mit `note: "x"` im Blatt → `sheets: { "a.pdf": { note: "x" } }`.
  - `"removing a divider that is not there writes nothing"` und `"setting the same value writes nothing"`: `mtimeMs` der Datei unverändert (Muster des vorhandenen Tests „unchanged content is not written“); ohne Datei und `ratio: null` entsteht keine Datei.
  - `"out-of-range values and odd keys are kept and do not make the file unreadable"`: Datei `sheets: { "a.pdf": { pageDividers: { "2.5": 0.3, "99": 1.7 } } }` → `loadFolderConfig` ist `ok`; Seite 1 setzen → beide Einträge stehen noch.
  - `"a sheets part with a wrong structure is unreadable and never overwritten"`: `test.each` über `sheets: 7`, `sheets: { "a.pdf": 7 }`, `sheets: { "a.pdf": { pageDividers: { "2": "x" } } }` → `loadFolderConfig` `unreadable`; `updateFolderConfig(… pageDivider …)` wirft `FolderConfigUnreadableError`; Bytes unverändert.
  - `"setting a divider in a folder with only .set-lists.json takes it over first"`: Ergebnis enthält `setLists` und `sheets`, `.set-lists.json` ist weg.

- [ ] **Step 2: Run** `npx vitest run tests/folderConfig.test.ts` → die neuen Tests scheitern (Typfehler/fehlender Teil).

- [ ] **Step 3: Implement** Schema-Feld und Patch wie oben; in `updateFolderConfig` den Teiler auf `base.sheets` anwenden: Ebenen nur kopieren (nie fremde Objekte verändern), Schlüssel `String(page)` setzen oder löschen, danach leeres `pageDividers`, ein Blatt-Objekt ohne weitere Felder und ein leeres `sheets` entfernen. Die vorhandene Prüfung „unverändert → nicht schreiben“ greift danach von selbst.

- [ ] **Step 4: Run** `npx vitest run tests/folderConfig.test.ts` → PASS; `npm test` → PASS.

- [ ] **Step 5: Commit** `feat: store page dividers per sheet in .config.json`

---

### Task 2: Modell und tRPC-Aufrufe

**Files:**
- Create: `src/pageDivider.ts`
- Modify: `src/folderConfig.ts` (`sheetKey`), `src/trcpLib.ts`, `src/trcpRouter.ts`
- Test: `tests/pageDivider.test.ts` (neu), `tests/setLists.test.ts`-Muster für `trcpLib` (Electron gemockt) in `tests/pageDividerIpc.test.ts` (neu)

**Interfaces:**
- Consumes: `FolderConfigPatch.pageDivider` (Task 1), `isInsideFolder`, `absoluteFolderSchema` (`src/migration/ipcInput.ts`), `pdfPathSchema` (`src/models/markup.ts`).
- Produces:
  ```ts
  // src/pageDivider.ts
  export const DEFAULT_DIVIDER = 0.5, MIN_DIVIDER = 0.05, MAX_DIVIDER = 0.95;
  export type PageDividers = Record<number, number>;        // page left -> ratio (as stored, unclamped)
  export function clampDivider(ratio: number): number;
  export function roundDivider(ratio: number): number;      // clamp, then 3 decimals
  /** Ratio for the turn `page` -> `page + 1`; DEFAULT_DIVIDER unless 1 <= page < pageCount and set. */
  export function dividerFor(dividers: PageDividers, page: number, pageCount: number): number;
  export function dividersLoadFailedText(file: string, message: string, newerVersion: boolean): string;
  export function dividerSaveFailedText(message: string): string;
  // src/folderConfig.ts
  /** PDF path relative to `folder` with "/"; null if it is not below `folder`. */
  export function sheetKey(folder: string, pdfPath: string, pathApi?: typeof path.posix): string | null;
  // src/trcpLib.ts
  export const pageDividersInputSchema;     // { folder: absoluteFolderSchema, pdfPath: pdfPathSchema }
  export const savePageDividerInputSchema;  // + page: int >= 1, ratio: number in [MIN, MAX] | null
  export type LoadPageDividersResult =
    | { kind: "ok"; dividers: PageDividers }
    | { kind: "unreadable"; file: string; message: string; newerVersion?: true };
  export function loadPageDividers(input): Promise<LoadPageDividersResult>;            // never throws
  export function savePageDivider(input): Promise<{ ok: true } | { ok: false; message: string }>; // never throws
  // src/trcpRouter.ts: loadPageDividers (query), savePageDivider (mutation)
  ```

- [ ] **Step 1: Write the failing tests**
  - `tests/pageDivider.test.ts`: `clampDivider(0) === 0.05`, `clampDivider(1.7) === 0.95`; `roundDivider(0.61234) === 0.612`, `roundDivider(0.4996) === 0.5`; `"dividerFor clamps and ignores pages that do not exist"`: mit `{ 1: 0.3, 3: 1.7, 4: 0.2 }` und `pageCount = 4` → `dividerFor(_, 1, 4) === 0.3`, `(_, 2, 4) === 0.5`, `(_, 3, 4) === 0.95`, `(_, 4, 4) === 0.5`; die drei Texte wörtlich aus den Global Constraints.
  - `tests/folderConfig.test.ts`: `"sheetKey uses / and rejects a path outside the folder"`: posix `sheetKey("/n", "/n/A/b.pdf") === "A/b.pdf"`; `sheetKey("C:\\n", "C:\\n\\A\\b.pdf", path.win32) === "A/b.pdf"`; `sheetKey("/n", "/x/b.pdf") === null`; `sheetKey("/n", "/n") === null`.
  - `tests/pageDividerIpc.test.ts` (Electron gemockt wie in `tests/setLists.test.ts`): Laden ohne Datei → `{ kind: "ok", dividers: {} }`; nach `savePageDivider({ folder, pdfPath: <folder>/A/a.pdf, page: 2, ratio: 0.62 })` → `{ kind: "ok", dividers: { 2: 0.62 } }` und die Datei hat `sheets["A/a.pdf"]`; ein Schlüssel `"2.5"` erscheint nicht in `dividers`; unlesbare Datei → `unreadable` mit `file: ".config.json"`, Speichern → `{ ok: false, message: "„.config.json“ kann nicht gelesen werden: …" }` (Präfix prüfen); `savePageDividerInputSchema` lehnt `ratio: 0.99`, `page: 0` und eine PDF außerhalb von `folder` ab.

- [ ] **Step 2: Run** `npx vitest run tests/pageDivider.test.ts tests/pageDividerIpc.test.ts tests/folderConfig.test.ts` → FAIL.

- [ ] **Step 3: Implement** die Signaturen oben. `loadPageDividers` nimmt aus `pageDividers` nur Schlüssel, die ganze Zahlen ≥ 1 sind (Werte ungeklemmt; geklemmt wird erst in `dividerFor`). `savePageDivider` ruft `updateFolderConfig(folder, { pageDivider: { sheet, page, ratio } })` und baut die Fehlermeldung wie `saveSetLists`. Router-Einträge neben `loadSetLists`/`saveSetLists`.

- [ ] **Step 4: Run** `npm test` → PASS; `npm run lint` → keine neuen Fehler.

- [ ] **Step 5: Commit** `feat: load and save page dividers over tRPC`

---

### Task 3: Schnitt am Teiler beim Blättern

**Files:**
- Modify: `src/views/SheetViewer.vue` (`onMounted`, `copyPageToHalfPageAndBackdrop`, `createOverlay`, `.splitIndicator`/`getCurrentHeight`)
- Modify: `tests/visual/electronDriver.ts` (Helfer `cutState`)
- Test: `tests/visual/pageDivider.visual.ts` (neu)

**Interfaces:**
- Consumes: `loadPageDividers` (Task 2), `dividerFor`, `PageDividers`.
- Produces (für Task 4):
  ```ts
  // SheetViewer.vue (intern)
  const dividers = ref<PageDividers>({});                 // as loaded / changed in this session
  const dividersError = ref<string | null>(null);         // text for the notice, null = loaded
  function applyCut(halfPage: number): void;              // halfPage = n + 0.5; sets clip-path + backdrop
  function applyAllCuts(): void;
  // electronDriver.ts, SheetSession:
  /** The cut of the half step `turn + 0.5` as drawn: ratio from the clip-path of its page canvas,
   *  backdrop height in CSS px, page height in CSS px, and the red marks' top (null when hidden). */
  cutState(turn: number): Promise<{ ratio: number; backdropPx: number; pageHeightPx: number; marksTopPx: number | null }>;
  ```

- [ ] **Step 1: Write the failing e2e tests** in `tests/visual/pageDivider.visual.ts` (Aufbau wie `tests/visual/writeBlock.visual.ts`: Ordner unter `test-results/visual/work/page-divider-*`, `makePdf({ pages: 3, xref: "table" })`, `openSheet`, Aufräumen nach jedem Test):
  - `"without a divider the cut is in the middle"`: `cutState(1)` → `ratio` ≈ 0.5 (±0.001), `backdropPx` ≈ `pageHeightPx / 2 + 5` (±1); `.config.json` existiert nach dem Öffnen nicht.
  - `"a stored divider cuts the first step and moves the red marks"`: vorab `.config.json` mit `sheets: { "a.pdf": { pageDividers: { "1": 0.7 } } }`; `cutState(1).ratio` ≈ 0.7, `backdropPx` ≈ `0.7 * pageHeightPx + 5`; auf Seite 1 liegt `marksTopPx` um `0.2 * pageHeightPx` tiefer als ohne Teiler (Vergleich mit Seite 2, die keinen hat); Wechsel 2 → 3 bleibt bei 0.5.
  - `"the cut follows the divider after a resize"`: wie oben, dann `resizeContent(1000, 1300)` → `cutState(1).ratio` ≈ 0.7.

- [ ] **Step 2: Run** `npx vitest run -c vitest.visual.config.mts tests/visual/pageDivider.visual.ts` → FAIL (Ratio 0.5 bzw. Helfer fehlt).

- [ ] **Step 3: Implement**
  - `onMounted`: `loadPageDividers({ folder: store.sheetMusicFolder, pdfPath: sheetPath })` vor `renderPdf()` (nach dem Markup-Laden); Ergebnis in `dividers` bzw. `dividersError` (Text aus `dividersLoadFailedText`); ein Wurf zählt wie `unreadable` mit der Fehlermeldung. Kein Hinweis beim Öffnen.
  - `copyPageToHalfPageAndBackdrop`: das verzögerte `clearRect` entfällt; die Kopie bleibt ganz, danach `applyCut(pageNumber - 0.5)`.
  - `createOverlay`: das `clearRect` für `isHalfPage` entfällt; `applyAllCuts()` am Ende von `populateOverlayCanvas`.
  - `applyCut(h)`: `r = dividerFor(dividers, h - 0.5, pageNumbers)`; auf `canvas[data-page="h"]` und `canvas[data-page-overlay="h"]` `style.clipPath = inset(0 0 ${(1 - r) * 100}% 0)`; Backdrop `div[data-page-backdrop="h"]` Höhe `r * Seitenhöhe + 5 px` (Breite wie bisher).
  - Rote Marken: bei ganzer Seite n auf der Höhe `dividerFor(dividers, n, pageNumbers) * Höhe von Seite n+1`, mit demselben Versatz zur Schnittlinie wie heute (ohne Teiler pixelgleich). Im halben Schritt unverändert.
  - `cutState` im Treiber liest `getComputedStyle(...).clipPath`, die Backdrop-Höhe, `style.height` der Seite und die Lage von `.splitIndicator .indicatorLeft`.

- [ ] **Step 4: Run** die neue Datei → PASS; danach `npx vitest run -c vitest.visual.config.mts tests/visual/writeBlock.visual.ts tests/visual/markupInPdf.visual.ts` → PASS (Schnitt mit Markierungen unverändert).

- [ ] **Step 5: Commit** `feat: cut the first page-turn step at the stored divider`

---

### Task 4: Teiler-Modus

**Files:**
- Modify: `src/store/index.ts` (State), `src/App.vue` (Knopf, Farbe, Sperren, Zurück-Pfeil), `src/views/SheetViewer.vue` (Modus)
- Modify: `tests/visual/electronDriver.ts` (Helfer), `tests/visual/pageDivider.visual.ts`

**Interfaces:**
- Consumes: Task 2 (`savePageDivider`, `roundDivider`, `clampDivider`, `dividerSaveFailedText`), Task 3 (`dividers`, `dividersError`, `applyCut`).
- Produces:
  ```ts
  // store state
  dividerMode: false,
  /** Set by the mounted SheetViewer: all pages rendered and at least 2 pages. */
  dividerModeAvailable: false,
  // SheetViewer.vue DOM for tests
  //   .dividerLine[data-turn="<n>"]   grab area (>= 48 px high) with the red line in its middle
  //   [data-testid="divider-prev"], [data-testid="divider-next"], [data-testid="divider-label"],
  //   [data-testid="divider-reset"]
  // electronDriver.ts, SheetSession:
  toggleDividerMode(): Promise<void>;                   // clicks the app bar button, waits for .dividerLine (dis)appearing
  dividerButtonEnabled(): Promise<boolean>;
  dragDivider(dy: number): Promise<void>;               // mouse down on the line centre, move by dy px in steps, up
  dividerLabel(): Promise<string>;
  ```

- [ ] **Step 1: Write the failing e2e tests** in `tests/visual/pageDivider.visual.ts` (3-seitige PDF, sofern nicht anders genannt):
  - `"dragging the line saves the divider, the PDF stays byte-identical"`: Modus auf Seite 1 → `dividerLabel()` = `Seite 1 → 2`; `dragDivider(+0.2 * pageHeightPx)` → `.config.json` hat `sheets["a.pdf"].pageDividers["1"]` ≈ 0.7 (±0.01, drei Nachkommastellen); PDF-Bytes gleich den Bytes vor dem Öffnen; Modus verlassen → aktuelle Seite 1, `cutState(1).ratio` gleich dem gespeicherten Wert.
  - `"the divider holds after a restart and Zur Mitte removes it"`: neue App auf demselben Ordner → `cutState(1).ratio` wie gespeichert; Modus, `divider-reset` → `.config.json` ohne `sheets`; `divider-reset` danach gesperrt.
  - `"keys and a click beside the line change no divider"`: Modus; `ArrowRight` → Label `Seite 2 → 3`, nochmal → bleibt `Seite 2 → 3`; `ArrowLeft` ×2 → `Seite 1 → 2`; Klick in die rechte Fensterhälfte weit unter der Linie → Label und `cutState(1).ratio` unverändert; `.config.json` existiert nicht.
  - `"entering and leaving without a drag writes nothing"`: Modus an/aus auf Seite 2 und 3 → `.config.json` existiert nicht; nach dem Verlassen auf Seite 3 ist die aktuelle Seite 2 (letzter Wechsel 2 → 3).
  - `"the mode works on a PDF that cannot take markup"` (`skipIf(!canMakeReadOnly)`, PDF `chmod 0o444`): Schreibsperr-Dialog bestätigen; `editButtonEnabled()` false, `dividerButtonEnabled()` true; Ziehen speichert.
  - `"a broken .config.json keeps the mode off with a notice"`: `.config.json` = `"{"`; Setlisten-Hinweis schließen (OK); Knopf drücken → keine `.dividerLine`, `snackbarText()` = `Die Seitenteiler können nicht verschoben werden: „.config.json“ kann nicht gelesen werden: ` + Präfix-Vergleich; Datei-Bytes unverändert.
  - `"a single page PDF has no divider mode"`: `makePdf({ pages: 1 })` → `dividerButtonEnabled()` false.
  - `"pencil and divider mode exclude each other"`: im Teiler-Modus `editButtonEnabled()` false; im Stift-Modus `dividerButtonEnabled()` false.

- [ ] **Step 2: Run** die Datei → die neuen Tests scheitern.

- [ ] **Step 3: Implement**
  - Store: zwei Felder oben; `toggleDividerMode()` wie `toggleEditMode`.
  - `App.vue`: Knopf neben dem Stift (nur auf `SheetViewer`), `:disabled="!store.dividerModeAvailable || store.editMode"`; Stift zusätzlich gesperrt bei `store.dividerMode`; Leiste `store.editMode ? 'red' : store.dividerMode ? 'teal' : 'primary'`; `onNavBack` schaltet `dividerMode` ab wie `editMode`.
  - `SheetViewer.vue`: `dividerModeAvailable` setzen, sobald alle Seiten gerendert sind und `pageNumbers >= 2`, beim Unmount auf `false` und `dividerMode` auf `false`. `watch(store.dividerMode)`: mit `dividersError` → zurück auf `false`, Hinweis; sonst Einstieg `turn = Number.isInteger(currentPage) ? Math.min(currentPage, pageNumbers - 1) : Math.floor(currentPage)`, `currentPage = turn + 0.5`; Verlassen → `currentPage = turn`. `onKeyDown` im Modus: Pfeile ändern `turn` in `[1, pageNumbers - 1]`; `onClick` im Modus: nichts.
  - Linie: absolut über der Seite, `top = r * Seitenhöhe`, volle Seitenbreite, Griffhöhe ≥ 48 px, z-Index über den Seiten. Pointer-Events mit `setPointerCapture`: beim Druck Startwert und Start-Y merken, beim Bewegen `dividers[turn] = clampDivider(start + dy / Seitenhöhe)` und `applyCut(turn + 0.5)`, beim Loslassen `roundDivider`; nur wenn das Ergebnis vom Wert beim Druck abweicht, `savePageDivider` mit `ratio` (bzw. `null` bei 0.5). Fehlschlag → `notices.show(dividerSaveFailedText(message))`, der Wert bleibt.
  - Bedienelemente unten rechts im Stil von `.fabContainer`: `‹`, Label, `›`, `Zur Mitte` (gesperrt bei 0.5; setzt 0.5, wendet an, speichert `null`).
  - Treiberhelfer wie in Interfaces.

- [ ] **Step 4: Run** `npx vitest run -c vitest.visual.config.mts tests/visual/pageDivider.visual.ts tests/visual/writeBlock.visual.ts tests/visual/exitGuard.visual.ts` → PASS; `npm test`, `npm run lint` → PASS.

- [ ] **Step 5: Commit** `feat: add a mode to move the page divider per page turn`

---

### Task 5: Doku und Gesamtlauf

**Files:**
- Modify: `AGENTS.md` (neuer Absatz „Page divider“ unter Architecture/Markup storage; `.config.json`-Absatz um `sheets`; Visual-tests-Liste um `pageDivider.visual.ts`), `docs/superpowers/specs/2026-11-22-folder-config-design.md` (Verweis auf den neuen Teil)

- [ ] **Step 1:** Doku schreiben (kurz, im Stil der vorhandenen Absätze: Datei, Format, Schlüssel = verlassene Seite, Anteil der nächsten Seite, Schnitt per `clip-path`, Modus-Knopf, keine PDF-Änderung).
- [ ] **Step 2: Run** `npm test`, `npm run lint`, `npx vitest run -c vitest.visual.config.mts` → alles PASS (ohne `Noten/` werden die Korpus-Tests übersprungen; mit Korpus ohne Abweichung in `compare-summary.md`).
- [ ] **Step 3: Commit** `docs: describe the movable page divider`
