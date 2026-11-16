# Sammelmigration der `.data`-Markierungen – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beim Start (und nach jedem Ordnerwechsel) werden alle `.data`-Begleitdateien im Notenordner nach einer geprüften ZIP-Sicherung in ihre PDFs übernommen, mit sperrendem Fortschrittsfenster und Zusammenfassung.

**Architecture:** Das Hauptprogramm sucht Kandidaten, führt die Liste bleibender Fehler, schreibt und prüft die ZIP und speichert wie bisher (`saveMarkupToFile`, jetzt mit Fehlergrund). Ein framework-freier Ablauf im Renderer (`BulkMigration`) steuert Sicherung → Datei für Datei → Zusammenfassung; jede Datei wird mit derselben Umwandlung migriert wie beim Öffnen (aus `SheetViewer.vue` in `src/markup/legacyMigration.ts` gezogen). Ein Pinia-Store und `MigrationDialog.vue` binden das an die App.

**Tech Stack:** TypeScript, Electron/tRPC (electron-trpc, Subscriptions als async generator), Vue 3 + Vuetify 4 + Pinia, pdfjs-dist, fabric, pdf-lib 1.17.1, neu: `yazl` 3.3.1 / `yauzl` 3.4.0, vitest, Playwright `_electron`.

**Spec:** `docs/superpowers/specs/2026-11-16-bulk-markup-migration-design.md` (baut auf `docs/superpowers/specs/2026-11-15-markup-in-pdf-design.md`)

## Global Constraints

- Offline: kein Netzwerkzugriff. Neue Dependencies exakt gepinnt: `yazl` `3.3.1`, `yauzl` `3.4.0` (dependencies), `@types/yazl` `3.3.1`, `@types/yauzl` `3.4.0` (devDependencies); alle MIT.
- Bestehende Regeln bleiben: atomares Schreiben mit Read-back, Sidecar-Fallback nur ohne eingebettete Daten, `.data` wird nur nach erfolgreichem Read-back gelöscht (`deleteLegacySidecar: true`), „eingebettete Daten gewinnen“. Das Verhalten beim Öffnen einer PDF (`SheetViewer.vue`) bleibt unverändert.
- Module unter `src/migration/` und `src/pdfMarkup/` importieren nichts aus `electron` (unit-testbar in Node); Electron-Pfade (z. B. `app.getPath("userData")`) werden in `src/trcpRouter.ts` hineingereicht.
- ZIP-Name: `Markierungen-Backup YYYY-MM-DD HH-MM.zip` (Ortszeit) im Hauptordner, bei Kollision ` (2)`, ` (3)` … vor `.zip`. Temporäre Datei: `.Markierungen-Backup-<zufällig>.zip.tmp` im Hauptordner.
- UI-Texte (deutsch, wörtlich):
  - Titel: `Markierungen werden in die PDFs übernommen`
  - Sicherungsphase: `Sicherung wird erstellt …`
  - Fortschritt: `{i} von {n}` und darunter der relative Pfad der aktuellen Datei
  - Knöpfe: `Abbrechen`, `OK`
  - Zusammenfassung: `{n} Dateien übernommen.` (bei 1: `1 Datei übernommen.`), Zeile `Sicherung: {zipName}` (nur wenn eine ZIP entstand), Überschrift `Nicht übernommen:` mit Zeilen `{relativer Pfad} – {Grund}`, bei Abbruch `Abgebrochen. {k} Dateien folgen beim nächsten Start.` (bei 1: `1 Datei folgt beim nächsten Start.`)
  - Sicherung fehlgeschlagen: `Die Sicherung konnte nicht erstellt werden ({Meldung}). Es wurde nichts übernommen; beim nächsten Start wird es erneut versucht.`
  - Gründe: `corruptData` → `Alte Markierungsdatei ist beschädigt`; `alreadyEmbedded` → `PDF enthält bereits Markierungen; alte Datei bleibt liegen`; `notWritable` → `PDF kann nicht beschrieben werden`; `locked` → `Datei ist in einem anderen Programm geöffnet`; `notBackedUp` → `Datei konnte nicht gesichert werden`; `pendingChanges` → `Ungespeicherte Änderungen; wird beim nächsten Start übernommen`; `other` → `Unbekannter Fehler: {Meldung}`.
  - Bleibend sind genau `corruptData`, `alreadyEmbedded`, `notWritable`; alle anderen sind vorübergehend.
