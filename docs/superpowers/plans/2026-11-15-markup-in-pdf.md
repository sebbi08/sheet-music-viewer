# Markierungen in der PDF – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Markierungen werden als Stempel-Annotation (PNG-Appearance + versteckte fabric-Daten) per inkrementellem Update in die PDF geschrieben, statt in `.<name>.data`.

**Architecture:** Der Main-Prozess liest und schreibt PDFs mit `pdf-lib` (nur Parsen und Objekt-Serialisierung). Das inkrementelle Anhängen (Xref-Tabelle/-Stream, Trailer) ist selbst geschrieben. Ein reiner Kern `buildMarkedPdf(bytes, changes) → bytes` enthält die gesamte PDF-Logik und ist ohne Electron testbar. Eine dünne Datei-Schicht übernimmt atomares Schreiben, Fallback und Migration. Der Renderer rechnet fabric-JSON zwischen Bildschirmpixeln und PDF-Punkten um, rendert das PNG und blendet unsere Optional-Content-Group in pdf.js aus.

**Tech Stack:** TypeScript, Electron/tRPC, pdf-lib 1.17.1, pdfjs-dist 6.5 (Renderer + Tests, in Node mit `@napi-rs/canvas`, bereits als optionale Abhängigkeit von pdfjs installiert), fabric 7.4, vitest, Playwright (`_electron`), pixelmatch, pngjs.

**Visuelle Absicherung:** Task 1b baut die Vergleichs-Infrastruktur und erzeugt Referenzbilder aus der *alten* App (Git-Stand `8301b5d`), Task 8 vergleicht am Ende die neue App dagegen. Die Spec, Abschnitt 8, legt Schwellen und Vergleiche A–E fest.

**Spec:** `docs/superpowers/specs/2026-11-15-markup-in-pdf-design.md`

## Global Constraints

- Keine AGPL-Abhängigkeiten (Projekt ist MIT). Neue Dependencies exakt pinnen wie im restlichen `package.json`: `pdf-lib` `1.17.1` (dependency), `vitest` aktuelle Version (devDependency).
- Die Bytes der Original-PDF werden nie verändert: jedes Ergebnis von `buildMarkedPdf` beginnt mit einem gültigen Präfix der Eingabe (Original oder Original + fremde Updates).
- `PDFDocument.load` immer mit `{ updateMetadata: false }` aufrufen.
- Konstanten (Datei `src/models/markupConstants.ts`, ohne Node-Imports, auch vom Renderer genutzt):
  `SMV_DATA_KEY = "SMV_Data"`, `SMV_CATALOG_KEY = "SMV_Markup"`, `ANNOT_NM = "smv-markup-page"`, `ORPHAN_NM = "smv-markup-orphan"`, `OCG_NAME = "Sheet Music Viewer – Markierungen"`, `MARKUP_FORMAT_VERSION = 1`, `MARKUP_DPI = 300`, `MAX_PNG_SIDE_PX = 4096`.
- Commits: Conventional Commits (commitlint-Hook), mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nur die Dateien des jeweiligen Tasks stagen; fremde uncommittete Änderungen im Working Tree nicht anfassen.
- Seitennummern sind überall 1-basiert (wie `currentPage` in `SheetViewer.vue`).
- **Offline**: Kein Code dieses Vorhabens macht Netzwerkanfragen. Alle Assets (pdf.js-WASM, cmaps, Schriften) kommen aus dem Bundle bzw. aus `node_modules`. Tests laden nichts nach; Playwright nutzt das Electron-Binary aus `node_modules`, ohne Browser-Download.
- Neue Test-Dependencies (devDependencies, exakt gepinnt, Lizenz MIT/ISC/Apache-2.0): `playwright-core`, `pixelmatch`, `pngjs` (+ `@types/pngjs`).
- Der Testkorpus `Noten/` ist lokal und gitignored. Bilder oder Inhalte daraus werden nie committet; Ausgaben landen in `test-results/` (in `.gitignore` aufnehmen).

## Review Focus

1. **Doppelte Markierung in der App**: Wenn pdf.js die `/OC` unserer Annotation nicht beachtet, erscheint die Markierung doppelt. → automatisch durch Vergleich E in Task 8 (Seite *ohne* Markierung alt gegen neu), dazu manuelle Prüfung in Task 7.
2. **PDF geöffnet in Acrobat (Windows, Rename scheitert mit EBUSY/EPERM)**: Fehler melden, Datei unverändert, Änderungen bleiben „dirty“ und werden beim nächsten Speichern erneut versucht. → Test in Task 5, Dirty-Handling in Task 7.
3. **Zwei Speichervorgänge kurz hintereinander** (Bearbeitungsmodus schnell an/aus): Sie dürfen sich nicht gegenseitig überschreiben. → Serialisierung pro Pfad, Test in Task 5.
4. **Große Seiten** (A3, Poster): Das PNG mit 300 dpi wird riesig. → Kantenlänge auf `MAX_PNG_SIDE_PX` deckeln, Test in Task 6.
5. **pdf.js lädt Bereiche nach, während die Datei ersetzt wurde**: Das kann zu kaputter Darstellung führen. → `disableRange/disableStream/disableAutoFetch` in Task 7, manuelle Prüfung beim Fenster-Resize nach dem Speichern.

---

### Task 1: Test-Setup und Byte-Helfer

**Files:**
- Modify: `package.json` (devDependency `vitest`, dependency `pdf-lib@1.17.1`, Script `"test": "vitest run"`)
- Create: `vitest.config.mts` (environment `node`, include `tests/**/*.test.ts`)
- Create: `src/pdfMarkup/fileStructure.ts`
- Create: `tests/pdfMarkup/fixtures.ts`
- Test: `tests/pdfMarkup/fileStructure.test.ts`

**Interfaces:**
- Produces:
  - `findLastStartXref(bytes: Uint8Array): number` – Wert des letzten `startxref`. Wirft einen Fehler, wenn keiner gefunden wird.
  - `isValidSectionEnd(bytes: Uint8Array, length: number): boolean` – `0 < length <= bytes.length` und `bytes[0..length)` endet auf `%%EOF`, optional gefolgt von `\r`, `\n` oder `\r\n`.
  - `getXrefKind(bytes: Uint8Array, offset: number): "table" | "stream"` – `table`, wenn an `offset` (nach Whitespace) `xref` steht. Sonst `stream`.
  - `getSectionTrailer(bytes: Uint8Array, offset: number): { prev: number | null; size: number }` – liest `/Prev` und `/Size` aus dem Trailer (bei `table`) bzw. dem Xref-Stream-Dict (bei `stream`).
  - Fixtures: `makePdf(opts: { pages?: number; xref: "table" | "stream"; rotate?: 0 | 90 | 180 | 270; cropBox?: [number, number, number, number]; mediaBoxes?: [number, number, number, number][]; foreignAnnot?: boolean }): Promise<Uint8Array>` (pdf-lib, `save({ useObjectStreams: xref === "stream" })`, Standard A4 595×842, etwas Text pro Seite). `mediaBoxes[i]` setzt die MediaBox von Seite i+1, auch mit negativem Ursprung (z. B. `[-22.5, -56.8, 572.7, 785.0]`, wie bei den iOS-Dateien im Korpus) und für uneinheitliche Seitengrößen. `foreignAnnot` hängt an Seite 1 eine Text- und eine Square-Annotation. Außerdem `makePng(w: number, h: number): Uint8Array` (RGBA-PNG mit `zlib.deflateSync` und `zlib.crc32`, ohne neue Dependency), `markEncrypted(bytes: Uint8Array): Uint8Array` (Tabellen-Fixture: setzt `/Encrypt << /Filter /Standard >>` in den Trailer) und `readXrefEntries(bytes: Uint8Array, offset: number): Map<number, number>` (Objektnummer → Offset; dekodiert Tabelle oder Xref-Stream mit `/W`/`/Index` via `zlib.inflateSync`).

