# Einstellungen im Notenordner – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setlisten und die Übernahme-Markierung der Schranke stehen in `.config.json` im Notenordner (teilbar zwischen PCs); `.set-lists.json` wird übernommen, das Profil-File `markup-migrated-folders.json` entfällt.

**Architecture:** Ein neues Modul im Hauptprogramm (`src/folderConfig.ts`, ohne Electron-Importe) liest die Datei (mit Übernahme der alten `.set-lists.json`) und ändert je Aufruf genau einen Teil, atomar und nur bei echter Änderung. Setlisten (tRPC + Pinia-Store) und die Schranke (`isMigrated`/`markMigrated`) gehen über dieses Modul.

**Tech Stack:** TypeScript, Electron/tRPC, Vue 3 + Pinia, zod, vitest, Playwright `_electron` (headless).

**Spec:** `docs/superpowers/specs/2026-11-22-folder-config-design.md`

## Global Constraints

- Dateiname `.config.json` im Hauptordner des Notenordners; Format `{ "version": 1, "setLists": <bisheriges Format Version 2>, "markupMigrated": { "at": <ISO-Zeit> } }`; unbekannte Felder bleiben erhalten.
- Nur eine fehlende Datei gilt als leer. Eine nicht lesbare Datei (Lesefehler, kein JSON, Schema verletzt, `version` ≠ 1) wird nie überschrieben.
- `.set-lists.json` wird erst gelöscht, nachdem ihr Inhalt aus `.config.json` zurückgelesen wurde.
- Schreiben nur, wenn sich der Inhalt ändert; atomar (temporäre Datei im selben Ordner + Rename, `retryWhileLocked` aus `src/pdfMarkup/lockRetry.ts`).
- `src/folderConfig.ts` und alles unter `src/migration/`, `src/pdfMarkup/` ohne Electron-Importe; `src/migration/gate.ts` ohne `node:`-Importe.
- Texte der Oberfläche deutsch, verbindlich wo im Plan wörtlich angegeben.
- GUI-Tests nur headless (nie `VISUAL_HEADED`); `Noten/` nur kopieren, nie öffnen.
- Conventional Commits (commitlint, Zeilen im Body ≤ 100 Zeichen); Prüfbefehle `npm test`, `npm run lint`, `npx vitest run -c vitest.visual.config.mts <datei>`.

## Review Focus