- Test-Schalter: Umgebungsvariable `SMV_DISABLE_BULK_MIGRATION=1` lässt die Kandidatensuche im Hauptprogramm eine leere Liste liefern (nur für Tests, die den Öffnen-Weg prüfen).
- Alle GUI-/Electron-Tests headless; `Noten/` nie direkt öffnen oder beschreiben, nur Kopien (`copyCorpus`).
- Commits: Conventional Commits mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; nur die Dateien des Tasks stagen.

## Review Focus

1. **Datei verschwindet zwischen Suche und Migration** (Nextcloud benennt um/löscht): kein Absturz, die Datei zählt als vorübergehend nicht übernommen, der Rest läuft. → Tests in Task 3 (`excludes a file that vanished`) und Task 5 (`a vanished file fails as other, the run continues`).
2. **Absturz mitten in der Sicherung** hinterlässt `.Markierungen-Backup-*.zip.tmp`: der nächste Lauf räumt sie weg, sie taucht nie in der App auf. → Task 3 (`removes stale temp files before writing`).
3. **`.data` ohne PDF** (PDF gelöscht/umbenannt): ist kein Kandidat und bleibt unangetastet. → Task 2 (`ignores a sidecar without a pdf`).
4. **Zweiter Auslöser während einer laufenden Migration** (Ordnerwechsel, doppelter Watch): es läuft trotzdem nur eine. → Task 5 (`a second run while running returns the running one`).
5. **Viele Dateien hintereinander**: pdf.js-Dokumente werden nach jeder Datei freigegeben, auch im Fehlerfall. → Task 5 (`destroys every loaded pdf, also on failure`).

---

### Task 1: Fehlergrund beim Speichern, PDF-Zustand beim Laden, leere `.data` löschen

**Files:**
- Modify: `src/models/markup.ts` (`SaveMarkupResult`, `LoadMarkupResult`)
- Modify: `src/pdfMarkup/markupFile.ts`
- Test: `tests/pdfMarkup/markupFile.test.ts`

**Interfaces:**
- Produces:
  - `type SaveFailureReason = "locked" | "readOnly" | "encrypted" | "unparseable" | "other"` (in `src/models/markup.ts`)
  - `SaveMarkupResult { status: "pdf" | "sidecar" | "error"; message?: string; reason?: SaveFailureReason }` – `reason` gesetzt bei `sidecar` (warum nicht in die PDF) und `error`.
  - `LoadMarkupResult` bekommt `pdfIssue: "encrypted" | "unparseable" | null`.
  - `legacySidecarHasMarkup(text: string): boolean` und `discardEmptyLegacySidecar(pdfPath: string): Promise<{ deleted: boolean }>` (export aus `markupFile.ts`; serialisiert pro Pfad wie Laden/Speichern).

- [ ] **Step 1: Failing tests** in `tests/pdfMarkup/markupFile.test.ts`:
  - `reports readOnly when a pdf without data is not writable` → `{ status: "sidecar", reason: "readOnly" }`
  - `reports encrypted` (Fixture `markEncrypted`) → `status: "sidecar", reason: "encrypted"`; `reports unparseable` (Müll-Bytes mit `.pdf`) → `reason: "unparseable"`
  - `reports locked when the pdf stays locked` (bestehender Lock-Mock, ohne eingebettete Daten) → `status: "sidecar", reason: "locked"`; mit eingebetteten Daten → `status: "error", reason: "locked"`
  - `reports other for unexpected errors` → `status: "error", reason: "other"`
  - `load reports pdfIssue` → `encrypted` / `unparseable` / `null` für eine normale PDF
  - `legacySidecarHasMarkup`: `""`, `"  "`, `"[]"`, `'[{"page":1,"data":{"objects":[]}}]'` → `false`; ein Eintrag mit einem Objekt → `true`; kein JSON / kein Array → `true` (unlesbar zählt als „hat Markierungen“, damit nie gelöscht wird); v1-Sidecar mit Seiten → `true`
  - `discardEmptyLegacySidecar deletes an empty sidecar and leaves the pdf byte-identical`; `keeps a sidecar with markup` → `{ deleted: false }`, Datei unverändert; `missing sidecar` → `{ deleted: false }`
