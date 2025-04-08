import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import Vuetify, { transformAssetUrls } from "vite-plugin-vuetify";
// eslint-disable-next-line import/no-unresolved
import Components from 'unplugin-vue-components/vite'
// eslint-disable-next-line import/no-unresolved
import ViteFonts from 'unplugin-fonts/vite'


// https://vitejs.dev/config
export default defineConfig({
  plugins: [
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