- [ ] **Step 1: Dependencies und Config anlegen**, `npm install`.
- [ ] **Step 2: Failing tests schreiben**

```ts
test("findLastStartXref returns last value", async () => {
  const pdf = await makePdf({ xref: "table" });
  const text = Buffer.from(pdf).toString("latin1");
  expect(findLastStartXref(pdf)).toBe(Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1]));
});
test("isValidSectionEnd", async () => {
  const pdf = await makePdf({ xref: "table" });
  expect(isValidSectionEnd(pdf, pdf.length)).toBe(true);
  expect(isValidSectionEnd(pdf, pdf.length - 10)).toBe(false);
  expect(isValidSectionEnd(pdf, pdf.length + 1)).toBe(false);
});
test.each(["table", "stream"] as const)("getXrefKind/%s", async (kind) => {
  const pdf = await makePdf({ xref: kind });
  expect(getXrefKind(pdf, findLastStartXref(pdf))).toBe(kind);
  expect(getSectionTrailer(pdf, findLastStartXref(pdf))).toEqual({ prev: null, size: expect.any(Number) });
});
test("readXrefEntries offsets point at objects", async () => {
  for (const kind of ["table", "stream"] as const) {
    const pdf = await makePdf({ xref: kind });
    for (const [num, off] of readXrefEntries(pdf, findLastStartXref(pdf)))
      expect(Buffer.from(pdf.subarray(off, off + 20)).toString("latin1")).toMatch(new RegExp(`^${num} \\d+ obj`));
  }
});
```

- [ ] **Step 3: `npx vitest run tests/pdfMarkup/fileStructure.test.ts`** → FAIL (Modul fehlt).
- [ ] **Step 4: `fileStructure.ts` implementieren** (Latin1-Text des Dateiendes bzw. ab `offset` per Regex auswerten).
- [ ] **Step 5: Test erneut** → PASS.
- [ ] **Step 6: Commit** `chore: add vitest, pdf-lib and PDF byte helpers`

### Task 1b: Visuelle Vergleichs-Infrastruktur und Referenzbilder der alten App

Dieser Task ändert keinen App-Code. Die Referenz wird aus dem festen Git-Stand `8301b5d` gebaut, deshalb ist die Reihenfolge zu den anderen Tasks technisch egal. Er kommt früh, damit Probleme mit dem Korpus oder dem Treiber sofort auffallen.

**Files:**
- Modify: `package.json` (devDependencies siehe Global Constraints; Script `"test:visual": "vitest run -c vitest.visual.config.mts"`), `.gitignore` (`test-results/`)
- Create: `vitest.visual.config.mts` (include `tests/visual/**/*.visual.ts`, `testTimeout` 10 min, `fileParallelism: false`)
- Create: `tests/visual/imageCompare.ts`
- Create: `tests/visual/pdfRender.ts`
- Create: `tests/visual/electronDriver.ts`
- Create: `tests/visual/corpus.ts`
- Create: `tests/visual/baseline.ts`
- Create: `tests/visual/baseline.visual.ts`
- Test: `tests/visual/imageCompare.test.ts` (läuft in `npm test`)

**Interfaces:**
- Produces (`imageCompare.ts`, rein, mit pngjs/pixelmatch):
  - `interface Img { width: number; height: number; data: Uint8Array }` (RGBA)
  - `decodePng(bytes: Uint8Array): Img`, `encodePng(img: Img): Uint8Array`
  - `diffRatio(a: Img, b: Img, threshold = 0.1): { ratio: number; diff: Img }`: Anteil abweichender Pixel laut pixelmatch. Bei unterschiedlicher Größe wird ein Fehler geworfen.
  - `markupMask(withMarkup: Img, without: Img, threshold = 0.1): Uint8Array` (1 = Pixel weicht ab)
  - `maskMetrics(a: Uint8Array, b: Uint8Array, width: number): { iou: number; centroidOffsetPx: number; areaA: number; areaB: number }`. Sind beide Masken leer, ist `iou = 1` und `offset = 0`. Ist genau eine leer, ist `iou = 0` und `offset = Infinity`.
  - `sideBySide(...imgs: Img[]): Img` für Diff-Bilder (Referenz | Neu | Differenz)
- Produces (`pdfRender.ts`, Node, pdfjs-dist legacy + `@napi-rs/canvas`, `wasmUrl`/`cMapUrl`/`standardFontDataUrl` aus `node_modules/pdfjs-dist`, damit es offline läuft):
  - `renderPdfPage(bytes: Uint8Array, page: number, cssWidth: number, opts: { hideOcgNamed?: string; annotations: boolean }): Promise<Img>`. Skala = `cssWidth / viewport(scale 1).width`, weißer Hintergrund. `annotations: true` rendert Annotation-Appearances mit (`AnnotationMode.ENABLE`). `hideOcgNamed` schaltet die Gruppe mit diesem Namen in der Optional-Content-Konfiguration aus.
- Produces (`electronDriver.ts`, `playwright-core` `_electron`):
  - `interface AppUnderTest { root: string }`: Verzeichnis mit gebauter App, `.vite/build/main.cjs` existiert.
  - `buildAppAtRef(ref: string): Promise<AppUnderTest>`. Legt einen Git-Worktree unter `test-results/visual/worktrees/<ref>` an, wiederverwendet ihn, wenn er schon existiert. `node_modules` wird auf das Haupt-Repo verlinkt (Junction unter Windows). Gebaut wird mit `npx electron-forge package`, damit `.vite/` entsteht.
  - `currentApp(): Promise<AppUnderTest>` baut das aktuelle Working Tree genauso.
  - `openSheet(app: AppUnderTest, folder: string, pdfPath: string): Promise<SheetSession>`:
    - Startet das Electron-Binary aus `node_modules` mit `[app.root]` und `--force-device-scale-factor=1`. Nicht das gepackte Binary, weil die Fuses Debugging verbieten.
    - Setzt die Fenster-Inhaltsgröße fest auf 1200×1600.
    - Setzt `localStorage.sheetMusicFolder = folder` und navigiert per Hash zur SheetViewer-Route für `pdfPath`. Das Pfadformat steht in `SheetSelection.vue`.
    - Wartet, bis `#sheetViewerWrapper .overlay` verschwunden ist, plus 600 ms für den Resize-Debounce.
    - Protokolliert über `session.webRequest` jede http(s)-Anfrage. Ausgenommen ist nur der lokale Vite-Dev-Server, falls er genutzt wird.
  - `interface SheetSession { gotoPage(page: number): Promise<void>; captureView(page: number): Promise<{ with: Img; without: Img }>; captureEdit(page: number): Promise<{ with: Img; without: Img }>; toggleEdit(): Promise<void>; networkRequests(): string[]; close(): Promise<void> }`
    - `gotoPage` drückt `ArrowRight`/`ArrowLeft`, bis `currentPage === page` (2 Tastendrücke pro Seite).
    - `captureView` zeichnet in `page.evaluate` den Seiten-Canvas `canvas[data-page="N"]` und den Overlay-Canvas `canvas[data-page-overlay="N"]` in CSS-Größe in einen Offscreen-Canvas. `without` ist nur der Seiten-Canvas. Rückgabe als PNG.
    - `captureEdit` schaltet den Bearbeitungsmodus über den Stift-Button der App-Bar ein und komponiert dann den Seiten-Canvas mit dem fabric-`lower-canvas`. Den Bearbeitungsmodus **nicht** wieder verlassen, denn das Verlassen speichert.
    - `close` beendet die App, ohne den Bearbeitungsmodus zu verlassen.