- [ ] **Step 2:** `npx vitest run tests/pdfMarkup/markupFile.test.ts` → die neuen Tests schlagen fehl.
- [ ] **Step 3: Implementieren.** `reason` an jeder Rückgabe von `saveNow`/`fallback` setzen (Lock-Erkennung über das vorhandene `isLockedError`; `fallback` bekommt den Grund als Parameter). `loadNow` setzt `pdfIssue` aus `inspectPdf` (`null` → `"unparseable"`, `encrypted` → `"encrypted"`). `discardEmptyLegacySidecar` liest die Begleitdatei selbst (vertraut nicht dem Renderer) und löscht sie nur, wenn `legacySidecarHasMarkup` `false` ist; die PDF wird nicht gelesen oder geschrieben.
- [ ] **Step 4:** `npm test` → alles grün (bestehende Aufrufer werten nur `status` aus).
- [ ] **Step 5: Commit** `feat: report why a markup save failed and discard empty legacy sidecars`

### Task 2: Kandidatensuche, Liste bleibender Fehler, nur PDFs in Liste und Suche

**Files:**
- Create: `src/migration/types.ts`, `src/migration/candidates.ts`, `src/migration/skipList.ts`, `src/sheetFiles.ts`
- Modify: `src/trcpLib.ts` (`loadFilesAndFolder`, `searchForSheet`)
- Test: `tests/migration/candidates.test.ts`, `tests/migration/skipList.test.ts`, `tests/sheetFiles.test.ts`

**Interfaces:**
- Consumes: `getSidecarPath` (`src/pdfMarkup/markupFile.ts`)
- Produces (in `src/migration/types.ts`, ohne Node-Imports, auch vom Renderer genutzt):
  - `interface MigrationCandidate { pdfPath: string; sidecarPath: string; relativePath: string }` (`relativePath` mit `/`, relativ zum Notenordner)
  - `type FailureReason = "corruptData" | "alreadyEmbedded" | "notWritable" | "locked" | "notBackedUp" | "pendingChanges" | "other"`
  - `const PERMANENT_REASONS: ReadonlySet<FailureReason>` (= `corruptData`, `alreadyEmbedded`, `notWritable`)
- Produces (Main):
  - `findMigrationCandidates(root: string, skips: SkipList): Promise<MigrationCandidate[]>` – sortiert nach `relativePath` (`localeCompare(…, "de")`)
  - `class SkipList { static load(file: string): Promise<SkipList>; isSkipped(c: MigrationCandidate): Promise<boolean>; record(c: MigrationCandidate, reason: FailureReason): Promise<void> }` – speichert JSON `{ version: 1, entries: [{ pdfPath, reason, pdf: {size, mtimeMs}, sidecar: {size, mtimeMs} }] }`; Merkmal wird beim `record` gelesen; `isSkipped` ist `true` nur bei gleichem Merkmal beider Dateien; Pfadvergleich unter Windows ohne Groß-/Kleinschreibung.
  - `isListedSheetEntry(name: string, isDirectory: boolean): boolean` (`src/sheetFiles.ts`): Ordner ohne führenden Punkt, Dateien ohne führenden Punkt mit Endung `.pdf` (beliebige Schreibweise).