1. **Zwei PCs, eine Datei:** PC A speichert Setlisten, während PC B (über Nextcloud) die Markierung geschrieben hat → A darf B's `markupMigrated` nicht verlieren (jede Änderung liest frisch von der Platte). → Task 1, Test „updating set lists keeps a mark written by someone else".
2. **Ordnerwechsel während die Setlisten noch laden:** Die Setlisten von Ordner A dürfen nie in B landen. → Task 2, e2e „set lists stay in their folder when another folder is chosen".
3. **Schreibgeschützter Ordner:** Setlisten-Änderung zeigt einen Hinweis statt still zu verschwinden; die Schranke besteht ohne `.data` und läuft beim nächsten Start erneut. → Task 2 (Unit für das Ergebnis `{ ok: false }`), Task 3 (Gate-Test „marking fails").
4. **Ein PC mit neuerer App schreibt `version: 2`:** diese Version überschreibt nichts und meldet die Datei als nicht lesbar. → Task 1, Test „an unknown version is unreadable and never overwritten".
5. **Gesperrte `.set-lists.json` beim Löschen nach der Übernahme:** `.config.json` gilt, die alte Datei bleibt, nichts geht verloren. → Task 1, Test „a legacy file that cannot be deleted stays, the config wins".

## Dateiübersicht

| Datei | Aufgabe |
|---|---|
| `src/folderConfig.ts` (neu) | Lesen, Übernahme von `.set-lists.json`, Ändern eines Teils |
| `src/trcpLib.ts` | `loadSetLists`/`saveSetLists` über `folderConfig`; `migrateSetListsToV2` wandert nach `folderConfig.ts` |
| `src/trcpRouter.ts` | Setlisten-Prozeduren, `isMarkupFolderMigrated`/`markMarkupFolderMigrated` über `folderConfig`; Profil-File löschen |
| `src/store/index.ts`, `src/App.vue` | Setlisten laden/speichern pro Ordner, Hinweise, Fehler beim Ordnerwechsel |
| `src/migration/gate.ts`, `types.ts`, `texts.ts`, `src/store/bulkMigration.ts` | neue Rückgabe von `isMigrated`, Fehlergrund `configUnreadable` |
| entfällt | `src/migration/migratedFolders.ts`, `tests/migration/migratedFolders.test.ts` |

---

### Task 1: Modul `folderConfig`

**Files:**
- Create: `src/folderConfig.ts`
- Modify: `src/trcpLib.ts` (nur: `migrateSetListsToV2` nach `folderConfig.ts` verschieben und von dort importieren)
- Test: `tests/folderConfig.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const CONFIG_FILE = ".config.json";
  export const LEGACY_SET_LISTS_FILE = ".set-lists.json";
  export const folderConfigSchema; // z.object({ version: z.literal(1), setLists: setListsWrapperSchema.optional(),
                                   //   markupMigrated: z.object({ at: z.string() }).passthrough().optional() }).passthrough()
  export type FolderConfig = z.infer<typeof folderConfigSchema>;
  export type FolderConfigRead =
    | { kind: "missing" }
    | { kind: "ok"; config: FolderConfig }
    | { kind: "unreadable"; file: string; message: string }; // file: basename (".config.json" or ".set-lists.json")
  /** Reads the config; takes over `.set-lists.json` when `.config.json` is missing. Never throws. */
  export function loadFolderConfig(folder: string): Promise<FolderConfigRead>;
  export class FolderConfigUnreadableError extends Error { readonly file: string; }
  /** Sets the given parts (others and unknown fields kept); reads fresh, writes atomically, skips unchanged content.
   *  Throws FolderConfigUnreadableError for an unreadable file, and I/O errors as they are. */
  export function updateFolderConfig(
    folder: string,
    patch: { setLists?: SetListsWrapper; markupMigrated?: { at: string } },
  ): Promise<void>;
  export function migrateSetListsToV2(json: string): string; // moved unchanged from trcpLib.ts
  ```
  Both functions run one after another per folder (same pattern as `serialized` in `src/pdfMarkup/markupFile.ts`).

- [ ] **Step 1: Failing tests** (temp dir per test; `isRoot` guard for chmod cases as in `tests/pdfMarkup/markupFile.test.ts`):

```ts
test("no file -> missing, nothing written", ...);                       // readdir unchanged
test("a valid file -> ok with its content", ...);
test.each([["broken JSON", "{"], ["wrong schema", '{"version":1,"setLists":7}'],
           ["unknown version", '{"version":2}']])("%s -> unreadable", ...); // file ".config.json", non-empty message
test.skipIf(isRoot)("a file that cannot be read -> unreadable with the error", ...);
test("updating set lists keeps the mark and unknown fields", ...);
test("updating set lists keeps a mark written by someone else", async () => {
  // load, then write a mark into the file directly (another PC), then updateFolderConfig({ setLists })
  // -> the file holds both the new set lists and that mark
});
test("unchanged content is not written", ...);                            // mtime and inode unchanged after a no-op update
test("an unreadable file is never overwritten", ...);                     // update rejects with FolderConfigUnreadableError, bytes unchanged
test("an unknown version is unreadable and never overwritten", ...);
test("no temp file is left after a write", ...);
test("a legacy v2 file is taken over and deleted after the read-back", ...); // .config.json has its setLists, .set-lists.json gone
test("a legacy v1 file is converted to v2 on takeover", ...);
test("a broken legacy file stays and the folder is unreadable", ...);     // file ".set-lists.json", nothing written
test("with both files the config wins and the legacy file is left alone", ...);
test("a legacy file that cannot be deleted stays, the config wins", ...);  // rm mocked to reject EPERM for that path; load -> ok
```

- [ ] **Step 2:** `npx vitest run tests/folderConfig.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement. Equality for "unchanged": compare `JSON.stringify` of the parsed current object and of the merged object, both with sorted keys. The temp file is `.<CONFIG_FILE>.smv-tmp` in the folder; open and rename via `retryWhileLocked`; remove the temp file on any failure. A failed delete of the legacy file is logged, not thrown.
- [ ] **Step 4:** Tests → PASS; `npm test`, `npm run lint` green.
- [ ] **Step 5: Commit** `feat: keep set lists and the migration mark in .config.json in the sheet folder`

---

### Task 2: Setlisten über `.config.json`

**Files:**
- Modify: `src/trcpLib.ts`, `src/trcpRouter.ts`, `src/store/index.ts`, `src/App.vue`, `src/views/FolderSetup.vue` (nur falls nötig für den Ordnerwechsel)
- Test: `tests/setLists.test.ts` (neu, für die Funktionen in `trcpLib.ts`), `tests/visual/folderConfig.visual.ts` (neu)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  // src/trcpLib.ts
  export type LoadSetListsResult =
    | { kind: "ok"; setLists: SetListsWrapper }               // missing file or missing field -> { version: 2, setLists: [] }
    | { kind: "unreadable"; file: string; message: string };
  export function loadSetLists(folder: string): Promise<LoadSetListsResult>;
  export function saveSetLists(input: { basePath: string; setListsWrapper: SetListsWrapper }):
    Promise<{ ok: true } | { ok: false; message: string }>;   // never throws
  // tRPC: loadSetLists query(folder) -> LoadSetListsResult; saveSetLists becomes a mutation
  // store (src/store/index.ts) state: setListsFolder: string ("" = none loaded), setListsError: string | null
  ```
- Notice texts (binding):
  - load unreadable: `Die Setlisten konnten nicht geladen werden („‹file›“: ‹message›). Änderungen an Setlisten werden nicht gespeichert.`
  - save failed: `Die Setlisten konnten nicht gespeichert werden: ‹message›.` (a message that already ends with a period gets no second one)

- [ ] **Step 1: Failing unit tests** (`tests/setLists.test.ts`): `loadSetLists` on a missing file → `ok` with empty lists, on a file without `setLists` → `ok` empty, on broken JSON → `unreadable`; `saveSetLists` keeps an existing `markupMigrated`; on an unreadable file → `{ ok: false }` and bytes unchanged; on a read-only folder (`skipIf(isRoot)`) → `{ ok: false }`.
- [ ] **Step 2: Failing e2e** `tests/visual/folderConfig.visual.ts` (style of `tests/visual/folderSetup.visual.ts`: synthetic folders below `test-results/visual/work/`, LIFO cleanup, the folder dialog stubbed in main):
  ```ts
  test("set lists stay in their folder when another folder is chosen", ...);
  // folders A and B, each with a .config.json holding one distinct set list; start in A;
  // choose B on the folder page; wait until the set-list overview shows B's list;
  // A's and B's .config.json byte-identical to before
  test(".set-lists.json is taken over into .config.json on start", ...);
  // folder with only .set-lists.json (v2, one list) -> after start: .config.json holds that list, .set-lists.json gone
  test("a start without changes does not write .config.json", ...);  // bytes and mtime unchanged after start and opening the set-list overview
  test("a broken .config.json shows the notice and is not overwritten", ...); // with SMV_DISABLE_BULK_MIGRATION (driver default)
  ```
- [ ] **Step 3:** Run both → FAIL.
- [ ] **Step 4: Implement.**
  - `trcpLib.ts`: the two functions above on top of `loadFolderConfig` / `updateFolderConfig`.
  - Store: `loadSetLists()` loads for the current folder and, only on `ok`, sets `setListsWrapper`, `setListsFolder` and a snapshot of what was loaded; on `unreadable` it sets `setListsError`, empties the lists in memory and shows the notice (`useNotices`). `saveSetLists()` returns without saving unless `setListsFolder === sheetMusicFolder`, `setListsError === null` and the lists differ from the last loaded or saved snapshot; a failed save shows the notice.
  - `setSheetMusicFolder()`: no `saveSetLists()` any more; it resets `setListsFolder`, `setListsError` and the lists, then loads the new folder's lists.
  - `App.vue`: the deep watch stays; it now saves only real changes (via the store's rule).
- [ ] **Step 5:** Unit and e2e → PASS; `npm test`, `npm run lint` green.
- [ ] **Step 6: Commit** `fix: load and save set lists per sheet folder through .config.json`

---

### Task 3: Schranke über `.config.json`

**Files:**
- Modify: `src/migration/gate.ts`, `src/migration/types.ts`, `src/migration/texts.ts`, `src/store/bulkMigration.ts`, `src/trcpRouter.ts`
- Delete: `src/migration/migratedFolders.ts`, `tests/migration/migratedFolders.test.ts`
- Test: `tests/migration/gate.test.ts`, `tests/migration/texts.test.ts`, `tests/visual/migrationGate.visual.ts`, `tests/visual/bulkMigration.visual.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  // src/migration/types.ts
  export type MigratedState = "migrated" | "notMigrated" | { unreadable: { file: string; message: string } };
  // GateFailureReason gets "configUnreadable"
  // src/migration/gate.ts: GateDeps.isMigrated(root: string): Promise<MigratedState>
  // tRPC isMarkupFolderMigrated -> MigratedState (test switch: "migrated", nothing read or written)
  // tRPC markMarkupFolderMigrated -> updateFolderConfig(root, { markupMigrated: { at: new Date().toISOString() } })
  ```
- Binding text for `configUnreadable` (`failureText`, `relativePath` = the file name):
  `Die Einstellungsdatei „‹relativePath›“ kann nicht gelesen werden: ‹message›. Bitte reparieren oder löschen; die Setlisten darin gehen beim Löschen verloren.`
  It does not count as a file problem in the headlines; like `folderUnreadable` it adds the lead
  `Der Notenordner konnte nicht vollständig geprüft werden.`

- [ ] **Step 1: Failing unit tests** (`gate.test.ts`):
  ```ts
  test("migrated -> passed without a scan", ...);
  test("an unreadable config is listed and the run still checks every file, then fails without writing", ...);
  // isMigrated -> { unreadable }; scan and pass 1 run; result failed (stage check) with a configUnreadable
  // failure (relativePath ".config.json") plus the files' own failures; createBackup and markMigrated never called
  test("marking fails: the run still passes", ...);                // existing behaviour, kept
  ```
  and in `texts.test.ts` the binding text and the headline for a run with only `configUnreadable`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implement.** The gate records `configUnreadable` as a failure at the start and runs on as for a folder that is not migrated (a rejected `isMigrated` keeps counting as `notMigrated`). Main: the two procedures use `loadFolderConfig` / `updateFolderConfig`; at module start, best effort, delete `<userData>/markup-migrated-folders.json` (`fs.promises.rm(…, { force: true })`, a failure is only logged).
- [ ] **Step 4: e2e.** In `migrationGate.visual.ts` and `bulkMigration.visual.ts`, every assertion on `markup-migrated-folders.json` in the profile becomes one on `markupMigrated` in the folder's `.config.json`. Drop the snapshot exclusion of `.set-lists.json`: after a failed check the folder must be byte-identical including `.config.json`. Add to `migrationGate.visual.ts`:
  ```ts
  test("a folder deleted and copied again after it was marked runs the gate again", ...);
  // pass the gate in folder F (one legacy file); delete F, copy the original files to F again (without .config.json);
  // start again with the same profile -> the gate runs and migrates
  test("a second start does not rewrite .config.json", ...);       // bytes and mtime unchanged
  test("a broken .config.json is listed by the gate and not overwritten", ...);
  ```
- [ ] **Step 5:** `npm test`, `npm run lint`, `migrationGate.visual.ts`, `folderConfig.visual.ts` green.
- [ ] **Step 6: Commit** `feat: keep the migration mark in the sheet folder's .config.json`

---

### Task 4: Dokumentation und Gesamtlauf

**Files:** `AGENTS.md`, `docs/superpowers/specs/2026-11-20-strict-markup-migration-design.md`

- [ ] **Step 1:** `AGENTS.md`, „Markup storage": `markup-migrated-folders.json` durch `markupMigrated` in `.config.json` im Notenordner ersetzen (geteilt zwischen PCs, frische Kopie ohne Datei durchläuft die Schranke); ein Satz zu `.config.json` (Setlisten + Markierung, Übernahme von `.set-lists.json`, nicht lesbare Datei wird nie überschrieben). „Visual tests": `folderConfig.visual.ts` mit einer Zeile nennen.
- [ ] **Step 2:** Spezifikation der Schranke: oben „Teilweise ersetzt durch `2026-11-22-folder-config-design.md`"; in Abschnitt 1 und im Nicht-Ziel zum Wiederherstellen aus der ZIP auf `.config.json` verweisen.
- [ ] **Step 3:** Ganzer visueller Lauf (`npm run test:visual`, im Hintergrund, Ausgabe in eine Datei unter `test-results/`, ca. 20 min): alle Dateien grün, Vergleich mit der alten App ohne Abweichung. Danach kein Electron-Prozess aus dem Worktree, `test-results/visual/work/` leer.
- [ ] **Step 4: Commit** `docs: describe .config.json in the sheet folder`
