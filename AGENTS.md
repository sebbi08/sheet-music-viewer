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
  `folderConfig.visual.ts` (`.config.json`) and the read-only folder case of `bulkMigration.visual.ts`;
  see "Markup storage" for what each file checks.
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
- **Check on open:** every open determines whether markup can be saved into the PDF
  (`LoadMarkupResult.writeBlock`, `checkMarkupWritable`: encrypted, unparseable, read-only incl. a folder
  probe file, or a trial build in memory that fails) and, if not, shows a dialog with the reason on
  **every** open (`src/components/WriteBlockDialog.vue`); the sheet stays readable, the pencil is off.
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
  `.set-lists.json`) and `markupMigrated`. On the first load of a folder without it, `.set-lists.json` is
  taken over: `.config.json` is written and read back, only then the old file is deleted. Writes change
  one part, atomically and only on a real change; reads are retried while the file is locked. An
  unreadable file is never overwritten (set lists show a notice and are not saved; the gate lists it), and
  a sheet folder that does not exist is unreadable, not empty. A set-list save sends the set lists it was
  based on and writes only while the file still holds them; otherwise the store reloads them and asks to
  repeat the change. A file of a newer app (`version` above 1 or `setLists.version` above 2) is a
  `configNewer` failure in the gate and a set-list notice asking to update the app; unknown fields
  (also inside set lists and `markupMigrated`) survive every write.

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
- `build.yml` only builds (push to `master`/`renovate/**`, PRs) and never publishes
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