- [ ] **Step 1: Failing tests** (temp-Verzeichnisse, keine Electron-Imports):
  - `finds pdfs with legacy and v1 sidecars in subfolders`; `matches .PDF case-insensitively`; `skips folders starting with a dot`; `does not follow symlinks`; `ignores pdfs without sidecar`; `ignores a sidecar without a pdf` (Review Focus 3); `sorts by relative path with forward slashes`; `excludes skipped candidates with an unchanged fingerprint`; `includes them again after the sidecar or the pdf changed`
  - `skip list survives reload from disk`; `a missing or broken skip file is an empty list`
  - `isListedSheetEntry`: `a.pdf`/`A.PDF` → true, `Backup.zip`/`x.png`/`.a.pdf`/`.data` → false, Ordner `Weihnachten` → true, `.git` → false
- [ ] **Step 2:** `npx vitest run tests/migration tests/sheetFiles.test.ts` → FAIL.
- [ ] **Step 3: Implementieren.** Suche mit `fs.promises.readdir(…, { withFileTypes: true })` rekursiv, Symlinks/Junctions (`isSymbolicLink()`) überspringen, Begleitdatei über `getSidecarPath`. `loadFilesAndFolder` filtert mit `isListedSheetEntry`; `searchForSheet` liefert nur Treffer mit Endung `.pdf`.
- [ ] **Step 4:** `npm test` → grün.
- [ ] **Step 5: Commit** `feat: find legacy markup files and list only pdfs`

### Task 3: Sicherungs-ZIP schreiben und prüfen

**Files:**
- Create: `src/migration/backupZip.ts`
- Modify: `package.json`, `package-lock.json` (yazl, yauzl, Typen – exakte Versionen aus den Global Constraints)
- Test: `tests/migration/backupZip.test.ts`

**Interfaces:**
- Consumes: `MigrationCandidate` (Task 2)
- Produces:
  - `type BackupResult = { status: "ok"; zipPath: string | null; included: MigrationCandidate[]; excluded: { candidate: MigrationCandidate; message: string }[] } | { status: "error"; message: string } | { status: "cancelled" }`
  - `createBackupZip(root: string, candidates: MigrationCandidate[], options: { now: Date; signal?: AbortSignal; onProgress?(p: { doneBytes: number; totalBytes: number }): void }): Promise<BackupResult>` – wirft nie.

- [ ] **Step 1: Failing tests:**
  - `zip contains every pdf and sidecar byte-identical under its relative path` (Umlaute im Pfad, z. B. `Böhmisch/Böhmischer traum.pdf`, UTF-8-Flag gesetzt); `pdf entries are stored, not deflated`
  - `names the zip Markierungen-Backup 2026-11-16 10-15.zip` (fixes `now`); `adds (2) on a name collision`
  - `excludes a file that cannot be read and still zips the rest` (gesperrte Datei per `chmod 000` bzw. gemocktem `readFile`, ohne Wiederholungen); `excludes a file that vanished` (Review Focus 1); alle ausgeschlossen → `{ status: "ok", zipPath: null }` und keine Datei angelegt
  - `verification detects a corrupted zip` (Prüffunktion gegen eine nachträglich veränderte Datei → Fehler); `on a write error no zip and no temp file remain` → `status: "error"`
  - `cancelled via signal leaves no files` → `{ status: "cancelled" }`
  - `removes stale temp files before writing` (Review Focus 2)
  - `reports progress up to totalBytes`
- [ ] **Step 2:** `npx vitest run tests/migration/backupZip.test.ts` → FAIL.
- [ ] **Step 3: Implementieren.** Jede Quelldatei einmal ganz lesen (`readFile`, keine Lock-Wiederholungen), CRC-32 mit `zlib.crc32` merken, mit `yazl` (`addBuffer`, PDFs `compress: false`, `forceZip64Format` nicht nötig – yazl schaltet selbst um) in die Temp-Datei schreiben, Datei schließen + `fsync`. Prüfen mit `yauzl.open` (`lazyEntries`): Menge der Einträge = erwartete Menge, je Eintrag Größe und per Stream neu berechnete CRC-32 gleich der Quelle. Erst dann `rename` auf den endgültigen Namen. Vor dem Schreiben alte `.Markierungen-Backup-*.zip.tmp` im Hauptordner löschen.
- [ ] **Step 4:** `npm test` → grün; `npm run lint`.
- [ ] **Step 5: Commit** `feat: write and verify the markup backup zip`