- Produces (`corpus.ts`):
  - `listCorpus(): { pdfPath: string; markedPages: number[] }[]` für alle `Noten/*.pdf` mit `.data`. `markedPages` sind die Seiten aus der `.data` mit mindestens einem Objekt.
  - `copyCorpus(target: string): string` kopiert `Noten/` inkl. `.data` in einen frischen Ordner und gibt den Pfad zurück.
- Produces (`baseline.ts`):
  - `ensureBaseline(ref = process.env.VISUAL_BASELINE_REF ?? "8301b5d"): Promise<string>`. Erzeugt Referenzbilder unter `test-results/visual/baseline/<ref>/<pdf>/<page>-{edit,view}-{with,without}.png`, falls noch nicht vorhanden. Arbeitet auf `copyCorpus`. Pro PDF erst alle `captureView`, dann alle `captureEdit`.

- [ ] **Step 1: Failing tests für `imageCompare` schreiben**

```ts
const solid = (w: number, h: number, px: (x: number, y: number) => number): Img => { /* RGBA, schwarz wo px()=1, sonst weiß */ };
test("identical images have ratio 0", () => {
  const a = solid(20, 20, () => 0);
  expect(diffRatio(a, a).ratio).toBe(0);
});
test("mask metrics detect a 1px shift", () => {
  const blank = solid(40, 40, () => 0);
  const a = markupMask(solid(40, 40, (x, y) => +(x >= 10 && x < 20 && y >= 10 && y < 20)), blank);
  const b = markupMask(solid(40, 40, (x, y) => +(x >= 11 && x < 21 && y >= 10 && y < 20)), blank);
  const m = maskMetrics(a, b, 40);
  expect(m.centroidOffsetPx).toBeCloseTo(1);
  expect(m.iou).toBeCloseTo(90 / 110);
});
test("empty vs non-empty mask", () => {
  const blank = solid(10, 10, () => 0);
  const m = maskMetrics(markupMask(blank, blank), markupMask(solid(10, 10, (x) => +(x === 1)), blank), 10);
  expect(m).toMatchObject({ iou: 0, centroidOffsetPx: Infinity });
});
test("renderPdfPage renders offline at requested width", async () => {
  const img = await renderPdfPage(await makePdf({ xref: "table" }), 1, 600, { annotations: true });
  expect(img.width).toBe(600);
});
```

- [ ] **Step 2: `npx vitest run tests/visual/imageCompare.test.ts`** → FAIL.
- [ ] **Step 3: `imageCompare.ts` und `pdfRender.ts` implementieren.**
- [ ] **Step 4: Test** → PASS.
- [ ] **Step 5: `electronDriver.ts`, `corpus.ts`, `baseline.ts` implementieren und `baseline.visual.ts` schreiben.** `baseline.visual.ts` enthält genau einen Test pro Korpus-PDF:
  - `ensureBaseline()` läuft durch.
  - Für jede markierte Seite existieren die vier Bilder.
  - Die Maske `edit-with − edit-without` ist nicht leer.
  - Der Lauf der alten App hat 0 Netzwerkanfragen.
  - Zusätzlich wird die Abweichung `view` gegen `edit` (Schwerpunkt-Offset in px) **nur geloggt**, weil die alte Ansicht rundet (siehe Spec 8).
- [ ] **Step 6: `npm run test:visual`** → PASS für alle Korpus-PDFs mit `.data`. Haben Sebastians neue PDFs noch keine `.data`, tauchen sie nicht auf. Den Lauf wiederholen, sobald es sie gibt. Die Bilder unter `test-results/visual/baseline/` stichprobenartig ansehen: Die Markierung ist sichtbar und liegt auf den Noten.
- [ ] **Step 7: Commit** `test: add visual comparison harness and old-app baseline capture`

### Task 2: Inkrementeller Writer

**Files:**
- Create: `src/pdfMarkup/incrementalWriter.ts`
- Test: `tests/pdfMarkup/incrementalWriter.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces:
  - `reserveObjectNumbers(base: Uint8Array, context: PDFContext): void` – setzt `context.largestObjectNumber = max(context.largestObjectNumber, prevSize - 1)`, damit neue Objektnummern nicht mit freien Einträgen kollidieren. **Vor** dem Anlegen neuer Objekte aufrufen.
  - `writeIncrementalUpdate(base: Uint8Array, context: PDFContext, refs: PDFRef[]): { bytes: Uint8Array; offsets: Map<number, number> }` – Ergebnis = `base` + (`"\n"`, falls `base` nicht auf EOL endet) + die Objekte `refs`, aufsteigend nach Nummer, als `N G obj … endobj` + Xref-Section + `startxref` + `%%EOF\n`. Die Xref-Art folgt `getXrefKind(base, findLastStartXref(base))`. Bei `stream` bekommt der Xref-Stream eine eigene Ref (`context.nextRef()`) und einen eigenen Eintrag (pdf-lib `PDFCrossRefStream`, Einträge **sortiert** hinzufügen, weil `computeIndex` das voraussetzt). Trailer bzw. Stream-Dict: `/Size` (max. Nummer + 1), `/Prev` (= `findLastStartXref(base)`), `/Root`, `/Info` und `/ID` aus `context.trailerInfo` (falls vorhanden). `offsets` enthält absolute Byte-Offsets je Objektnummer.

- [ ] **Step 1: Failing tests schreiben** (für `table` und `stream` je ein `test.each`)

```ts
test.each(["table", "stream"] as const)("appends a valid update (%s)", async (kind) => {
  const base = await makePdf({ xref: kind });
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  reserveObjectNumbers(base, doc.context);
  const newRef = doc.context.register(doc.context.obj({ Foo: "Bar" }));
  const catalogRef = doc.context.trailerInfo.Root as PDFRef;
  doc.catalog.set(PDFName.of("SMV_Test"), newRef);
  const { bytes, offsets } = writeIncrementalUpdate(base, doc.context, [catalogRef, newRef]);

  expect(Buffer.from(bytes.subarray(0, base.length)).equals(Buffer.from(base))).toBe(true);
  const last = findLastStartXref(bytes);
  expect(getXrefKind(bytes, last)).toBe(kind);
  expect(getSectionTrailer(bytes, last).prev).toBe(findLastStartXref(base));
  const entries = readXrefEntries(bytes, last);
  expect(entries.get(newRef.objectNumber)).toBe(offsets.get(newRef.objectNumber));
  for (const [num, off] of entries)
    expect(Buffer.from(bytes.subarray(off, off + 20)).toString("latin1")).toMatch(new RegExp(`^${num} \\d+ obj`));

  const reloaded = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(reloaded.catalog.get(PDFName.of("SMV_Test"))).toBeInstanceOf(PDFRef);
  const pdfjsDoc = await getDocument({ data: bytes.slice() }).promise; // pdfjs-dist/legacy/build/pdf.mjs
  expect(pdfjsDoc.numPages).toBe(1);
});
```

pdf.js im Test: `import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"`. Falls ein Worker verlangt wird, `GlobalWorkerOptions.workerSrc` auf `pdfjs-dist/legacy/build/pdf.worker.mjs` setzen (einmalig in einem Test-Setup-File).

- [ ] **Step 2: Test** → FAIL.
- [ ] **Step 3: `incrementalWriter.ts` implementieren.** Objekte serialisieren mit `obj.sizeInBytes()` / `obj.copyBytesInto(buf, 0)`. Klassische Einträge: `%010d %05d n\r\n`, Subsections für zusammenhängende Nummern.
- [ ] **Step 4: Test** → PASS.
- [ ] **Step 5: Commit** `feat: add incremental PDF update writer`

