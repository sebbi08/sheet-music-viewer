# Migration als Schranke – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Solange ein Notenordner nicht als übernommen gilt, prüft die App beim Start alle `.data`-Dateien, übernimmt sie nur, wenn jede einzelne besteht, und zeigt sonst die vollständige Fehlerliste und wird geschlossen; danach stehen Markierungen nur noch in der PDF, und jedes Öffnen meldet eine PDF, in die nicht gespeichert werden kann.

**Architecture:** Das Hauptprogramm bekommt drei Bausteine ohne Electron-Importe: Lesen der Begleitdatei mit der Namensregel der alten App, einen Probelauf des Speicherns samt „Schreibsperre“ (`WriteBlock`) und das Übernehmen einer Begleitdatei in ihre PDF. Ein framework-freier Ablauf im Renderer (`MigrationGate`) steuert Suche → Durchgang 1 (Probelauf je Datei) → Sicherung → Durchgang 2 und trägt den Ordner lokal als übernommen ein. Erst wenn die Schranke verdrahtet ist, fallen die Migration beim Öffnen und der Sidecar-Fallback weg; so ist jeder Zwischenstand für echte Daten unbedenklich.

**Tech Stack:** TypeScript, Electron/tRPC (electron-trpc), Vue 3 + Vuetify 4 + Pinia, pdfjs-dist, fabric, pdf-lib 1.17.1, yazl/yauzl, vitest, Playwright `_electron`. Keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-11-20-strict-markup-migration-design.md` (ändert `2026-11-15-markup-in-pdf-design.md` und `2026-11-16-bulk-markup-migration-design.md`)

## Global Constraints

- Die App schreibt nach diesem Plan nirgends mehr eine `.data`-Datei; gelesen werden sie nur von der Schranke.
- Durchgang 1 verändert nichts im Notenordner außer einer sofort wieder gelöschten Probedatei je Ordner.
- Ein Ordner wird nur eingetragen, wenn ein Durchlauf ohne einen einzigen Fehler endet. Datei im Profil: `markup-migrated-folders.json` (`userData`), nie im Notenordner.
- `src/pdfMarkup/` und `src/migration/` bleiben ohne Electron-Importe und in Node unit-getestet.
- Alle Texte der Oberfläche deutsch und knapp; jeder Fehlertext nennt die Ursache und was zu tun ist. Die Texte in Task 6 sind verbindlich.
- Tests: `Noten/` wird nie direkt geöffnet (nur Kopien); alle GUI-Tests headless (kein `VISUAL_HEADED`).
- Atomares Schreiben mit Read-back, ~3 s Wiederholungen bei Sperre, Format und Prüfung der Backup-ZIP und der Single-Instance-Lock bleiben unverändert.
- Commits: Conventional Commits (commitlint-Hook). Prüfbefehle: `npx vitest run <datei>`, `npm test`, `npm run lint`. `tsc --noEmit` ist in diesem Repo kein brauchbares Tor (bestehende Fehler durch `.vue`-Importe und `import.meta`).

## Review Focus

Was die Spezifikation nahelegt, aber leicht ungetestet bleibt; jede Zeile hat ihren Test in der genannten Task:

1. **Eine PDF ändert sich zwischen Durchgang 1 und 2** (Nextcloud synchronisiert): Durchgang 2 rechnet aus den aktuellen Bytes neu und meldet die Datei, statt den Plan aus Durchgang 1 auszuführen. → Task 6, `gate.test.ts`.
2. **Derselbe Ordner wird in „Anderen Notenordner wählen“ erneut gewählt:** Die Schranke läuft trotzdem neu (ein `watch` auf den Ordner feuert bei gleichem Wert nicht). → Task 7, e2e.
3. **Ein Blatt wird geöffnet, während die Schranke nicht bestanden ist** (Routenwechsel per Setliste oder Suche, während die Fehlerliste steht): Die Navigation wird abgelehnt. → Task 7, e2e.
4. **Hunderte Dateien, einige scheitern:** Das pdf.js-Dokument jeder Datei wird auch im Fehlerfall freigegeben. → Task 6, `processFile.test.ts`.
5. **Der Ordnerpfad ist anders geschrieben** (abschließender Trenner, unter Windows andere Groß-/Kleinschreibung): Er gilt weiter als übernommen. → Task 5.

## Dateiübersicht

| Datei | Aufgabe nach dem Plan |
|---|---|
| `src/pdfMarkup/legacySidecar.ts` (neu) | Namensregel der alten App, Begleitdatei lesen und einordnen |
| `src/pdfMarkup/folderProbe.ts` (neu) | `isFolderWritable` (aus `readOnlyFolders.ts`) |
| `src/pdfMarkup/markupFile.ts` | PDF laden/speichern, `WriteBlock`, Probelauf, Begleitdatei übernehmen; kein Fallback |
| `src/migration/candidates.ts` | Suche wie die Notenliste, mit Links und Suchfehlern |
| `src/migration/migratedFolders.ts` (neu) | Liste der übernommenen Ordner |
| `src/migration/processFile.ts` (neu, ersetzt `migrateFile.ts`) | eine Datei prüfen oder übernehmen |
| `src/migration/gate.ts` (neu, ersetzt `bulkMigration.ts`) | Ablauf der Schranke |
| `src/migration/texts.ts`, `src/markup/writeBlockTexts.ts` (neu) | Texte |
| `src/store/bulkMigration.ts`, `src/components/MigrationDialog.vue`, `src/App.vue` | Verdrahtung, Fenster, Sperre |
| `src/components/WriteBlockDialog.vue` (neu), `src/views/SheetViewer.vue` | Prüfung beim Öffnen |
| entfällt | `src/migration/{bulkMigration,migrateFile,skipList,readOnlyFolders}.ts` samt Tests |

## Vorbereitung

- [ ] Branch `feat/strict-markup-migration` von `master` anlegen (nicht auf `master` arbeiten).
- [ ] Spezifikation und Plan committen: `git add docs/superpowers && git commit -m "docs: add design and plan for the strict markup migration"`.

---

### Task 1: Namensregel der alten App und Lesen der Begleitdatei

**Files:**
- Create: `src/pdfMarkup/legacySidecar.ts`
- Modify: `src/pdfMarkup/markupFile.ts` (eigene `getSidecarPath` und `legacySidecarHasMarkup` löschen, aus dem neuen Modul re-exportieren)
- Test: `tests/pdfMarkup/legacySidecar.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function getSidecarPath(pdfPath: string): string;
  export type SidecarContent =
    | { kind: "gone" }                                   // ENOENT
    | { kind: "unreadable"; message: string }            // any other read error
    | { kind: "empty" }                                  // no markup
    | { kind: "legacy"; text: string }
    | { kind: "v1"; pages: { page: number; payload: MarkupPayload }[] };
  export function readSidecarContent(pdfPath: string): Promise<SidecarContent>;
  export function legacySidecarHasMarkup(text: string): boolean; // unchanged, moved
  ```

- [ ] **Step 1: Failing tests schreiben**

```ts
describe("getSidecarPath (exact port of getOverlayDataFilePathFromSheetPath, v1.15.1)", () => {
  test.each([
    ["/x/Song.pdf", "/x/.Song.data"],
    ["/x/Song.PDF", "/x/.Song.data"],
    ["/x/Mo Money$$.pdf", "/x/.Mo Money$.data"],                // "$$" collapses in the replacement
    ["/x/a$&b.pdf", "/x/.aa$&b.pdfb.data"],                     // "$&" inserts the match
    ["/x/Song.pdf-alt/Song.pdf", "/x/.Song.data-alt/Song.pdf"], // first occurrence in the whole path
  ])("%s -> %s", (pdf, expected) => expect(getSidecarPath(pdf)).toBe(expected));
});

