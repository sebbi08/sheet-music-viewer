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
- **tRPC** (`trpc-electron`) for type-safe IPC between main and renderer
- Entry points: `src/main.ts` (main), `src/preload.ts` (preload), `src/renderer.ts` (renderer)
- Vite build output goes to `.vite/`, Electron Forge output to `out/`
- ASAR packaging enabled; fuses: RunAsNode=false, CookieEncryption, AsarIntegrity

## Auto-Update

- Uses `update-electron-app` which points at GitHub Releases via `update.electronjs.org`
- Disabled in dev (`!app.isPackaged`); configured in `src/main.ts` with `repo: "sebbi08/sheet-music-viewer"`
- Update events exposed to renderer via tRPC subscriptions in `src/trcpRouter.ts`
- `electron-squirrel-startup` handles Windows install/uninstall shortcuts in `src/main.ts`

## Release Process

- **Manual trigger**: `npm run release` — loads `.env`, runs `semantic-release --no-ci`, pushes, then runs `electron-forge publish`
- **Automatic via CI**: semantic-release runs on push to `master`, bumps version, creates a **GitHub Release** (via `@semantic-release/github`), commits, pushes
- CI (`build.yml`) then triggers on the resulting tag (`v*`) and uploads build artifacts to the GitHub Release via `@electron-forge/publisher-github`
- `.env` file must contain `GH_TOKEN` (or `GITHUB_TOKEN`) for GitHub authentication
- Only `master` branch is used

## Key Dependencies

- `fabric` (canvas manipulation), `pdfjs-dist` (PDF rendering)
- `lodash`, `fs-extra`, `glob`, `zod`, `superjson`
- `semantic-release` plugins: commit-analyzer, release-notes-generator, npm (publish disabled), changelog, git, github
- `@electron-forge/publisher-github` for publishing artifacts to GitHub Releases

## Notes

- The `Noten/` folder (local sheet music data) and `.env` are gitignored
- The publisher TS file lives in `publisher/` and is compiled separately (not part of the main tsconfig)
- Windows-only Squirrel maker; ZIP for macOS; RPM/DEB for Linux
- `opencode.json` has nothing besides MCP chrome-devtools config
