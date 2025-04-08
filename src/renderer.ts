import "@mdi/font/css/materialdesignicons.css";
import "roboto-fontface/css/roboto/roboto-fontface.css";
// eslint-disable-next-line import/no-unresolved
import "vuetify/styles";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router/index";
import { createPinia } from "pinia";

import { createVuetify } from "vuetify";

import "pdfjs-dist";
import * as pdfjsLib from "pdfjs-dist";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
// eslint-disable-next-line import/no-unresolved
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";
pdfjsLib.GlobalWorkerOptions.workerPort = new pdfjsWorker();

const vuetify = createVuetify({
  theme: {
    defaultTheme: "light",
  },
  locale: { locale: "de" },
});

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(vuetify);

app.mount("#app");