describe("readSidecarContent", () => {
  test("no file -> gone", ...);                      // { kind: "gone" }
  test.each(["", "  \n", "[]", '[{"page":1,"data":{"objects":[]}}]', '{"version":1,"pages":[]}'])
    ("%j -> empty", ...);                            // { kind: "empty" }
  test("legacy data -> legacy with the raw text", ...);
  test("text that is not JSON -> legacy (never empty)", ...);
  test("v1 file -> v1 with its pages", ...);         // pages: [{ page: 2, payload: payload(2) }]
  test.skipIf(isRoot)("chmod 000 -> unreadable with the error message", ...); // message contains "EACCES"
  test("a directory at the sidecar path -> unreadable", ...);                  // EISDIR
});
```

- [ ] **Step 2:** `npx vitest run tests/pdfMarkup/legacySidecar.test.ts` → FAIL (Modul fehlt).
- [ ] **Step 3: Implementieren.** `getSidecarPath` wörtlich wie in `git show v1.15.1:src/trcpLib.ts` (Funktion `getOverlayDataFilePathFromSheetPath`): `"." + base.replace(path.extname(base), ".data")`, dann `pdfPath.replace(base, name)`, beide Male `String.replace` mit String-Muster. Einordnung in `readSidecarContent`: leerer Text → `empty`; gültiges `sidecarV1Schema` → `v1` (ohne Seiten `empty`); sonst `legacySidecarHasMarkup(text)` ? `legacy` : `empty`.
- [ ] **Step 4:** Test → PASS; `npx vitest run tests/pdfMarkup tests/migration` → PASS (bestehende Importe aus `markupFile` laufen über den Re-Export).
- [ ] **Step 5: Commit** `fix: find legacy markup files with the old app's exact name rule`

---

### Task 2: Schreibsperre erkennen und Speichern im Probelauf

**Files:**
- Create: `src/pdfMarkup/folderProbe.ts` (`isFolderWritable` unverändert aus `src/migration/readOnlyFolders.ts` verschieben; dort importieren)
- Modify: `src/models/markup.ts`, `src/pdfMarkup/markupFile.ts`, `tests/pdfMarkup/fixtures.ts`
- Test: `tests/pdfMarkup/folderProbe.test.ts` (die `isFolderWritable`-Fälle aus `tests/migration/readOnlyFolders.test.ts` verschieben), `tests/pdfMarkup/fixtures.test.ts`, `tests/pdfMarkup/markupFile.test.ts`

**Interfaces:**
- Produces (`src/models/markup.ts`):
  ```ts
  export type WriteBlockReason = "encrypted" | "unparseable" | "readOnly" | "structure";
  export interface WriteBlock { reason: WriteBlockReason; message?: string }
  // LoadMarkupResult gets:  writeBlock: WriteBlock | null
  // SaveFailureReason gets: "structure"
  ```
- Produces (`src/pdfMarkup/markupFile.ts`):
  ```ts
  /** Why markup cannot be saved into this PDF; null = it can. Writes nothing but the folder probe. Never throws. */
  export function checkMarkupWritable(pdfPath: string): Promise<WriteBlock | null>;
  /** `saveMarkupToFile` without replacing the PDF or touching a sidecar; `{ status: "pdf" }` = would be saved. */
  export function trySaveMarkupToFile(input: SaveMarkupInput): Promise<SaveMarkupResult>;
  ```
- Produces (`tests/pdfMarkup/fixtures.ts`):
  ```ts
  export function makeEncryptedPdf(): Uint8Array;                     // really encrypted, empty user password
  export function dropStartXref(bytes: Uint8Array): Uint8Array;       // removes the last "startxref <n>"
  export function wrongStartXref(bytes: Uint8Array): Uint8Array;      // last startxref -> offset 9
  export function padAfterEof(bytes: Uint8Array, n?: number): Uint8Array; // n (default 5000) line feeds after %%EOF
  ```

- [ ] **Step 1: Fixture-Tests** (`fixtures.test.ts`): `makeEncryptedPdf()` → `(await PDFDocument.load(b, { ignoreEncryption: true })).isEncrypted === true` und `openWithPdfjs(b)` liefert `numPages: 1`. Für `dropStartXref`, `wrongStartXref`, `padAfterEof` auf `makePdf({ xref: "table" })`: pdf-lib lädt sie, `openWithPdfjs` liefert `numPages: 1`. → FAIL.
- [ ] **Step 2: Fixtures implementieren.** `makeEncryptedPdf`: handgeschriebene einseitige PDF mit Standard-Sicherheitshandler `/V 1 /R 2` (RC4 40 Bit, Benutzerkennwort leer, `/P -4`, `/ID` im Trailer); `/O`, `/U` und der Dokumentschlüssel nach PDF 32000-1 §7.6.3 Algorithmen 2, 3 und 4, der Inhaltsstrom mit dem Objektschlüssel nach Algorithmus 1 verschlüsselt. MD5 aus `node:crypto`, RC4 von Hand (OpenSSL 3 liefert es nicht mehr). → Fixture-Tests PASS.
- [ ] **Step 3: Failing tests der Dateischicht** (`markupFile.test.ts`, neuer `describe("write block and trial save")`):

