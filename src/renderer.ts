import "@mdi/font/css/materialdesignicons.css"
import "roboto-fontface/css/roboto/roboto-fontface.css"
import Vue from "vue"
import App from "./App.vue"
import router from "./router/index"
import store from "./store/index"

import Vuetify from 'vuetify/lib'
import de from "vuetify/src/locale/de"

import "pdfjs-dist/webpack"

Vue.use(Vuetify);

const vuetify = new Vuetify({
    theme: {
        options: {
            customProperties: true,
        },
        themes: {
            light: {
                primary: "#007BFF",
                secondary: "#424242",
                accent: "#82B1FF",
                error: "#FF5252",
                info: "#2196F3",
                success: "#4CAF50",
                warning: "#FFC107",
            },
        },
    },
    lang: {
        locales: { de },
        current: "de",
    },
});


new Vue({
    router,
    store,
    vuetify,
    render: (h) => h(App),
}).$mount("#app");