### Task 3: Markierungen lesen und schreiben (immer anhängen)

**Files:**
- Create: `src/models/markupConstants.ts` (Werte siehe Global Constraints)
- Create: `src/models/markup.ts`
- Create: `src/pdfMarkup/readMarkup.ts`
- Create: `src/pdfMarkup/buildMarkedPdf.ts`
- Test: `tests/pdfMarkup/buildMarkedPdf.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2.
- Produces (`src/models/markup.ts`, zod-Schemas + abgeleitete Typen):
  - `type Rect = [number, number, number, number]` (PDF-User-Space, normalisiert x0<x1, y0<y1)
  - `markupPayloadSchema = z.object({ version: z.literal(1), width: z.number().positive(), height: z.number().positive(), fabric: z.object({ objects: z.array(z.unknown()) }).passthrough() })`, `type MarkupPayload`. `width`/`height` sind die angezeigte Seitengröße in Punkten (pdf.js-Viewport bei Skala 1, inkl. Rotation). Die fabric-Koordinaten beziehen sich darauf.
  - `interface LoadedMarkupPage { page: number; rect: Rect | null; payload: MarkupPayload }` (`rect: null` = ganze sichtbare Seite)
  - `interface LoadMarkupResult { source: "pdf" | "sidecar" | "none"; pages: LoadedMarkupPage[]; legacyOverlayData: string | null }`
  - `saveMarkupInputSchema = z.object({ path: z.string(), pages: z.array(z.object({ page: z.number().int().positive(), payload: markupPayloadSchema.nullable(), pngBase64: z.string().nullable() })), deleteLegacySidecar: z.boolean() })`, `type SaveMarkupInput`
  - `interface SaveMarkupResult { status: "pdf" | "sidecar" | "error"; message?: string }`
  - `sidecarV1Schema = z.object({ version: z.literal(1), pages: z.array(z.object({ page: z.number().int().positive(), payload: markupPayloadSchema })) })`
- Produces (`readMarkup.ts`):
  - `interface ExistingMarkupPage { page: number; pageRef: PDFRef; annotRef: PDFRef; rect: Rect; payload: MarkupPayload; appearanceRef: PDFRef; dataRef: PDFRef }`
  - `interface MarkupMeta { originalLength: number; updateStart: number }`
  - `interface ReadMarkupResult { pages: ExistingMarkupPage[]; orphans: { page: number; annotRef: PDFRef }[]; meta: MarkupMeta | null; ocgRef: PDFRef | null }`
  - `readMarkup(doc: PDFDocument): ReadMarkupResult`. **Unser Stempel**: `/NM` ist `ANNOT_NM` und `/SMV_Data` ist ein Stream, der sich per `decodePDFRawStream` + `JSON.parse` + `markupPayloadSchema` lesen lässt. **Verwaist**: `/NM` ist `ANNOT_NM` oder `/OC` zeigt auf unsere OCG (per `OCG_NAME` gefunden), aber es gibt keine gültigen Daten. `meta` stammt aus Catalog `/SMV_Markup`.
- Produces (`buildMarkedPdf.ts`):
  - `interface PageChange { page: number; payload: MarkupPayload | null; png: Uint8Array | null }`
  - `rotationMatrix(rotation: number, w: number, h: number): [number, number, number, number, number, number]`, wobei `w`/`h` die **ungedrehte** Rect-Größe sind. Werte: 0 → `[w,0,0,h,0,0]`, 90 → `[0,h,-w,0,w,0]`, 180 → `[-w,0,0,-h,w,h]`, 270 → `[0,-h,w,0,0,h]`. Andere Winkel werden auf ein Vielfaches von 90 normalisiert (z. B. -90 → 270).
  - `buildMarkedPdf(current: Uint8Array, changes: PageChange[]): Promise<Uint8Array>`. In diesem Task **immer anhängen** (Basis = `current`); Task 4 ergänzt die Basiswahl. Ablauf:
    1. Basis laden und `reserveObjectNumbers` aufrufen.
    2. OCG sicherstellen: per Name in `/OCProperties /OCGs` suchen, sonst anlegen als `<< /Type /OCG /Name <UTF-16BE-Hexstring OCG_NAME> >>`. Sie wird in `/OCGs` aufgenommen; existiert `/D /Order`, auch dort. Fehlt `/OCProperties`, entsteht `<< /OCGs [ocg] /D << /Order [ocg] >> >>`.
    3. Für jede geänderte Seite eventuell vorhandene eigene Stempel aus `/Annots` entfernen. Bei `payload !== null` neu anlegen:
       - PNG über `doc.embedPng(png)` + `await image.embed()` einbetten.
       - Form-XObject per `context.flateStream("q a b c d e f cm /Im0 Do Q", { Type: "XObject", Subtype: "Form", BBox: [0,0,w,h], Resources: { XObject: { Im0: imageRef } } })` mit `rotationMatrix(page.getRotation().angle, w, h)`.
       - Daten-Stream per `context.flateStream(JSON.stringify(payload))`.
       - Annotation `<< /Type /Annot /Subtype /Stamp /Rect rect /F 4 /NM (smv-markup-page) /AP << /N form >> /OC ocg /P page /SMV_Data data >>`, wobei `rect` = CropBox ∩ MediaBox der Seite ist.
       - Neues `/Annots` als direktes Array (fremde Annotationen bleiben in Reihenfolge erhalten).
    4. Catalog `/SMV_Markup << /Version 1 /OriginalLength n /UpdateStart m >>` setzen. In diesem Task gilt `n` = vorhandener Wert oder `current.length` und `m = current.length`.
    5. `writeIncrementalUpdate` mit allen neu registrierten Refs (Nummer > Wert vor Schritt 2) plus den geänderten Seiten- und Catalog-Refs aufrufen.

- [ ] **Step 1: Failing tests schreiben**

```ts
const payload = (n = 1): MarkupPayload => ({ version: 1, width: 595, height: 842, fabric: { version: "7.4.0", objects: [{ type: "Rect", left: n }] } });