### Task 4: Umwandlung alter Markierungen aus `SheetViewer.vue` herausziehen

**Files:**
- Create: `src/markup/legacyMigration.ts`
- Modify: `src/views/SheetViewer.vue` (`applyLoadedMarkup`, `migrateLegacyOverlayData`, `toLegacyPayload` benutzen das Modul)
- Test: `tests/markup/legacyMigration.test.ts`

**Interfaces:**
- Consumes: `legacyToPayload`, `rotatePayload` (`src/markup/fabricTransform.ts`), `PageState` (`src/markup/saveQueue.ts`), `markupPayloadSchema`
- Produces:
  - `type ViewportOf = (page: number) => Promise<{ width: number; height: number; rotation: number }>` (pdf.js-Viewport bei Scale 1 reicht)
  - `convertLegacyOverlayData(text: string, numPages: number, viewportOf: ViewportOf, skipPages?: ReadonlySet<number>): Promise<{ changes: [number, PageState][]; unreadable: boolean }>` – genau die heutige Logik (leerer Text = `[]`, erste Seite gewinnt, Seiten > `numPages` ignoriert, leere Seite → `[page, null]`, ungültiger Eintrag → `unreadable`)
  - `sidecarPagesToChanges(pages: LoadedMarkupPage[], numPages: number, viewportOf: ViewportOf, skipPages?: ReadonlySet<number>): Promise<[number, PageState][]>` – v1-Seiten in aktueller Drehung (`rotatePayload`)
  - `hasMarkup(changes: [number, PageState][]): boolean`

- [ ] **Step 1: Failing tests:** dieselben Fälle wie die heutige SheetViewer-Logik: `empty text is no markup`; `first entry of a page wins`; `pages beyond numPages are ignored`; `page with empty objects becomes null`; `invalid drawWidth marks unreadable but keeps readable pages`; `non-array json is unreadable`; `skipPages are left out`; `v1 pages are rotated to the current rotation`; `converted payload equals legacyToPayload for a corpus-like entry`.
- [ ] **Step 2:** `npx vitest run tests/markup/legacyMigration.test.ts` → FAIL.
- [ ] **Step 3: Implementieren** und `SheetViewer.vue` umstellen (Notices, `allowLegacyDelete`, `markupPages` bleiben in der Komponente; nur die Umwandlung wandert).
- [ ] **Step 4:** `npm test`, `npm run lint` → grün.
- [ ] **Step 5: Commit** `refactor: share the legacy markup conversion with the bulk migration`

### Task 5: Ablauf der Sammelmigration (framework-frei) und Migration einer Datei

**Files:**
- Create: `src/migration/bulkMigration.ts`, `src/migration/migrateFile.ts`, `src/migration/texts.ts`
- Test: `tests/migration/bulkMigration.test.ts`, `tests/migration/migrateFile.test.ts`