```ts
test("a writable PDF has no write block", ...);          // checkMarkupWritable -> null; loadMarkupFromFile(pdf).writeBlock -> null
test("encrypted", ...);                                  // makeEncryptedPdf -> { reason: "encrypted" }; load reports the same
test("bytes that are no PDF", ...);                      // { reason: "unparseable" }
test.skipIf(isRoot)("read-only file", ...);              // chmod 444 -> { reason: "readOnly" }
test.skipIf(isRoot)("folder that accepts no new file", ...); // chmod 555 on dir -> { reason: "readOnly" }
test.each([["dropStartXref", dropStartXref], ["wrongStartXref", wrongStartXref], ["padAfterEof", padAfterEof]])
  ("%s: structure, for the check, the trial and the real save", async (_n, breakIt) => {
    const pdf = await writeFixture(dir, "s.pdf", breakIt(await makePdf({ xref: "table" })));
    const before = fs.readFileSync(pdf);
    expect(await checkMarkupWritable(pdf)).toMatchObject({ reason: "structure", message: expect.any(String) });
    const input = { path: pdf, pages: [page1()], deleteLegacySidecar: false };
    expect(await trySaveMarkupToFile(input)).toMatchObject({ status: "error", reason: "structure" });
    expect(await saveMarkupToFile(input)).toMatchObject({ status: "error", reason: "structure" });
    expect(fs.readFileSync(pdf).equals(before)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(["s.pdf"]);       // no temp file, no sidecar
  });
test("the trial save changes nothing", ...);             // status "pdf"; PDF bytes, a legacy sidecar next to it and readdir unchanged
test("the trial save of an encrypted PDF is an error and writes no sidecar", ...); // reason "encrypted"; readdir unchanged
test.skipIf(isRoot)("a PDF with an orphan that cannot be written is not repaired on load", ...); // bytes unchanged, writeBlock readOnly
```

- [ ] **Step 4:** `npx vitest run tests/pdfMarkup/markupFile.test.ts` → FAIL.
- [ ] **Step 5: Implementieren.**
  - `writeBlockOf(realPath, bytes, inspection)` in dieser Reihenfolge: nicht lesbar → `unparseable`; verschlüsselt → `encrypted`; `!isWritable(realPath) || !isFolderWritable(dirname)` → `readOnly`; Probelauf scheitert → `structure` mit der Fehlermeldung. Der Probelauf baut `buildMarkedPdf(bytes, [probe])` mit einem Stempel auf Seite 1 (Payload `{ version: 1, width: 1, height: 1, fabric: { objects: [] } }`, 1×1-PNG als Konstante) und prüft das Ergebnis mit `verifyPages`. `checkMarkupWritable` läuft über `serialized`; ein Lesefehler der Datei ergibt `{ reason: "unparseable", message }`.
  - `loadNow`: `writeBlock` vor der Reparatur verwaister Stempel bestimmen; reparieren nur bei `writeBlock === null` (ersetzt die Bedingung `isWritable`).
  - `saveNow(input, dryRun)`: Fehler aus `buildMarkedPdf` (außer `EncryptedPDFError`) bekommen `reason: "structure"`; die Ordner-Probe gehört zur Schreibbarkeitsprüfung. Im Probelauf: statt `fallback(...)` ein Fehler mit dem Grund, `verifyPages` auf den gebauten Bytes, kein `atomicReplace`, kein Löschen der Begleitdatei.
- [ ] **Step 6:** `npx vitest run tests/pdfMarkup tests/migration` → PASS; `npm run lint` → sauber.
- [ ] **Step 7: Commit** `feat: detect PDFs that cannot take markup and add a trial save`

---

### Task 3: Eine Begleitdatei in ihre PDF übernehmen (Hauptprogramm)

**Files:**
- Modify: `src/models/markup.ts`, `src/pdfMarkup/markupFile.ts`
- Test: `tests/pdfMarkup/markupFile.test.ts`

**Interfaces:**
- Consumes: `readSidecarContent`, `getSidecarPath` (Task 1); `writeBlockOf`, `saveNow`-Bausteine (Task 2).
- Produces:
  ```ts
  // src/models/markup.ts
  export type MigrateFailureReason = SaveFailureReason | "conflict" | "sidecarNotDeleted";
  export interface MigrateSidecarInput { path: string; pages: SaveMarkupInput["pages"]; dryRun: boolean }
  export type MigrateSidecarResult =
    | { status: "migrated" }          // dryRun: would be written. Otherwise: written, read back, sidecar deleted
    | { status: "alreadyMigrated" }   // the PDF already holds exactly these pages. Otherwise also: sidecar deleted
    | { status: "error"; reason: MigrateFailureReason; message?: string };
  // src/pdfMarkup/markupFile.ts
  export function migrateSidecarToFile(input: MigrateSidecarInput): Promise<MigrateSidecarResult>; // never throws
  ```

- [ ] **Step 1: Failing tests** (neuer `describe("migrateSidecarToFile")`; `legacy(dir, pdf)` schreibt eine alte `.data` neben die PDF):

```ts
test("dry run: migrated, PDF and sidecar untouched", ...);
test("writes the PDF, reads it back and deletes the sidecar", ...);        // loaded pages == input; sidecar gone
test("PDF already holds exactly these pages: alreadyMigrated; only the sidecar goes", ...); // PDF bytes unchanged
test("alreadyMigrated in a dry run keeps the sidecar", ...);
test("PDF holds other markup: conflict, nothing changes", ...);            // other payload or other page set
test("encrypted, read-only and structure are reported with their reason; no file is created", ...);
test("the sidecar cannot be deleted: sidecarNotDeleted, the PDF holds the markup", async () => {
  setLockRetryDelays([]);
  vi.spyOn(fs.promises, "rm").mockRejectedValue(Object.assign(new Error("held"), { code: "EPERM" }));
  expect(await migrateSidecarToFile({ path: pdf, pages: [page1()], dryRun: false }))
    .toMatchObject({ status: "error", reason: "sidecarNotDeleted" });
  vi.restoreAllMocks();
  expect(await migrateSidecarToFile({ path: pdf, pages: [page1()], dryRun: false })).toEqual({ status: "alreadyMigrated" });
  expect(fs.existsSync(getSidecarPath(pdf))).toBe(false);
});
test("the PDF stays locked: locked, PDF unchanged, sidecar kept", ...);     // rename rejects with EBUSY
test("without any page that has a payload: error other", ...);
test("discardEmptyLegacySidecar also deletes a v1 file without pages", ...);
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementieren** (über `serialized(input.path)`): `writeBlock` (ohne Probelauf-Stempel: die echten Seiten werden gleich gebaut) → Fehler mit dessen Grund. Hat die PDF eingebettete Daten: Seitenmenge und `expectedPayload` je Seite mit den Seiten der Anfrage vergleichen, die ein Payload haben → `alreadyMigrated` oder `conflict`. Sonst bauen (`structure`), im Probelauf im Speicher prüfen, sonst `atomicReplace` mit Read-back (`locked` bzw. `other`). Löschen der Begleitdatei mit `retryWhileLocked`; scheitert es → `sidecarNotDeleted` mit der Meldung. `discardEmptyLegacySidecar` entscheidet über `readSidecarContent(...).kind === "empty"`.
- [ ] **Step 4:** → PASS. **Step 5: Commit** `feat: move a legacy markup file into its PDF as one checked step`

---

### Task 4: Suche wie die Notenliste, mit Links und Suchfehlern

**Files:**
- Modify: `src/migration/candidates.ts` (neue Funktion neben der alten), `src/migration/types.ts`
- Test: `tests/migration/candidates.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/migration/types.ts
  export interface ScanError { relativePath: string; kind: "folder" | "link"; message: string } // root itself: "."
  export interface ScanResult { candidates: MigrationCandidate[]; errors: ScanError[] }
  // src/migration/candidates.ts
  export function scanMigrationCandidates(root: string): Promise<ScanResult>; // never throws
  ```
  Ein Kandidat hinter einem Link trägt `pdfPath` und `relativePath` **durch den Link** (liegt damit lexikalisch im Notenordner).

- [ ] **Step 1: Failing tests** (neuer `describe("scanMigrationCandidates")`):

```ts
it("finds pdfs with a sidecar in subfolders, .PDF in any case, sorted by relative path", ...);
it("skips entries starting with a dot and sidecars without a pdf", ...);
it("finds a pdf named with $$ by the old app's rule", ...);            // "Mo Money$$.pdf" + ".Mo Money$.data"
it("follows a linked folder and a linked pdf", ...);                   // relativePath "link/a.pdf"
it("a link back to a parent folder ends: every pdf once", ...);
it("the same folder reached on two ways is visited once", ...);        // first way in name order wins
it("a link whose target cannot be read is an error", ...);             // errors: [{ kind: "link", relativePath: "dead" }]
it.skipIf(isRoot)("a subfolder that cannot be listed is an error; the rest is still scanned", ...); // kind "folder"
it("a root that cannot be listed is an error with relativePath '.'", ...);
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementieren.** Einträge je Ordner nach Namen sortiert (`localeCompare(…, "de")`), Tiefensuche. Jeder Eintrag, den `readdir` als Link meldet (auch Cloud-Platzhalter), wird mit `fs.promises.stat` aufgelöst wie in `resolveListedEntry`; scheitert das → `ScanError` `link`. Ordner und PDFs werden über `fs.promises.realpath` in einer Besucht-Menge geführt. Begleitdatei: `getSidecarPath(full)` ist eine Datei. Die alte `findMigrationCandidates` und `entryKind` bleiben bis Task 7 stehen.
- [ ] **Step 4:** → PASS. **Step 5: Commit** `feat: scan for legacy markup like the sheet list, links included`

