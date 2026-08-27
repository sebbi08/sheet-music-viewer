import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import Vuetify, { transformAssetUrls } from "vite-plugin-vuetify";
import Components from 'unplugin-vue-components/vite'
import ViteFonts from 'unplugin-fonts/vite'
import { copy, ensureDir } from "fs-extra";
import { fileURLToPath } from "node:url";

const pdfJsAssetCopies = [
  {
    from: fileURLToPath(new URL("./node_modules/pdfjs-dist/wasm", import.meta.url)),
    to: fileURLToPath(new URL("./public/pdfjs/wasm", import.meta.url)),
  },
  {
    from: fileURLToPath(new URL("./node_modules/pdfjs-dist/standard_fonts", import.meta.url)),
    to: fileURLToPath(new URL("./public/pdfjs/standard_fonts", import.meta.url)),
  },
  {
    from: fileURLToPath(new URL("./node_modules/pdfjs-dist/cmaps", import.meta.url)),
    to: fileURLToPath(new URL("./public/pdfjs/cmaps", import.meta.url)),
  },
];

async function copyPdfJsAssets(): Promise<void> {
  for (const asset of pdfJsAssetCopies) {
    await ensureDir(asset.to);
    await copy(asset.from, asset.to, { overwrite: true, recursive: true });
  }
}

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    {
      name: "copy-pdfjs-assets",
      async generateBundle(): Promise<void> {
        await copyPdfJsAssets();
      },
    },
    vue({
      template: { transformAssetUrls },
    }),
    // https://github.com/vuetifyjs/vuetify-loader/tree/master/packages/vite-plugin#readme
    Vuetify(),
    Components(),
    ViteFonts({
      google: {
        families: [
          {
            name: "Roboto",
            styles: "wght@100;300;400;500;700;900",
          },
        ],
      },
    }),
  ],
  css: {
    preprocessorOptions: {
      sass: {
        api: "modern-compiler",
      },
    },
  },
});