**Interfaces:**
- Consumes: Task 1 (`SaveMarkupResult.reason`, `LoadMarkupResult.pdfIssue`, `discardEmptyLegacySidecar`), Task 2 (`MigrationCandidate`, `FailureReason`, `PERMANENT_REASONS`), Task 3 (`BackupResult`), Task 4 (`convertLegacyOverlayData`, `sidecarPagesToChanges`, `hasMarkup`)
- Produces:
  - `type FileOutcome = { kind: "migrated" } | { kind: "failed"; reason: FailureReason; message?: string }`
  - `interface MigrateFileDeps { loadPdf(path: string): Promise<{ numPages: number; viewportOf: ViewportOf; destroy(): Promise<void> }>; loadMarkup(path: string): Promise<LoadMarkupResult>; save(input: SaveMarkupInput): Promise<SaveMarkupResult>; renderPng(payload: MarkupPayload): Promise<string>; discardEmptySidecar(path: string): Promise<{ deleted: boolean }> }`
  - `migrateFile(c: MigrationCandidate, deps: MigrateFileDeps): Promise<FileOutcome>` – wirft nie; `destroy()` immer im `finally`
  - `type MigrationPhase = { phase: "idle" } | { phase: "backup"; doneBytes: number; totalBytes: number } | { phase: "migrating"; index: number; total: number; current: string } | { phase: "done"; summary: MigrationSummary }`
  - `interface MigrationSummary { migrated: number; zipName: string | null; failures: { relativePath: string; reason: FailureReason; message?: string }[]; cancelledRemaining: number; backupError: string | null }`
  - `interface BulkMigrationDeps { findCandidates(root: string): Promise<MigrationCandidate[]>; createBackup(root: string, c: MigrationCandidate[], onProgress: (p: { doneBytes: number; totalBytes: number }) => void): Promise<BackupResult>; cancelBackup(): Promise<void>; migrateFile(c: MigrationCandidate): Promise<FileOutcome>; recordSkip(c: MigrationCandidate, reason: FailureReason): Promise<void>; hasPending(pdfPath: string): boolean; onPhase(p: MigrationPhase): void }`
  - `class BulkMigration { constructor(deps: BulkMigrationDeps); run(root: string): Promise<MigrationSummary | null>; cancel(): void; isRunning(): boolean; cancelAndWait(): Promise<void> }` – `run` liefert `null`, wenn keine Kandidaten (kein `onPhase` außer `idle`)
  - `reasonText(reason: FailureReason, message?: string): string` und die übrigen UI-Texte als Konstanten/Funktionen in `src/migration/texts.ts` (wörtlich aus den Global Constraints)

`migrateFile` – Entscheidungsfolge:
1. `loadMarkup`; `source === "pdf"` → `failed alreadyEmbedded`.
2. PDF laden (`loadPdf`); Fehler → `pdfIssue` gesetzt ? `notWritable` : `other`.
3. `legacyOverlayData !== null` → `convertLegacyOverlayData`; `unreadable` → `failed corruptData` (nichts schreiben). `source === "sidecar"` → `sidecarPagesToChanges`. Sonst (leere/whitespace `.data`) → keine Änderungen.
4. `!hasMarkup(changes)` und keine v1-Seiten → `discardEmptySidecar`; `deleted` → `migrated`, sonst `failed corruptData`.
5. Sonst PNGs rendern, `save({ path, pages, deleteLegacySidecar: true })`: `pdf` → `migrated`; `sidecar` mit `readOnly`/`encrypted`/`unparseable` → `notWritable`, mit `locked` → `locked`; `error` mit `locked` → `locked`, sonst `other` (mit `message`).

`BulkMigration.run` – Ablauf: Kandidaten holen → Kandidaten mit `hasPending` herausnehmen (`pendingChanges`) → Sicherung (Phase `backup`; `error` → Zusammenfassung mit `backupError`, nichts migriert; `cancelled` → Zusammenfassung mit `cancelledRemaining = Anzahl`) → `excluded` als `notBackedUp` → je `included`-Kandidat Phase `migrating`, `migrateFile`, bei bleibendem Grund `recordSkip` **nach** dem Versuch → nach `cancel()` die aktuelle Datei fertig, Rest als `cancelledRemaining` → Phase `done`.

- [ ] **Step 1: Failing tests** mit Fakes:
  - `migrateFile`: je ein Test pro Zeile der Entscheidungsfolge (u. a. `already embedded fails permanently without saving`, `corrupt legacy data saves nothing`, `whitespace sidecar is discarded without touching the pdf`, `read-only maps to notWritable`, `locked maps to locked`, `saves all pages with deleteLegacySidecar`); `destroys every loaded pdf, also on failure` (Review Focus 5)
  - `BulkMigration`: `no candidates → null and no phases`; `backup error → nothing migrated, backupError set`; `excluded files fail as notBackedUp`; `pending files are skipped as pendingChanges and not backed up`; `permanent failures are recorded after the attempt, transient ones not`; `cancel finishes the current file and counts the rest`; `cancel during backup calls cancelBackup and migrates nothing`; `a vanished file fails as other, the run continues` (Review Focus 1); `a second run while running returns the running one` (Review Focus 4); `cancelAndWait resolves after the current file`
  - `texts`: Singular/Plural der Zusammenfassung, alle Gründe wörtlich