---

### Task 5: Liste der übernommenen Ordner

**Files:**
- Create: `src/migration/migratedFolders.ts`
- Test: `tests/migration/migratedFolders.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class MigratedFolders {
    static load(file: string): Promise<MigratedFolders>; // missing or broken file: nothing migrated
    has(folder: string): boolean;
    add(folder: string): Promise<void>;                  // a failed write is logged, never thrown
  }
  ```
  Dateiinhalt `{ "version": 1, "folders": string[] }`, atomar geschrieben (Temp-Datei, Rename). Schlüssel wie `ReadOnlyFolders`: `path.resolve`, unter Windows kleingeschrieben.

- [ ] **Step 1: Failing tests:** fehlende Datei → `has` false; nach `add` → `has` true, auch nach erneutem `load`; defekte Datei → leer; `add("/s/noten/")` → `has("/s/noten")` true; unter `win32` (Plattform wie in `readOnlyFolders.test.ts` gestellt) `add("C:\\Noten")` → `has("c:\\noten\\")` true; nicht beschreibbarer Profilordner → `add` löst auf, `console.warn` wurde aufgerufen.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: remember sheet folders whose markup is migrated`

---

### Task 6: Ablauf der Schranke (framework-frei), Texte, vollständige Sicherung

**Files:**
- Create: `src/migration/processFile.ts`, `src/migration/gate.ts`, `src/markup/writeBlockTexts.ts`
- Modify: `src/migration/types.ts`, `src/migration/texts.ts` (neue Exporte; alte bleiben bis Task 7), `src/migration/backupZip.ts`
- Test: `tests/migration/processFile.test.ts`, `tests/migration/gate.test.ts`, `tests/migration/texts.test.ts`, `tests/markup/writeBlockTexts.test.ts`, `tests/migration/backupZip.test.ts`

**Interfaces:**
- Consumes: `SidecarContent` (Task 1), `WriteBlock` (Task 2), `MigrateSidecarInput/Result` (Task 3), `ScanResult` (Task 4), `convertLegacyOverlayData`, `sidecarPagesToChanges`, `hasMarkup` (`src/markup/legacyMigration.ts`), `BackupResult`.
- Produces:
  ```ts
  // src/migration/types.ts
  export type GateFailureReason =
    | "dataDamaged" | "dataUnreadable" | "conflict" | "encrypted" | "readOnly" | "unparseable" | "structure"
    | "locked" | "pendingChanges" | "folderUnreadable" | "linkUnreadable" | "sidecarNotDeleted" | "backupFailed" | "other";
  /** `relativePath` null: not about one file (backup). `sidecarName`: basename of the `.data` file, for the text. */
  export interface GateFailure { relativePath: string | null; reason: GateFailureReason; message?: string; sidecarName?: string }

  // src/migration/processFile.ts
  export type FileOutcome =
    | { kind: "ok"; plan: "migrate" | "deleteEmpty" | "deleteMigrated" }
    | { kind: "gone" }                                              // sidecar vanished since the scan
    | { kind: "failed"; reason: GateFailureReason; message?: string };
  export interface ProcessFileDeps {
    readSource(c: MigrationCandidate): Promise<{ sidecar: SidecarContent; writeBlock: WriteBlock | null }>;
    loadPdf(path: string): Promise<{ numPages: number; viewportOf: ViewportOf; destroy(): Promise<void> }>;
    renderPng(payload: MarkupPayload): Promise<string>;
    migrate(input: MigrateSidecarInput): Promise<MigrateSidecarResult>;
    discardEmptySidecar(path: string): Promise<{ deleted: boolean }>;
  }
  /** "check" writes nothing; "write" migrates or deletes. Never throws. */
  export function processFile(c: MigrationCandidate, deps: ProcessFileDeps, mode: "check" | "write"): Promise<FileOutcome>;

  // src/migration/gate.ts
  export interface GateSummary { migrated: number; zipName: string | null }
  export interface GateFailed {
    status: "failed"; stage: "check" | "write";
    total: number; migrated: number; zipName: string | null; failures: GateFailure[];
  }
  export type GateResult = { status: "passed"; summary: GateSummary | null } | GateFailed | { status: "cancelled" };
  export type GatePhase =
    | { phase: "idle" } | { phase: "scanning" }
    | { phase: "checking"; index: number; total: number; current: string }
    | { phase: "backup"; doneBytes: number; totalBytes: number }
    | { phase: "migrating"; index: number; total: number; current: string }
    | { phase: "failed"; result: GateFailed } | { phase: "done"; summary: GateSummary };
  export interface GateDeps {
    isMigrated(root: string): Promise<boolean>;
    flushPending(): Promise<void>;
    scan(root: string): Promise<ScanResult>;
    hasPending(pdfPath: string): boolean;
    processFile(c: MigrationCandidate, mode: "check" | "write"): Promise<FileOutcome>;
    createBackup(root: string, c: MigrationCandidate[], onProgress: (p: { doneBytes: number; totalBytes: number }) => void): Promise<BackupResult>;
    cancelBackup(): Promise<void>;
    markMigrated(root: string): Promise<void>;
    onPhase(p: GatePhase): void;
  }
  export class MigrationGate {
    constructor(deps: GateDeps);
    isRunning(): boolean;
    run(root: string): Promise<GateResult>;   // a second call while one runs joins it
    cancel(): void;
    cancelAndWait(): Promise<void>;
  }

  // src/markup/writeBlockTexts.ts
  export function writeBlockText(block: WriteBlock): string;
  // src/migration/texts.ts (new exports)
  export function failureText(f: GateFailure): string;
  export function failedHeadline(r: GateFailed): string;
  ```
- `BackupResult` (`backupZip.ts`): `excluded` entfällt aus dem Ergebnis `ok`; ein Kandidat, der sich nicht lesen lässt, macht die Sicherung zu `{ status: "error", message }` (die Meldung nennt die relativen Pfade), ohne ZIP und ohne Temp-Datei. Der alte `BulkMigration`-Ablauf liest `excluded` noch: dort bis Task 7 `?? []` einsetzen.

**Verbindliche Texte:**

| Schlüssel | Text |
|---|---|
| `writeBlockText` encrypted | `Die PDF ist verschlüsselt. Bitte den Kennwortschutz entfernen.` |
| readOnly | `Die PDF oder ihr Ordner ist schreibgeschützt. Bitte den Schreibschutz entfernen.` |
| unparseable | `Die PDF kann nicht gelesen werden: ‹message›.` (ohne `message`: `Die PDF kann nicht gelesen werden.`) |
| structure | `In diese PDF kann die App nicht schreiben: ‹message›. Bitte mit einem anderen Programm neu speichern.` |
| `failureText` dataDamaged | `Die alte Markierungsdatei „‹sidecarName›“ ist beschädigt. Bitte die Datei löschen und die Markierungen neu eintragen.` |
| dataUnreadable | `Die Markierungsdatei „‹sidecarName›“ kann nicht gelesen werden: ‹message›.` |
| conflict | `Die PDF enthält bereits Markierungen. Bitte die Datei „‹sidecarName›“ löschen; die Markierungen in der PDF bleiben.` |
| encrypted, readOnly, unparseable, structure | wie `writeBlockText` |
| locked | `Die Datei ist in einem anderen Programm geöffnet. Bitte dort schließen.` |
| pendingChanges | `Für diese Datei gibt es ungespeicherte Änderungen.` |
| folderUnreadable | `Der Ordner kann nicht gelesen werden: ‹message›.` |
| linkUnreadable | `Die Verknüpfung führt zu einem Ziel, das nicht gelesen werden kann. Bitte entfernen oder das Ziel erreichbar machen.` |
| sidecarNotDeleted | `Die PDF wurde übernommen, aber „‹sidecarName›“ konnte nicht gelöscht werden: ‹message›.` |
| backupFailed | `Die Sicherung konnte nicht erstellt werden: ‹message›. Es wurde nichts übernommen.` |
| other | `‹message›` (ohne: `Unbekannter Fehler.`) |
| `failedHeadline` stage check | `‹n› von ‹total› Dateien haben ein Problem. Es wurde nichts verändert. Bitte beheben und erneut prüfen.` (n = 1: `1 von ‹total› Dateien hat ein Problem. …`; total = 0: `Der Notenordner konnte nicht vollständig geprüft werden. Es wurde nichts verändert.`) |
| stage write | `‹migrated› von ‹total› Dateien übernommen. Sicherung: ‹zipName›. ‹n› Dateien haben ein Problem.` (ohne ZIP entfällt der mittlere Satz) |
| Konstanten | `FAILED_TITLE = "Markierungen konnten nicht übernommen werden"`, `SCAN_TEXT = "Notenordner wird geprüft …"`, `CHECK_TEXT = "Dateien werden geprüft …"`, `RECHECK_BUTTON = "Erneut prüfen"`, `CHOOSE_FOLDER_BUTTON = "Anderen Notenordner wählen"`, `CLOSE_BUTTON = "Schließen"`, `WRITE_BLOCK_TITLE = "Keine Markierungen möglich"`, `WRITE_BLOCK_READABLE = "Die Noten lassen sich trotzdem anzeigen."`, `WRITE_BLOCK_BUTTON = "Verstanden"` |

Eine `message`, die schon auf einen Punkt endet, bekommt keinen zweiten.

- [ ] **Step 1: Failing tests `processFile.test.ts`** (Aufbau wie `migrateFile.test.ts`: gefälschte `deps`, `legacy()`-Helfer):

```ts
test("sidecar gone -> gone, the PDF is never loaded", ...);
test("sidecar unreadable -> failed dataUnreadable with the message", ...);
test("empty sidecar: check -> ok deleteEmpty without any write; write -> discardEmptySidecar is called", ...);
test("empty sidecar that cannot be discarded in write mode -> failed other", ...);   // { deleted: false }
test.each(["encrypted", "readOnly", "unparseable", "structure"] as const)
  ("write block %s -> failed with that reason; pdf.js is not started", ...);
