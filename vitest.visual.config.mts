import { defineConfig } from "vitest/config";

// Visual comparison against the old app: drives Electron (headless by default) on the local Noten/ corpus.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/visual/**/*.visual.ts"],
    testTimeout: 10 * 60 * 1000,
    fileParallelism: false,
    silent: false, // show the logged view-vs-edit offsets
  },
});
