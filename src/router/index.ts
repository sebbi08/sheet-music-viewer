import Vue from "vue";
import VueRouter, { RouteConfig } from "vue-router";
import SheetSelection from "@/views/SheetSelection.vue";
import FolderSetup from "@/views/FolderSetup.vue";
import store from "@/store";
import SheetViewer from "@/views/SheetViewer.vue";
import { RouteNames } from "@/Enums";

Vue.use(VueRouter);

const routes: Array<RouteConfig> = [
  {
    path: "/sheetViewer/:path:",
    component: SheetViewer,
    name: RouteNames.SheetViewer,
  },
  { path: "/", redirect: "/sheetSelection", name: RouteNames.Root },
  {
    path: "/sheetSelection/:path:",
    name: RouteNames.SheetSelection,
    component: SheetSelection,
  },
  {
    path: "/folderSetup",
    name: RouteNames.FolderSetup,
    component: FolderSetup,
  },
];

const router = new VueRouter({
  // mode: "history",
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