test("pdf.js cannot open the PDF -> failed unparseable with its message", ...);
test("legacy data partly unconvertible -> failed dataDamaged, nothing is saved", ...);
test("legacy data with markup only on pages the PDF lacks -> failed dataDamaged", ...);
test("v1 page beyond the page count -> failed dataDamaged", ...);
test("a PNG that cannot be rendered -> failed dataDamaged with the message", ...);
test("check mode calls migrate with dryRun true, write mode with dryRun false", ...);
test("migrated -> ok migrate; alreadyMigrated -> ok deleteMigrated", ...);
test.each([["conflict", "conflict"], ["locked", "locked"], ["sidecarNotDeleted", "sidecarNotDeleted"], ["structure", "structure"]])
  ("migrate error %s -> failed %s", ...);
test("the pdf.js document is released after success and after every failure", ...);  // destroy called once per loadPdf
test("a throwing dependency -> failed other with the message, never a rejection", ...);
```

- [ ] **Step 2:** → FAIL. **Step 3:** `processFile` implementieren (Reihenfolge wie die Tests: Begleitdatei → Schreibsperre → pdf.js → Umwandeln → PNGs → `migrate`). **Step 4:** → PASS.

- [ ] **Step 5: Failing tests `gate.test.ts`** (`setup()` mit gefälschten `GateDeps` wie in `bulkMigration.test.ts`; `ok = { kind: "ok", plan: "migrate" }`):

```ts
test("a migrated folder: passed without scan, no phase but idle", ...);                // scan not called
test("no candidates and a complete scan: marked, passed with summary null, no backup", ...);
test("a failing scan: failed with folderUnreadable for '.', not marked", ...);          // scan rejects
test("scan errors are listed and every candidate is still checked", ...);
test("pass 1 checks every file even after failures and lists all of them", async () => {
  const { gate, deps } = setup([A, B, C], { processFile: async (c) => (c === B ? ok : failed("dataDamaged")) });
  const result = await gate.run("/s");
  expect(result).toMatchObject({ status: "failed", stage: "check", total: 3, migrated: 0, zipName: null });
  expect((result as GateFailed).failures.map((f) => f.relativePath)).toEqual(["a.pdf", "c.pdf"]);
  expect(deps.processFile).toHaveBeenCalledTimes(3);
  expect(deps.createBackup).not.toHaveBeenCalled();
  expect(deps.markMigrated).not.toHaveBeenCalled();
  expect(deps.processFile).not.toHaveBeenCalledWith(expect.anything(), "write");
});
test("a candidate with unsaved changes is a pendingChanges failure and is not processed", ...);
test("pending saves are flushed before the scan", ...);
test("gone candidates are dropped; if none is left the folder is marked without a backup", ...);
test("clean pass 1: backup of all candidates, then every file in write mode, marked, phase done", ...);
// summary { migrated: 2, zipName: "Markierungen-Backup 2026-11-16 10-00.zip" }; deleteEmpty and deleteMigrated count as migrated
test("backup error: failed stage write with one backupFailed failure (relativePath null), no file written", ...);
test("pass 2 goes on after a failure; the folder is not marked", ...);                  // migrated 2 of 3, zipName set
test("a file that passed the check but fails in write mode is reported (changed in between)", ...); // Review Focus 1
test("failures carry sidecarName for dataDamaged, dataUnreadable, conflict and sidecarNotDeleted", ...);
test("cancel during scan or pass 1: cancelled at once, nothing written, not marked", ...);
test("cancel during the backup: cancelBackup is called, cancelled", ...);
test("cancel during pass 2: the current file finishes, then cancelled, not marked", ...);
test("a second run while one is running returns the same promise", ...);
test("phases: scanning, checking 1..n, backup, migrating 1..n, done", ...);
test("markMigrated failing does not turn a passed run into a failure", ...);
```

- [ ] **Step 6:** → FAIL. **Step 7:** `MigrationGate` implementieren. `sidecarName` ist der Dateiname von `candidate.sidecarPath` (String-Operation, kein `node:path`: der Code läuft im Renderer). **Step 8:** → PASS.
- [ ] **Step 9: Texte.** Tests für jede Zeile der Tabelle (genauer Wortlaut, Singular/Plural, Punkt-Regel) → FAIL → implementieren → PASS.
- [ ] **Step 10: Sicherung.** In `backupZip.test.ts` die Fälle „nicht lesbare Datei wird ausgeschlossen“ umschreiben: `status: "error"`, Meldung enthält den relativen Pfad, weder ZIP noch Temp-Datei im Ordner → FAIL → `createBackupZip` ändern → PASS.
- [ ] **Step 11:** `npm test` und `npm run lint` → sauber. **Commit** `feat: add the two-pass migration gate and its texts`

---

### Task 7: Schranke verdrahten (tRPC, Store, Fenster, Sperre) und alten Ablauf entfernen

**Files:**
- Modify: `src/trcpRouter.ts`, `src/migration/ipcInput.ts`, `src/exitGuard.ts`, `src/store/bulkMigration.ts`, `src/store/index.ts`, `src/components/MigrationDialog.vue`, `src/App.vue`, `src/views/FolderSetup.vue`, `src/migration/candidates.ts`, `src/migration/texts.ts`, `src/migration/types.ts`, `tests/visual/electronDriver.ts`
- Delete: `src/migration/{bulkMigration,migrateFile,skipList,readOnlyFolders}.ts`, `tests/migration/{bulkMigration,migrateFile,skipList,readOnlyFolders}.test.ts`; in `candidates.ts` `findMigrationCandidates` und `entryKind` samt Tests; in `texts.ts`/`types.ts` die Exporte des alten Ablaufs
- Test: `tests/migration/ipcInput.test.ts`, `tests/visual/migrationGate.visual.ts` (neu, ohne Korpus)

**Interfaces:**
- Consumes: alles aus Task 1–6.
- Produces (tRPC, `src/trcpRouter.ts`):
  ```ts
  isMarkupFolderMigrated:   query(root) -> boolean        // SMV_DISABLE_BULK_MIGRATION=1 -> true, nothing is stored
  markMarkupFolderMigrated: mutation(root) -> void
  scanMigrationCandidates:  query(root) -> ScanResult
  readMigrationSource:      query({ root, candidate }) -> { sidecar: SidecarContent; writeBlock: WriteBlock | null }
  migrateMarkupSidecar:     mutation({ root, candidate, pages, dryRun }) -> MigrateSidecarResult
  closeApp:                 mutation() -> void            // exitGuard.closeAppWindow(): the normal close path
  // unchanged: createMigrationBackup, cancelMigrationBackup, onMigrationBackupProgress, discardEmptyLegacySidecar
  // removed:   findMigrationCandidates, checkMigrationFolder, recordMigrationSkip
  ```
  `readMigrationSource` und `migrateMarkupSidecar` prüfen ihre Eingabe wie `migrationBackupInputSchema` (Kandidat lexikalisch im Ordner, Begleitdatei = `getSidecarPath(pdfPath)`).
- Produces (`src/store/bulkMigration.ts`, Name `useBulkMigration` bleibt): `phase: GatePhase`, `cancelling`, `run(root)`, `recheck()`, `chooseOtherFolder()`, `cancel()` (bricht ab und schließt danach die App über `closeApp`), `cancelAndWait()` (für Close-Guard und Update-Neustart, schließt nicht selbst), `dismiss()`, `close()`, `isRunning()`, `isPassed(folder: string): boolean`.
- Produces (`src/store/index.ts`): Aktion `setSheetMusicFolder(folder: string)` mit dem bisherigen Inhalt von `FolderSetup.selectFolder` (Store, Setlisten, `localStorage`); ein leerer Wert (Auswahl abgebrochen) tut nichts.
- Produces (DOM, für die Tests): `document.documentElement.dataset.migrationGate` = `"pending" | "passed" | "failed"`; `data-testid`: `migration-dialog`, `migration-progress`, `migration-summary` (mit `data-migrated`), `migration-failed`, `migration-headline`, `migration-failure` (je Eintrag; Pfad in `.failure-path`, Text in `.failure-text`), `migration-ok`, `migration-cancel`, `migration-recheck`, `migration-choose-folder`, `migration-close`.

- [ ] **Step 1: Failing unit tests** (`ipcInput.test.ts`): die neuen Schemata lehnen einen Kandidaten außerhalb des Ordners und eine fremde Begleitdatei ab und nehmen einen Kandidaten durch einen Link an (lexikalisch im Ordner); die Fälle zu `recordMigrationSkipInputSchema` entfallen.
- [ ] **Step 2: Failing e2e** `tests/visual/migrationGate.visual.ts`. Ordner je Test frisch unter `test-results/visual/work/` aus `makePdf` und einer alten `.data` mit einem Rechteck (Aufbau wie `legacyEntry` in `tests/migration/migrateFile.test.ts`); gestartet mit `bulkMigration: true` und eigenem Profil:

```ts
test("two legacy files pass the gate; the second start shows nothing", ...);
// summary "2 Dateien übernommen.", one zip matching ZIP_PATTERN, no .data left, both PDFs have embedded pages,
// <profile>/markup-migrated-folders.json lists the folder; second start: gate "passed", dialog never shown
test("a damaged .data among healthy files: full list, folder untouched, Schließen ends the app", ...);
// gate "failed"; headline "1 von 2 Dateien hat ein Problem. Es wurde nichts verändert. Bitte beheben und erneut prüfen.";
// one failure with path "b.pdf" and the dataDamaged text; sha256 of every file equal to before; no zip;
// click migration-close -> waitForExit(30_000) true
test("a read-only PDF and an encrypted PDF are both listed", ...);       // makeEncryptedPdf; texts from the table
test("no sheet opens while the list is shown", ...);                     // $router.push(SheetViewer) -> route unchanged (Review Focus 3)
test("Erneut prüfen after fixing the file passes the gate", ...);        // delete the damaged .data, click migration-recheck
test("choosing the same folder again reruns the gate", ...);             // stub the folder dialog via electronApp.evaluate (Review Focus 2)
test("a folder without legacy files is marked without a dialog", ...);
test("Abbrechen during the check closes the app and changes nothing", ...);
// 300 small PDFs with a .data each, so the check runs long enough to click migration-cancel
```

- [ ] **Step 3:** `npx vitest run -c vitest.visual.config.mts tests/visual/migrationGate.visual.ts` → FAIL.
- [ ] **Step 4: Hauptprogramm.** Router wie oben; `MigratedFolders.load(path.join(app.getPath("userData"), "markup-migrated-folders.json"))` einmal je Lauf; `closeAppWindow()` in `exitGuard.ts` ruft `close()` auf dem verfolgten Fenster.
- [ ] **Step 5: Store.** `MigrationGate` mit `processFile` und den tRPC-Aufrufen verdrahten (`loadPdf` bleibt wie heute), `flushPending: () => markupSaves.queue.flush()`. `run` merkt bei `passed` den Ordner (`isPassed` vergleicht wie `keyOf` in `markupSaves.ts`). `chooseOtherFolder`: `client.selectFolder.query()` → bei Auswahl `setSheetMusicFolder`, zur Notenliste wechseln, `run(folder)` ausdrücklich aufrufen.
- [ ] **Step 6: Fenster und App.** `MigrationDialog.vue` zeigt die Phasen (Suche, Prüfen, Sicherung, Übernehmen), die Zusammenfassung (`OK`) und die Fehlerliste (`failedHeadline`, je Eintrag Pfad und `failureText`, Text markierbar, Liste scrollbar) mit den drei Knöpfen; während eines Laufs nur „Abbrechen“. Das Fenster erscheint für die Suche erst nach 300 ms, damit es bei einem Ordner ohne `.data` nicht aufblitzt. `App.vue`: Navigation zu `SheetViewer` nur bei `isPassed(store.sheetMusicFolder)`; Start der Schranke beim Mounten und bei Ordnerwechsel wie heute (ein offenes Blatt wird vorher verlassen); `dataset.migrationGate` setzen; `restartForUpdate` bleibt bei `cancelAndWait`. `FolderSetup.vue` nutzt `setSheetMusicFolder`.
- [ ] **Step 7: Treiber.** `settleBulkMigration` wartet auf `dataset.migrationGate !== "pending"` und liefert `{ status, migrated, zipName, lines, headline, failures: { path, text }[], dialogShown }`; bei `failed` wird nichts geklickt. `runBulkMigration` und `openSheet` übernehmen das.
- [ ] **Step 8:** Alten Ablauf löschen (Liste oben). Die Profil-Dateien `bulk-migration-skips.json` und `bulk-migration-read-only.json` aus Testbuilds bleiben liegen; sie werden nicht mehr gelesen. `npm test`, `npm run lint` → sauber; e2e aus Step 3 → PASS.
- [ ] **Step 9: Commit** `feat: block the app until all legacy markup is migrated`

---

### Task 8: Prüfung beim Öffnen, keine Migration beim Öffnen mehr

**Files:**
- Create: `src/components/WriteBlockDialog.vue`
- Modify: `src/views/SheetViewer.vue`
- Test: `tests/visual/writeBlock.visual.ts` (neu, ohne Korpus), `tests/visual/electronDriver.ts` (Zugriff auf den Dialog)

**Interfaces:**
- Consumes: `LoadMarkupResult.writeBlock` (Task 2), `writeBlockText`, `WRITE_BLOCK_*` (Task 6).
- Produces: `WriteBlockDialog` mit Props `fileName: string`, `block: WriteBlock | null` und `v-model`; `data-testid="write-block-dialog"`, `write-block-text`, `write-block-ok`. Im Treiber: `SheetSession.writeBlockText(): Promise<string | null>` (null = kein Dialog) und `confirmWriteBlock(): Promise<void>`; `openSheet` wartet wie bisher auf die gerenderten Seiten, der Dialog darf dabei offen sein.

- [ ] **Step 1: Failing e2e** (`SMV_DISABLE_BULK_MIGRATION=1`, also Treiber-Standard):

```ts
test("a read-only PDF: dialog on every open, sheet visible, pencil off; gone once it is writable", ...);
// text: 'In „a.pdf“ können keine Markierungen gespeichert werden: Die PDF oder ihr Ordner ist schreibgeschützt. …'
// after Verstanden: page canvas rendered, edit button disabled; reopen in the same session -> dialog again;
// chmod 644, reopen -> no dialog, edit button enabled
test("an encrypted PDF: dialog with the encrypted text, the page is rendered", ...);     // makeEncryptedPdf
test("a .data next to a PDF is neither shown nor touched; an edit goes into the PDF", ...);
// markup layer empty, .data bytes unchanged after toggleEdit twice with a change, PDF has embedded pages
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: `SheetViewer.vue`.**
  - `applyLoadedMarkup` zeigt nur noch die Seiten aus der PDF und die ungespeicherten Änderungen; `migrateLegacyOverlayData`, die Zweige für `sidecar`/`legacyOverlayData`, `LEGACY_UNREADABLE` und die Importe aus `legacyMigration` entfallen.
  - Hat das Ladeergebnis einen `writeBlock`: Dialog zeigen (bei jedem Öffnen, kein Merken), `markupEditDisabled` setzen, `editMode` aus. Versucht der Nutzer trotzdem zu bearbeiten, nennt der Hinweis den Grund (`writeBlockText`) statt `LOAD_FAILED`.
  - Unsere Ebene (OCG) wird nur ausgeblendet, wenn die Markup-Daten gelesen wurden: Laden gelungen und `writeBlock?.reason` weder `encrypted` noch `unparseable`.
  - Ein Blatt, das verlassen wurde, ändert nichts mehr: `onBeforeUnmount` setzt ein Kennzeichen, und jede Fortsetzung von `onMounted` nach einem `await` kehrt bei gesetztem Kennzeichen zurück, bevor sie `store`, `notices` oder pdf.js anfasst.
