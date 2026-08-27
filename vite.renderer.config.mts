import vue from "@vitejs/plugin-vue";
import ViteFonts from "unplugin-fonts/vite";
import Components from "unplugin-vue-components/vite";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import Vuetify, { transformAssetUrls } from "vite-plugin-vuetify";

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    // Serve the pdf.js assets (WASM decoders, cmaps, standard fonts) in dev
    // and copy them into the renderer build output so they end up in the
    // packaged asar, where they are served via the custom "app" protocol.
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/pdfjs-dist/wasm/**/*",
          dest: "pdfjs/wasm",
          rename: { stripBase: true },
        },
        {
          src: "node_modules/pdfjs-dist/standard_fonts/**/*",
          dest: "pdfjs/standard_fonts",
          rename: { stripBase: true },
        },
        {
          src: "node_modules/pdfjs-dist/cmaps/**/*",
          dest: "pdfjs/cmaps",
          rename: { stripBase: true },
        },
      ],
    }),
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