test.each(["table", "stream"] as const)("round trip (%s)", async (kind) => {
  const orig = await makePdf({ xref: kind, pages: 2, foreignAnnot: true });
  const out = await buildMarkedPdf(orig, [{ page: 1, payload: payload(), png: makePng(10, 10) }]);
  expect(Buffer.from(out.subarray(0, orig.length)).equals(Buffer.from(orig))).toBe(true);
  const r = readMarkup(await PDFDocument.load(out, { updateMetadata: false }));
  expect(r.pages).toHaveLength(1);
  expect(r.pages[0]).toMatchObject({ page: 1, rect: [0, 0, 595, 842], payload: payload() });
  expect(r.meta).toEqual({ originalLength: orig.length, updateStart: orig.length });
});
test("other viewers see a printable stamp in our OCG, foreign annots kept", async () => {
  const out = await buildMarkedPdf(await makePdf({ xref: "stream", foreignAnnot: true }), [{ page: 1, payload: payload(), png: makePng(10, 10) }]);
  const doc = await getDocument({ data: out.slice() }).promise;
  const annots = await (await doc.getPage(1)).getAnnotations();
  expect(annots.map((a: any) => a.subtype).sort()).toEqual(["Square", "Stamp", "Text"]);
  const groups = [...(await doc.getOptionalContentConfig())].map(([, g]: any) => g.name);
  expect(groups).toContain(OCG_NAME);
});
test("rotationMatrix", () => {
  expect(rotationMatrix(0, 2, 3)).toEqual([2, 0, 0, 3, 0, 0]);
  expect(rotationMatrix(90, 2, 3)).toEqual([0, 3, -2, 0, 2, 0]);
  expect(rotationMatrix(180, 2, 3)).toEqual([-2, 0, 0, -3, 2, 3]);
  expect(rotationMatrix(270, 2, 3)).toEqual([0, -3, 2, 0, 0, 3]);
  expect(rotationMatrix(-90, 2, 3)).toEqual(rotationMatrix(270, 2, 3));
});
test("rect follows crop box", async () => {
  const out = await buildMarkedPdf(await makePdf({ xref: "table", cropBox: [50, 60, 400, 700] }), [{ page: 1, payload: payload(), png: makePng(4, 4) }]);
  expect(readMarkup(await PDFDocument.load(out, { updateMetadata: false })).pages[0].rect).toEqual([50, 60, 400, 700]);
});
test("negative MediaBox origin and mixed page sizes", async () => {
  const boxes: [number, number, number, number][] = [[-22.5, -56.8, 572.7, 785.0], [0, 0, 1728, 2340]];
  const out = await buildMarkedPdf(await makePdf({ xref: "stream", pages: 2, mediaBoxes: boxes }), [
    { page: 1, payload: payload(), png: makePng(4, 4) },
    { page: 2, payload: { ...payload(), width: 1728, height: 2340 }, png: makePng(4, 4) },
  ]);
  const r = readMarkup(await PDFDocument.load(out, { updateMetadata: false }));
  expect(r.pages.map((p) => p.rect)).toEqual(boxes);
});
test("encrypted PDFs are rejected", async () => {
  await expect(buildMarkedPdf(markEncrypted(await makePdf({ xref: "table" })), [])).rejects.toThrow(EncryptedPDFError);
});
```

- [ ] **Step 2: Test** → FAIL.
- [ ] **Step 3: `markupConstants.ts`, `markup.ts`, `readMarkup.ts` und `buildMarkedPdf.ts` implementieren.**
- [ ] **Step 4: Test** → PASS.
- [ ] **Step 5: Commit** `feat: write markup stamps into PDFs`

### Task 4: Basiswahl – ersetzen statt wachsen, fremde Updates, verwaiste Stempel

**Files:**
- Modify: `src/pdfMarkup/buildMarkedPdf.ts`
- Test: `tests/pdfMarkup/buildMarkedPdf.base.test.ts`

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  - `isOurUpdateLast(bytes: Uint8Array, updateStart: number): boolean`. Wahr genau dann, wenn alle drei Bedingungen gelten:
    - `isValidSectionEnd(bytes, updateStart)`
    - `X = findLastStartXref(bytes) >= updateStart`
    - `getSectionTrailer(bytes, X).prev < updateStart`
  - `chooseBase(current: Uint8Array, meta: MarkupMeta | null): { baseLength: number; originalLength: number }`:
    - `originalLength` = `meta.originalLength`, falls `meta` gesetzt ist und `isValidSectionEnd(current, meta.originalLength)` gilt, sonst `current.length` (erstes Speichern oder Datei komplett neu geschrieben).
    - `baseLength` = `meta.updateStart`, wenn das Original gültig ist **und** `isOurUpdateLast(current, meta.updateStart)` gilt, sonst `current.length`.
  - `buildMarkedPdf` nutzt jetzt `chooseBase`:
    - Der aktuelle Stand wird aus `current` gelesen (`readMarkup` auf dem vollen Dokument), geschrieben wird auf `current.subarray(0, baseLength)`.
    - Unveränderte Seiten mit Markierung, die in der Basis fehlen, werden übernommen: `appearanceRef` und `dataRef` per `PDFObjectCopier.for(fullCtx, baseCtx).copy(...)` kopieren, mit dem bisherigen `rect` neu annotieren.
    - Verwaiste Stempel (aus `readMarkup`) werden auf jeder betroffenen Seite neu geschrieben: ohne `/OC`, mit `/NM (smv-markup-orphan)`. Nie löschen.
    - `/UpdateStart` = `baseLength`.
    - Sonderfall: Wenn danach keine Seite Markierungen hat, keine verwaisten Stempel existieren und `baseLength === originalLength`, wird `current.slice(0, originalLength)` zurückgegeben (alles gelöscht = Original).

- [ ] **Step 1: Failing tests schreiben**

```ts
test("repeated saves do not grow the file", async () => {
  const orig = await makePdf({ xref: "stream", pages: 2 });
  const a = await buildMarkedPdf(orig, [{ page: 1, payload: payload(1), png: makePng(8, 8) }]);
  const b = await buildMarkedPdf(a, [{ page: 1, payload: payload(1), png: makePng(8, 8) }]);
  expect(b.length).toBe(a.length);
  expect(countStartXref(b)).toBe(countStartXref(orig) + 1);
});
test("unchanged pages survive a replace", async () => {
  const a = await buildMarkedPdf(await makePdf({ xref: "table", pages: 2 }), [{ page: 1, payload: payload(1), png: makePng(8, 8) }]);
  const b = await buildMarkedPdf(a, [{ page: 2, payload: payload(2), png: makePng(8, 8) }]);
  const r = readMarkup(await PDFDocument.load(b, { updateMetadata: false }));
  expect(r.pages.map((p) => [p.page, p.payload.fabric.objects])).toEqual([[1, payload(1).fabric.objects], [2, payload(2).fabric.objects]]);
});
test("removing everything restores the original bytes", async () => {
  const orig = await makePdf({ xref: "stream" });
  const a = await buildMarkedPdf(orig, [{ page: 1, payload: payload(), png: makePng(8, 8) }]);
  expect(Buffer.from(await buildMarkedPdf(a, [{ page: 1, payload: null, png: null }])).equals(Buffer.from(orig))).toBe(true);
});
test("foreign update after ours is kept", async () => {
  const a = await buildMarkedPdf(await makePdf({ xref: "table" }), [{ page: 1, payload: payload(1), png: makePng(8, 8) }]);
  const foreign = await appendForeignUpdate(a); // Helfer: setzt /Info /Title per writeIncrementalUpdate
  const b = await buildMarkedPdf(foreign, [{ page: 1, payload: payload(2), png: makePng(8, 8) }]);
  expect(Buffer.from(b.subarray(0, foreign.length)).equals(Buffer.from(foreign))).toBe(true);
  const c = await buildMarkedPdf(b, [{ page: 1, payload: payload(2), png: makePng(8, 8) }]);
  expect(c.length).toBe(b.length);
});
test("fully rewritten file becomes the new original", async () => {
  const a = await buildMarkedPdf(await makePdf({ xref: "table" }), [{ page: 1, payload: payload(1), png: makePng(8, 8) }]);
  const rewritten = await (await PDFDocument.load(a, { updateMetadata: false })).save();
  const b = await buildMarkedPdf(rewritten, [{ page: 1, payload: payload(2), png: makePng(8, 8) }]);
  expect(Buffer.from(b.subarray(0, rewritten.length)).equals(Buffer.from(rewritten))).toBe(true);
  expect(readMarkup(await PDFDocument.load(b, { updateMetadata: false })).meta?.originalLength).toBe(rewritten.length);
});
test("orphaned stamps are never deleted and leave our OCG", async () => {
  const a = await buildMarkedPdf(await makePdf({ xref: "table" }), [{ page: 1, payload: payload(), png: makePng(8, 8) }]);
  const stripped = await stripSmvData(a); // Helfer: entfernt /SMV_Data der Annotation per fremdem Update
  expect(readMarkup(await PDFDocument.load(stripped, { updateMetadata: false })).orphans).toHaveLength(1);
  const b = await buildMarkedPdf(stripped, []);
  const annots = await (await (await getDocument({ data: b.slice() }).promise).getPage(1)).getAnnotations();
  expect(annots).toHaveLength(1);
  const r = readMarkup(await PDFDocument.load(b, { updateMetadata: false }));
  expect(r.orphans).toHaveLength(0); // NM ist jetzt smv-markup-orphan, /OC fehlt
});
describe.skipIf(!fs.existsSync("Noten"))("real sheets in Noten/", () => {
  test.each(fs.existsSync("Noten") ? fs.readdirSync("Noten").filter((f) => f.endsWith(".pdf")) : [])("%s", async (f) => {
    const orig = new Uint8Array(fs.readFileSync(path.join("Noten", f)));
    const before = await annotationsPerPage(orig); // Helfer: pdf.js → je Seite [{subtype, rect}]
    const changes = before.map((_, i) => ({ page: i + 1, payload: payload(i), png: makePng(8, 8) }));
    const a = await buildMarkedPdf(orig, changes);

    expect(Buffer.from(a.subarray(0, orig.length)).equals(Buffer.from(orig))).toBe(true);
    const after = await annotationsPerPage(a);
    expect(after).toHaveLength(before.length);
    after.forEach((annots, i) => {
      expect(annots.filter((x) => !x.isOurs)).toEqual(before[i]); // fremde unverändert
      expect(annots.filter((x) => x.isOurs)).toHaveLength(1);
    });
    expect((await buildMarkedPdf(a, changes)).length).toBe(a.length);
    const cleared = await buildMarkedPdf(a, changes.map((c) => ({ ...c, payload: null, png: null })));
    expect(Buffer.from(cleared).equals(Buffer.from(orig))).toBe(true);
  }, 120_000);
});
```

`countStartXref`, `appendForeignUpdate`, `stripSmvData` und `annotationsPerPage(bytes): Promise<{ subtype: string; rect: number[]; isOurs: boolean }[][]>` kommen nach `tests/pdfMarkup/fixtures.ts`. `isOurs` erkennt unseren Stempel an der Kennung, die pdf.js als `annotationName` liefert (`/NM`). Dorthin wandert auch `payload()` aus Task 3.

- [ ] **Step 2: Test** → FAIL.
- [ ] **Step 3: `isOurUpdateLast`, `chooseBase` und die Erweiterungen von `buildMarkedPdf` implementieren.**
- [ ] **Step 4: Alle Tests (`npm test`)** → PASS.
- [ ] **Step 5: Commit** `feat: replace previous markup update instead of growing the PDF`

### Task 5: Datei-Schicht und tRPC

**Files:**
- Create: `src/pdfMarkup/markupFile.ts` (kein Electron-Import)
- Modify: `src/trcpRouter.ts` (neue Prozeduren neben den alten; die alten entfernt Task 7)
- Test: `tests/pdfMarkup/markupFile.test.ts` (eigenes Temp-Verzeichnis je Test)

**Interfaces:**
- Consumes: `buildMarkedPdf`, `readMarkup`, Schemas aus Task 3.
- Produces:
  - `getSidecarPath(pdfPath: string): string` – gleiche Logik wie `getOverlayDataFilePathFromSheetPath` in `src/trcpLib.ts` (`.<name>.data`).
  - `loadMarkupFromFile(pdfPath: string): Promise<LoadMarkupResult>`:
    - Verschlüsselte PDF → Begleitdatei auswerten.
    - Hat die PDF eigene Seiten oder `meta` → `source: "pdf"`, die Begleitdatei wird ignoriert.
    - Sonst Begleitdatei: v1 → `source: "sidecar"` (`rect: null`). Altes Format (alles, was nicht `sidecarV1Schema` entspricht) → `source: "none"`, `legacyOverlayData` = Rohtext.
    - Gibt es verwaiste Stempel und ist die Datei beschreibbar, wird zuerst `buildMarkedPdf(bytes, [])` atomar geschrieben.
  - `saveMarkupToFile(input: SaveMarkupInput): Promise<SaveMarkupResult>`, pro `path` serialisiert (Promise-Kette in einer `Map`):
    1. Datei lesen. `EncryptedPDFError` oder nicht beschreibbar (`fs.access` W_OK für Datei und Ordner):
       - ohne eingebettete Daten → v1-Begleitdatei schreiben (bestehende v1 mergen, `payload: null` entfernt die Seite) → `{ status: "sidecar" }`
       - mit eingebetteten Daten → `{ status: "error", message }`
    2. Sonst `buildMarkedPdf` aufrufen (PNG aus Base64), das Ergebnis nach `<dir>/.<name>.smv-tmp` schreiben, zurücklesen und prüfen, dass `readMarkup` genau die erwarteten Seitennummern liefert. Danach `fs.rename` auf die PDF.
    3. Bei jedem Fehler: Temp-Datei löschen, PDF unverändert lassen → `{ status: "error", message }`.
    4. Erfolg + `deleteLegacySidecar` → Begleitdatei löschen, falls vorhanden.
  - `src/trcpRouter.ts`: `loadMarkup: publicProcedure.input(z.string()).query(({ input }) => loadMarkupFromFile(input))`, `saveMarkup: publicProcedure.input(saveMarkupInputSchema).mutation(({ input }) => saveMarkupToFile(input))`.

- [ ] **Step 1: Failing tests schreiben**

```ts
test("saves into the PDF atomically", async () => {
  const pdf = await writeFixture(dir, "a.pdf", await makePdf({ xref: "stream" }));
  expect(await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).toEqual({ status: "pdf" });
  expect((await loadMarkupFromFile(pdf)).pages).toHaveLength(1);
  expect(fs.readdirSync(dir).filter((f) => f.includes("smv-tmp"))).toEqual([]);
});
test("legacy sidecar is reported and deleted only after a successful PDF save", async () => {
  const pdf = await writeFixture(dir, "a.pdf", await makePdf({ xref: "table" }));
  fs.writeFileSync(getSidecarPath(pdf), JSON.stringify([{ page: 1, data: { objects: [] }, drawWidth: 100, drawHeight: 140 }]));
  expect((await loadMarkupFromFile(pdf)).legacyOverlayData).not.toBeNull();
  await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: true });
  expect(fs.existsSync(getSidecarPath(pdf))).toBe(false);
});
test("embedded data wins over a sidecar", async () => { /* PDF mit Markierung + v1-Sidecar mit anderer Seite → source "pdf", nur PDF-Seiten */ });
test("encrypted PDF falls back to a v1 sidecar", async () => {
  const pdf = await writeFixture(dir, "e.pdf", markEncrypted(await makePdf({ xref: "table" })));
  const before = fs.readFileSync(pdf);
  expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).status).toBe("sidecar");
  expect(fs.readFileSync(pdf).equals(before)).toBe(true);
  expect(await loadMarkupFromFile(pdf)).toMatchObject({ source: "sidecar", pages: [{ page: 1, rect: null }] });
});
test("read-only PDF with embedded data reports an error and stays unchanged", async () => {
  const pdf = await writeFixture(dir, "r.pdf", await makePdf({ xref: "table" }));
  await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false });
  fs.chmodSync(pdf, 0o444);
  const before = fs.readFileSync(pdf);
  expect((await saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false })).status).toBe("error");
  expect(fs.readFileSync(pdf).equals(before)).toBe(true);
  expect(fs.existsSync(getSidecarPath(pdf))).toBe(false);
});
test("rename failure (EBUSY) reports an error, PDF unchanged, no temp left", async () => {
  vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }));
  // … status "error", Datei-Bytes unverändert, keine *.smv-tmp
});
test("concurrent saves are serialized", async () => {
  const pdf = await writeFixture(dir, "c.pdf", await makePdf({ xref: "stream", pages: 2 }));
  await Promise.all([
    saveMarkupToFile({ path: pdf, pages: [page1()], deleteLegacySidecar: false }),
    saveMarkupToFile({ path: pdf, pages: [page2()], deleteLegacySidecar: false }),
  ]);
  expect((await loadMarkupFromFile(pdf)).pages.map((p) => p.page)).toEqual([1, 2]);
});
test("orphans are repaired on load", async () => { /* stripSmvData-Fixture → nach load hat readMarkup keine orphans mehr, Annotation existiert noch */ });
```

`page1()` und `page2()` liefern `{ page, payload, pngBase64 }` mit `makePng`. `writeFixture(dir, name, bytes)` schreibt die Datei und gibt den Pfad zurück. Alle drei kommen nach `fixtures.ts`. Für den EBUSY-Mock muss `markupFile.ts` `fs.promises.rename` (bzw. `fs-extra`) über das Modulobjekt aufrufen, damit der Spy greift.

- [ ] **Step 2: Test** → FAIL.
- [ ] **Step 3: `markupFile.ts` und die Router-Einträge implementieren.**
- [ ] **Step 4: `npm test` und `npx tsc --noEmit -p .`** → PASS bzw. keine Fehler.
- [ ] **Step 5: Commit** `feat: load and save markup through the PDF file`

### Task 6: Renderer-Helfer (Koordinaten, PNG)

**Files:**
- Create: `src/markup/fabricTransform.ts` (rein, ohne fabric/DOM)
- Create: `src/markup/renderPng.ts` (fabric, DOM; nur manuell geprüft)
- Test: `tests/markup/fabricTransform.test.ts`

**Interfaces:**
- Consumes: `MarkupPayload`, `Rect` (Task 3), `OverlayData` (bestehend in `src/models/types.ts`, bleibt als Legacy-Typ), Konstanten.
- Produces:
  - `interface Transform2D { sx: number; sy: number; tx: number; ty: number }` (x' = tx + x·sx, y' = ty + y·sy)
  - `transformFabricJson<T extends { objects: unknown[] }>(json: T, t: Transform2D): T`, auf einer Kopie: für jedes **Top-Level**-Objekt `left = tx + left·sx`, `top = ty + top·sy`, `scaleX *= sx`, `scaleY *= sy`.
  - `displayTransform(viewRect: Rect | null, payload: MarkupPayload, viewport: { width: number; height: number }, cssWidth: number): Transform2D`. `viewRect` ist der Annotations-Rect in Viewport-Koordinaten bei Skala 1, `null` steht für `[0, 0, viewport.width, viewport.height]`. Mit `k = cssWidth / viewport.width` gilt: `sx = (vr[2]-vr[0]) / payload.width · k`, `sy = (vr[3]-vr[1]) / payload.height · k`, `tx = vr[0]·k`, `ty = vr[1]·k`.
  - `payloadFromCanvas(json: { objects: unknown[] }, cssWidth: number, viewport: { width: number; height: number }): MarkupPayload` (Skalierung 1/k, `width`/`height` = Viewport)
  - `legacyToPayload(legacy: OverlayData, viewport: { width: number; height: number }): MarkupPayload` (`sx = viewport.width / drawWidth`, `sy = viewport.height / drawHeight`, wie das bisherige getrennte Skalieren)
  - `pngMultiplier(width: number, height: number): number` = `min(MARKUP_DPI / 72, MAX_PNG_SIDE_PX / max(width, height))`
  - `renderMarkupPng(payload: MarkupPayload): Promise<string>` (Base64 ohne `data:`-Präfix). Ablauf: `new fabric.StaticCanvas(undefined, { width, height })`, `loadFromJSON(payload.fabric)`, `toDataURL({ format: "png", multiplier: pngMultiplier(...) })`, danach `dispose()`. Vorher wie bisher die Schrift `notoIcons` per fontfaceobserver laden.

- [ ] **Step 1: Failing tests schreiben**

```ts
test("transformFabricJson", () => {
  const out = transformFabricJson({ objects: [{ left: 10, top: 20, scaleX: 1, scaleY: 2 }] }, { sx: 2, sy: 3, tx: 5, ty: 7 });
  expect(out.objects[0]).toMatchObject({ left: 25, top: 67, scaleX: 2, scaleY: 6 });
});
test("display ↔ payload round trip", () => {
  const vp = { width: 595, height: 842 };
  const p = payloadFromCanvas({ objects: [{ left: 119, top: 168.4, scaleX: 1, scaleY: 1 }] }, 1190, vp);
  expect(p.fabric.objects[0]).toMatchObject({ left: 59.5, top: 84.2, scaleX: 0.5, scaleY: 0.5 });
  const back = transformFabricJson(p.fabric, displayTransform(null, p, vp, 1190));
  expect(back.objects[0]).toMatchObject({ left: 119, top: 168.4, scaleX: 1, scaleY: 1 });
});
test("moved/scaled annotation rect is followed", () => {
  const t = displayTransform([100, 100, 397.5, 521], { version: 1, width: 595, height: 842, fabric: { objects: [] } }, { width: 595, height: 842 }, 595);
  expect(t).toEqual({ sx: 0.5, sy: 0.5, tx: 100, ty: 100 });
});
test("legacyToPayload", () => {
  const p = legacyToPayload({ page: 1, data: { objects: [{ left: 50, top: 70, scaleX: 1, scaleY: 1 }] }, drawWidth: 100, drawHeight: 140 }, { width: 595, height: 842 });
  expect(p.fabric.objects[0]).toMatchObject({ left: 297.5, top: 421 });
});
test("pngMultiplier caps huge pages", () => {
  expect(pngMultiplier(595, 842)).toBeCloseTo(300 / 72);
  expect(pngMultiplier(2384, 3370) * 3370).toBeLessThanOrEqual(4096); // A0
});
```

- [ ] **Step 2: Test** → FAIL.
- [ ] **Step 3: `fabricTransform.ts` und `renderPng.ts` implementieren.**
- [ ] **Step 4: Test** → PASS.
- [ ] **Step 5: Commit** `feat: add markup coordinate and PNG helpers`

### Task 7: SheetViewer anbinden, alte Begleitdatei-Logik entfernen

**Files:**
- Modify: `src/views/SheetViewer.vue` (Laden ~L222, pdf.js `getDocument` ~L225, `saveDrawnData` ~L593, `createFabricCanvas` ~L680-760, `populateOverlayCanvas`/`createOverlay` ~L781-850, `renderPage` ~L925-975, Template: Snackbar)
- Modify: `src/trcpRouter.ts`, `src/trcpLib.ts` (Entfernen: `saveOverlayData`, `loadOverlayData`, `saveOverlayDataInputSchema`, `getOverlayDataFilePathFromSheetPath`)

**Interfaces:**
- Consumes: `client.loadMarkup`, `client.saveMarkup` (Task 5), alle Helfer aus Task 6, `OCG_NAME`.

Zustand im Component (ersetzt `overlayData: OverlayData[]`):
`markupPages: Map<number, { rect: Rect | null; payload: MarkupPayload }>`, `dirtyPages: Set<number>`, `deleteLegacyOnNextSave: boolean`, `sidecarHintShown: boolean`, `saveChain: Promise<void>`.

- [ ] **Step 1: Laden umstellen.**
  - `loadMarkup` (vor `getDocument`, wie bisher) füllt `markupPages`.
  - Bei `source: "sidecar"`: alle Seiten in `dirtyPages`, `deleteLegacyOnNextSave = true`.
  - Bei `legacyOverlayData`: nach dem Laden der PDF jede Seite mit `legacyToPayload(entry, page.getViewport({ scale: 1 }))` umrechnen, alle Seiten in `dirtyPages`, `deleteLegacyOnNextSave = true`, dann sofort `persistMarkup()`.
- [ ] **Step 2: pdf.js anpassen.**
  - `getDocument` bekommt zusätzlich `disableRange: true, disableStream: true, disableAutoFetch: true`.
  - Nach dem Laden `const occ = await pdf.getOptionalContentConfig()`. Für jede Gruppe mit `name === OCG_NAME` wird `occ.setVisibility(id, false)` aufgerufen.
  - `renderPage` übergibt `optionalContentConfigPromise: Promise.resolve(occ)`.
- [ ] **Step 3: Anzeigen umstellen.**
  - `createOverlay` und `createFabricCanvas` laden `transformFabricJson(payload.fabric, displayTransform(viewRect, payload, viewportScale1, cssWidth))`.
  - `viewRect` = `rect` per `viewport.convertToViewportRectangle(rect)` (Skala 1) umgerechnet und normalisiert, `null` bleibt `null`.
  - Die Reviver-Skalierung und `drawWidth`/`drawHeight` fallen weg.
- [ ] **Step 4: Speichern umstellen.**
  - `saveDrawnData` setzt `markupPages` auf `{ rect: null, payload: payloadFromCanvas(...) }`, bei 0 Objekten wird der Eintrag gelöscht. Die Seite kommt in `dirtyPages`, danach `persistMarkup()`.
  - `persistMarkup()` hängt sich an `saveChain` an. Es rendert für jede Dirty-Seite mit Payload `renderMarkupPng`, ohne Payload gilt `payload: null, pngBase64: null`. Dann ruft es `client.saveMarkup.mutate({ path, pages, deleteLegacySidecar: deleteLegacyOnNextSave })` auf.
  - Bei `pdf`/`sidecar` werden die gesendeten Seiten aus `dirtyPages` entfernt und `deleteLegacyOnNextSave = false` gesetzt.
  - Bei `sidecar` erscheint einmal pro Öffnen eine Snackbar: „Diese PDF kann nicht beschrieben werden. Markierungen werden in einer Begleitdatei gespeichert.“
  - Bei `error` erscheint eine Snackbar: „Markierungen konnten nicht in die PDF gespeichert werden (ist sie in einem anderen Programm geöffnet?). Beim nächsten Speichern wird es erneut versucht.“ Die Seiten bleiben dirty.
  - `onBeforeUnmount`: Sind noch Seiten dirty, ein letztes `persistMarkup()` anstoßen.
- [ ] **Step 5: Alte Prozeduren und Funktionen aus Router und `trcpLib.ts` entfernen.** `npm run lint`, `npx tsc --noEmit -p .` und `npm test` müssen fehlerfrei durchlaufen.
- [ ] **Step 6: Manuell prüfen** mit `npm start` und dem Ordner `Noten/` (vorher Kopie sichern):
  1. `Pilatus - Alt-Sax 1.pdf` öffnen. `.Pilatus - Alt-Sax 1.data` verschwindet, die PDF ist größer geworden, und die Markierung erscheint **genau einmal**. Erscheint sie doppelt, beachtet pdf.js `/OC` an Annotationen nicht. Dann stoppen und melden; der Fallback wäre `annotationMode: AnnotationMode.ENABLE_FORMS` mit eigenem Ausfiltern, und das braucht eine Entscheidung.
  2. Zeichnen, Bearbeitungsmodus verlassen, App neu starten: Die Markierung ist da und einzeln bearbeitbar.
  3. Mehrmals speichern: Die Dateigröße bleibt bei gleichem Inhalt stabil.
  4. Nach dem Speichern das Fenster vergrößern bzw. verkleinern: Die Seiten rendern korrekt (Review Focus 5).
  5. Die PDF in einem anderen Viewer öffnen (Chromium über Playwright-MCP oder Edge/Acrobat unter Windows durch Sebastian): Der Stempel ist sichtbar und in der Druckvorschau enthalten.
- [ ] **Step 7: Commit** `feat: store sheet markup inside the PDF`

### Task 8: Visueller Vergleich neue gegen alte App und Offline-Nachweis

**Files:**
- Create: `tests/visual/compare.visual.ts`
- Modify (nur falls Abweichungen gefunden werden): der jeweils verursachende Code aus Task 3–7

**Interfaces:**
- Consumes: alles aus Task 1b (`ensureBaseline`, `currentApp`, `openSheet`, `copyCorpus`, `listCorpus`, `renderPdfPage`, `diffRatio`, `markupMask`, `maskMetrics`, `sideBySide`), `OCG_NAME`.

Ablauf pro Korpus-PDF, ein Test je PDF:
1. `ensureBaseline()` und `currentApp()`, frische `copyCorpus`-Kopie.
2. Neue App öffnen. Dabei läuft die Migration. Für jede markierte Seite `captureView` → **V1**. Prüfen, dass die `.data` gelöscht und die PDF größer ist.
3. Bearbeitungsmodus ein- und ausschalten, damit gespeichert wird. App schließen, neu öffnen, `captureView` → **V2**.
4. Für jede markierte Seite die migrierte PDF in Node rendern, in CSS-Breite des Captures: `renderPdfPage(..., { annotations: true })` → **P_on**, mit `hideOcgNamed: OCG_NAME` → **P_off**. Die Original-PDF (aus `Noten/`) mit `annotations: true` → **P_orig**.
5. Vergleiche gegen die Referenz `R` (`edit-with`/`edit-without` der alten App), Schwellen aus Spec 8:

| | Vergleich | Pixel | Maske |
|---|---|---|---|
| A | V1.with ↔ R.with | `ratio ≤ 0.001` | `iou ≥ 0.98`, `offset ≤ 1` (Maske V1 = V1.with − V1.without) |
| B | V2.with ↔ R.with | `ratio ≤ 0.001` | `iou ≥ 0.98`, `offset ≤ 1` |
| C | Maske(P_on − P_off) ↔ Maske(R.with − R.without) | – | `iou ≥ 0.90`, `offset ≤ 1` |
| D | P_off ↔ P_orig | `ratio ≤ 0.001` | – |
| E | V1.without ↔ R.without | `ratio ≤ 0.001` | – (beweist: keine doppelte Markierung, Seite unverändert) |

6. `networkRequests()` aller Sessions der neuen App ist leer (Offline-Nachweis).
7. Bei jeder Verletzung: `sideBySide(Referenz, Neu, diff)` nach `test-results/visual/diff/<pdf>/<page>-<A|B|C|D|E>.png`, Messwerte in die Fehlermeldung.

- [ ] **Step 1: `compare.visual.ts` schreiben** (wie oben).
- [ ] **Step 2: `npm run test:visual`** → zunächst Fehler erwartet oder möglich. Jede Abweichung anhand der Diff-Bilder untersuchen (superpowers:systematic-debugging). Typische Ursachen und wo sie liegen:
  - Versatz um einen konstanten Betrag → Rect/CropBox oder negativer Ursprung (Task 3, `viewRect`-Umrechnung in Task 7)
  - Skalierung → `displayTransform`/`legacyToPayload` (Task 6)
  - Fehler nur bei gedrehten Seiten → `rotationMatrix` (Task 3)
  - E schlägt fehl → OCG wird nicht ausgeblendet (Task 7, Step 2)

  Schwellen werden **nicht** gelockert, ohne dass Sebastian zustimmt.
- [ ] **Step 3: `npm run test:visual`** → PASS für alle Korpus-PDFs. `npm test` und `npm run lint` → PASS.
- [ ] **Step 4: Den Test-Ablauf auf Windows dokumentieren.** Kurzer Abschnitt in `AGENTS.md` unter „Build & Run“: `npm run test:visual`, benötigt `Noten/` mit `.data`-Dateien, Ausgaben in `test-results/visual/`. Sebastian führt den Lauf einmal unter Windows aus.
- [ ] **Step 5: Commit** `test: compare migrated markup against the old app visually`