- [ ] **Step 4:** e2e → PASS; `npm test`, `npm run lint` → sauber.
- [ ] **Step 5: Commit** `feat: say on every open why a PDF cannot take markup`

---

### Task 9: Sidecar-Fallback entfernen, Dokumentation

**Files:**
- Modify: `src/models/markup.ts`, `src/pdfMarkup/markupFile.ts`, `src/markup/saveQueue.ts`, `src/store/markupSaves.ts`, `AGENTS.md`, die beiden älteren Spezifikationen (Hinweis oben)
- Test: `tests/pdfMarkup/markupFile.test.ts`, `tests/markup/saveQueue.test.ts`, `tests/markup/markupModels.test.ts`

**Interfaces:**
- Produces (Endzustand):
  ```ts
  export interface LoadMarkupResult { source: "pdf" | "none"; pages: LoadedMarkupPage[]; writeBlock: WriteBlock | null }
  // saveMarkupInputSchema: { path, pages }   (deleteLegacySidecar removed)
  export interface SaveMarkupResult { status: "pdf" | "error"; message?: string; reason?: SaveFailureReason }
  // SaveEvent "saved": status is always "pdf"; MarkupSaveQueue loses allowLegacyDelete
  ```

- [ ] **Step 1: Tests umstellen** (`markupFile.test.ts`). Entfallen: alle Fälle zu Fallback, v1-Zusammenführen, `mustStayInSidecar` (ganzer `describe` „B1“), „legacy sidecar in the sidecar fallback“, `pdfIssue`. Neu:

