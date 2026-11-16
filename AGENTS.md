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
  Needs the local `Noten/` corpus with `.data` files; without it the tests are skipped.
- Never opens anything inside `Noten/`: every run works on a copy (the new app migrates on open).
- Builds both apps (`electron-forge package`; the old one in a git worktree below
  `test-results/visual/worktrees/`). The old app's reference images are cached in
  `test-results/visual/baseline/<ref>/` and recaptured when the PDF, its `.data` or the commit
  change. An uncached run takes several minutes.
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
  draws the markup with fabric instead, other viewers show and print the stamp.
- **Sidecar fallback** (`.<name>.data`, v1 format) only for PDFs **without** embedded data that are
  encrypted, unparseable, read-only or stay locked; with embedded data a failed write is an error
  (never two competing states). Legacy `.data` files are migrated into the PDF on open and deleted
  after the read-back succeeded. While a PDF without embedded data has a v1 sidecar, only the
  migrating save (all sidecar pages + `deleteLegacySidecar`) writes the PDF; the save queue carries
  the sidecar pages with every save after a `sidecar` result, so nothing is hidden behind a partial PDF.
- Unsaved changes live in the renderer's `markupSaves` store (`src/markup/saveQueue.ts`), survive
  leaving the sheet, are retried every 30 s, and closing the window asks before discarding them
  (renderer: `src/markup/closeGuard.ts`; main: `src/exitGuardMachine.ts` + `src/exitGuard.ts`). Main
  shows the dialog itself if the renderer has not reported within 10 s, on a second close while the
  save runs, or when the renderer hangs; a crashed renderer never blocks closing.
- **Bulk migration** (spec: `docs/superpowers/specs/2026-11-16-bulk-markup-migration-design.md`): on
  every start and after a folder change, all PDFs below the sheet folder that still have a legacy
  `.data` file are migrated behind a blocking dialog (`src/components/MigrationDialog.vue`, store
  `src/store/bulkMigration.ts`, logic in `src/migration/`, no Electron imports). The renderer converts
  each file with the same code as the migration on open; main finds the candidates, writes the backup
  and saves. Before anything is migrated, main writes **`Markierungen-Backup YYYY-MM-DD HH-MM.zip`**
  (local time; ` (2)` … on a collision) into the sheet folder with every candidate PDF and `.data`,
  and verifies it (size + CRC-32 per entry); a failed backup migrates nothing. Permanent failures
  (`corruptData`, `alreadyEmbedded`, `notWritable`) go to `bulk-migration-skips.json` in the Electron
  profile (userData) and are not reported again until the PDF or its `.data` changes; all other
  failures are retried on the next start. `SMV_DISABLE_BULK_MIGRATION=1` makes the candidate search
  return nothing (tests only: the visual driver sets it unless `bulkMigration: true`, so the visual
  tests keep checking the migration on open).
- Visual tests (`npm run test:visual`, see above) compare migrated markup against the old app;
  `tests/visual/bulkMigration.visual.ts` checks that the bulk migration writes the same payloads and
  stamp pixels as the migration on open (plus backup zip, skip list and a read-only PDF).

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