- [ ] **Step 2:** `npx vitest run tests/migration` → FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** `npm test`, `npm run lint` → grün.
- [ ] **Step 5: Commit** `feat: run the bulk markup migration file by file`

### Task 6: In die App einbauen (tRPC, Store, Dialog, Auslöser, Schließen/Update)

**Files:**
- Modify: `src/trcpRouter.ts`, `src/markup/closeGuard.ts`, `src/store/markupSaves.ts`, `src/App.vue`
- Create: `src/store/bulkMigration.ts`, `src/components/MigrationDialog.vue`, `src/migration/backupProgress.ts` (EventEmitter + AbortController der laufenden Sicherung, Main)
- Test: `tests/markup/closeGuard.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5
- Produces (tRPC, Namen verbindlich):
  - `findMigrationCandidates` (query, Input: absoluter Ordnerpfad) – leere Liste bei `SMV_DISABLE_BULK_MIGRATION=1`; Skip-Datei `path.join(app.getPath("userData"), "bulk-migration-skips.json")`
  - `createMigrationBackup` (mutation, Input `{ root, candidates }`) → `BackupResult`; `cancelMigrationBackup` (mutation); `onMigrationBackupProgress` (subscription, liefert `{ doneBytes, totalBytes }`)
  - `recordMigrationSkip` (mutation, Input `{ candidate, reason }`); `discardEmptyLegacySidecar` (mutation, Input `pdfPathSchema`)
  - Zod-Eingaben prüfen: Kandidatenpfade liegen unter `root` (kein Schreiben außerhalb des Notenordners).
- `CloseGuardOptions` bekommt optional `migration?: { isRunning(): boolean; cancelAndWait(): Promise<void> }`.
- DOM-Haken für Tests: `data-testid="migration-dialog"`, `migration-progress`, `migration-summary`, `migration-ok`, `migration-cancel`; die Zusammenfassung trägt `data-migrated="<n>"`.

- [ ] **Step 1: Failing tests** in `tests/markup/closeGuard.test.ts`: `closing while a migration runs blocks, cancels it and resumes after the current file`; `prepareToClose cancels a running migration first`; `no migration option → unchanged behaviour` (bestehende Tests bleiben grün).
- [ ] **Step 2:** `npx vitest run tests/markup/closeGuard.test.ts` → FAIL.
- [ ] **Step 3: Implementieren.**
  - `closeGuard`: `onBeforeUnload` blockiert auch bei `migration.isRunning()`; `guardExit` und `prepareToClose` rufen zuerst `cancelAndWait()`.
  - `src/store/bulkMigration.ts`: Pinia-Store um `BulkMigration`; `migrateFile`-Deps mit pdf.js (`getDocument` mit denselben Optionen wie `SheetViewer.vue`: `disableRange`, `disableStream`, `disableAutoFetch`, gleiche Worker-/WASM-Einstellungen), `renderMarkupPng`, tRPC; `hasPending` über `markupSaves.queue.hasPending(path)`; Phase als reaktiver State.
  - `MigrationDialog.vue`: `v-dialog persistent`, kein Escape/Klick daneben; Fortschrittsbalken (Bytes in der Sicherungsphase, `i von n` beim Migrieren), Pfad der aktuellen Datei, `Abbrechen`; Zusammenfassung im selben Dialog mit `OK`.
  - `App.vue`: Auslöser in `onMounted` (wenn `store.sheetMusicFolder` gesetzt) und `watch(() => store.sheetMusicFolder)`; ist die aktuelle Route `SheetViewer`, vorher `router.push` zur Notenliste (`SheetSelection`, `path: window.path.sep`). `restartForUpdate` ruft vor `prepareToClose()` `bulkMigration.cancelAndWait()`. Close-Guard-Wiring in `markupSaves.ts` reicht den Store als `migration` durch.
- [ ] **Step 4:** `npm test`, `npm run lint`, `npx vue-tsc --noEmit -p tsconfig.json` (nur die bekannten tsconfig-Deprecation-Meldungen erlaubt).
- [ ] **Step 5: Commit** `feat: migrate all legacy markup on start with a progress dialog`

### Task 7: Headless-E2E der Sammelmigration und Doku

**Files:**
- Modify: `tests/visual/electronDriver.ts`
- Create: `tests/visual/bulkMigration.visual.ts`
- Modify: `AGENTS.md` (Abschnitt „Markup storage“: ein Absatz zur Sammelmigration, ZIP, Skip-Datei, `SMV_DISABLE_BULK_MIGRATION`)

**Interfaces:**
- Produces:
  - Startlogik von `openSheet` in `launchApp(app: AppUnderTest, folder: string, options?: { env?: Record<string, string>; bulkMigration?: boolean })` ausgelagert; ohne `bulkMigration: true` setzt der Treiber `SMV_DISABLE_BULK_MIGRATION=1` (bestehende visuelle Tests prüfen weiter den Öffnen-Weg).
  - `runBulkMigration(app: AppUnderTest, folder: string): Promise<{ migrated: number; failures: string[]; zipName: string | null; dialogShown: boolean; networkRequests: string[] }>` – startet headless mit `bulkMigration: true`, wartet auf `migration-summary` (oder stellt nach 10 s ohne `migration-dialog` `dialogShown: false` fest), klickt `migration-ok`, schließt die App.

Ruling (Spec 8, „dieselben Prüfungen A–Er“): Die Prüfungen A–Er laufen weiter in `compare.visual.ts` auf dem Öffnen-Weg. Dieser Task beweist, dass die Sammelmigration **dieselben** PDFs erzeugt: gleiche eingebettete Payloads je Seite und gleiche Stempel-Pixel. Damit gelten A–Er auch für sie, ohne den Vergleichslauf zu verdoppeln.

- [ ] **Step 1: Test schreiben** `tests/visual/bulkMigration.visual.ts` (skip ohne Korpus):
  - Kopie A (`copyCorpus`), vorher Bytes aller PDFs und `.data` merken; eine PDF der Kopie schreibgeschützt machen (`chmod 0o444`).
  - `runBulkMigration` → `dialogShown`, `migrated` = Anzahl Korpusdateien − 1, `failures` enthält genau die schreibgeschützte mit `PDF kann nicht beschrieben werden`, `networkRequests` leer.
  - Keine `.data` mehr außer der schreibgeschützten (dort jetzt v1-Sidecar oder alte Datei), genau eine `Markierungen-Backup *.zip` im Hauptordner, ihr Inhalt byte-gleich mit den gemerkten Bytes.
  - Zweiter Lauf: `dialogShown: false` (bleibender Fehler wird nicht erneut gemeldet).
  - Kopie B: jede PDF einzeln mit `openSheet` öffnen (Öffnen-Weg migriert); dann je PDF: eingebettete Payloads (A vs. B, via `readMarkup`) tief gleich, und die mit `tests/visual/pdfRender.ts` gerenderten Seiten mit Markierung unterscheiden sich in ≤ 0,001 der Pixel (`PIXEL_RATIO_MAX`-Logik aus `imageCompare.ts`).
- [ ] **Step 2:** `npm run test:visual` (headless) → der neue Test schlägt vor der Treiber-Erweiterung fehl, danach grün; alle bestehenden visuellen Tests bleiben grün (48/48 oder mehr).
- [ ] **Step 3:** `AGENTS.md` ergänzen.
- [ ] **Step 4:** `npm test`, `npm run lint`, `npm run test:visual` → grün; Ausgaben nennen.
- [ ] **Step 5: Commit** `test: cover the bulk migration end to end` (Test + Treiber) und `docs: describe the bulk markup migration` (AGENTS.md)