```ts
test.each([["encrypted", ...], ["unparseable", ...], ["read-only", ...]])
  ("%s: saving is an error with that reason and never creates a .data file", ...);   // readdir unchanged
test("a PDF that stays locked: error locked, PDF unchanged, no .data file", ...);     // also without embedded data
test("loading never reads a .data file next to the PDF", ...);                        // legacy and v1 file: source none, pages []
test("saving next to a .data file leaves it untouched", ...);
```

  `saveQueue.test.ts`: der `describe` „after a save went to the sidecar (B1)“ und die Fälle zu `allowLegacyDelete` entfallen; alle Eingaben ohne `deleteLegacySidecar`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Entfernen.** `markupFile.ts`: `fallback`, `writeSidecar`, `mustStayInSidecar`, `loadSidecar`, das eigene `readSidecar`, der Parameter `deleteLegacySidecar`; der Kopfkommentar beschreibt die neue Regel. `saveQueue.ts`: `sidecarPages`, `deleteLegacySidecar`, `allowLegacyDelete`. `markupSaves.ts`: `sidecarHintText`, `sidecarHintSeen`.
- [ ] **Step 4:** `npm test`, `npm run lint` → sauber; `git grep -n "sidecarPages\|allowLegacyDelete\|legacyOverlayData\|pdfIssue\|status === \"sidecar\"" src` → keine Treffer.
- [ ] **Step 5: Dokumentation.** `AGENTS.md`, Abschnitt „Markup storage“: Absätze „Sidecar fallback“ und „Bulk migration“ durch die neue Regel ersetzen (Schranke in zwei Durchgängen, `markup-migrated-folders.json`, kein Fallback, Prüfung beim Öffnen, neue Bedeutung von `SMV_DISABLE_BULK_MIGRATION`: der Ordner gilt als übernommen). Die beiden älteren Spezifikationen bekommen in der Kopfzeile den Hinweis „Teilweise ersetzt durch `2026-11-20-strict-markup-migration-design.md`“.
- [ ] **Step 6: Commit** `refactor: store markup only in the PDF, remove the sidecar fallback`

