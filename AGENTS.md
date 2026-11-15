# AGENTS.md

## Build & Run

```bash
npm start              # dev mode (hot-reload)
npm run make           # build distributables (all platforms, x64 only)
npm run package        # package only (no installer)
npm run lint           # eslint --ext .ts,.tsx .
npm test               # placeholder, no real tests
```

## Architecture

- **Electron Forge** + **Vite** (3 separate configs: main, preload, renderer)
- **Vue 3** + **Vuetify 4** + **Pinia** + **Vue Router** (hash mode)
- **tRPC** (`electron-trpc`) for type-safe IPC between main and renderer
- Entry points: `src/main.ts` (main), `src/preload.ts` (preload), `src/renderer.ts` (renderer)
- Vite build output goes to `.vite/`, Electron Forge output to `out/`
- ASAR packaging enabled; fuses: RunAsNode=false, CookieEncryption, AsarIntegrity

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
- Locally, `npm run semantic-release` runs `semantic-release --no-ci`; needs `GH_TOKEN`
  (or `GITHUB_TOKEN`) in the environment
- Only `master` branch is used

## Key Dependencies

- `fabric` (canvas manipulation), `pdfjs-dist` (PDF rendering)
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
