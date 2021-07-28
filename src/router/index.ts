import Vue from "vue";
import VueRouter, { RouteConfig } from "vue-router";
import SheetSelection from "@/views/SheetSelection.vue";
import FolderSetup from "@/views/FolderSetup.vue";
import store from "@/store";

Vue.use(VueRouter);

const routes: Array<RouteConfig> = [
  { path: "/", redirect: "/sheetSelection", name: "Root" },
  {
    path: "/sheetSelection/:path:",
    name: "SheetSelection",
    component: SheetSelection,
  },
  {
    path: "/folderSetup",
    name: "FolderSetup",
    component: FolderSetup,
  },
];

const router = new VueRouter({
  mode: "history",
  base: process.env.BASE_URL,
  routes,
});

router.beforeEach((to, from, next) => {
  if (to.name === "FolderSetup") {
    next();
  }
  if (store.getters.getField("sheetMusicFolder") && to.name !== "FolderSetup") {
    next();
  } else {
    next({ name: "FolderSetup" });
  }
});

export default router;