---

### Task 10: Visuelle Tests auf dem Korpus über die Schranke

**Files:**
- Modify: `tests/visual/corpus.ts`, `tests/visual/compare.visual.ts`, `tests/visual/bulkMigration.visual.ts`, `tests/visual/markupInPdf.visual.ts`, `AGENTS.md` (Abschnitt „Visual tests“)

**Interfaces:**
- Produces: `copyCorpusFiles(target: string, pdfPaths: string[]): string` in `corpus.ts` (kopiert nur die genannten PDFs und ihre `.data` in einen frischen Ordner).

- [ ] **Step 1: `compare.visual.ts`.** Je PDF eine Kopie mit genau dieser Datei (`copyCorpusFiles`), Start mit `bulkMigration: true`; die Schranke übernimmt beim Start, danach öffnet der Test das Blatt. Die Prüfungen A, B, Ar, C, D, E, Er gegen die Referenz der alten App bleiben unverändert; „.data entfernt“ und „PDF gewachsen“ gelten schon vor dem Öffnen.
- [ ] **Step 2: `bulkMigration.visual.ts` neu fassen** (ganzer Korpus, eine Kopie):

```ts
test("the whole corpus passes the gate", ...);
// no .data left; exactly one zip in the root; every zip entry byte-equal to the file before the migration;
// every PDF has embedded pages for its markedPages; second start with the same profile: gate "passed", no dialog;
// no network request
test("prepared failures among the corpus: all listed, every file byte-equal, no zip", ...);
// damaged .data, chmod 444 PDF, an added encrypted PDF with a .data; then fix all three and start again -> passed
```

  Der Vergleich „Sammelmigration gegen Migration beim Öffnen“ (Kopie B) und der Fall „schreibgeschützter Ordner wird einmal gemeldet“ entfallen; ein schreibgeschützter Ordner steht jetzt als `readOnly` je Datei in der Liste (ein Fall dafür).
- [ ] **Step 3: `markupInPdf.visual.ts`.** Die Tests „unparseable legacy file“ und „partly unconvertible legacy file“ entfallen (abgedeckt durch Task 7); der erste Test startet mit `bulkMigration: true`.
- [ ] **Step 4:** `npm run test:visual` (headless, mehrere Minuten; braucht `Noten/`) → alle bestehen. Ohne Korpus werden die Korpus-Tests übersprungen; dann das im Abschlussbericht sagen statt „bestanden“.
- [ ] **Step 5:** `AGENTS.md`, „Visual tests“: `bulkMigration: true` lässt die Schranke laufen, sonst gilt der Ordner als übernommen; neue Testdateien nennen.
- [ ] **Step 6: Commit** `test: run the visual comparison through the migration gate`
