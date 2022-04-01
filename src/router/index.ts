import Vue from "vue";
import VueRouter, { RouteConfig } from "vue-router";
import SheetSelection from "@/views/SheetSelection.vue";
import FolderSetup from "@/views/FolderSetup.vue";
import store from "@/store";
import SheetViewer from "@/views/SheetViewer.vue";
import { RouteNames } from "@/Enums";
import Overview from "@/views/Overview.vue";
import SetListList from "@/views/SetListList.vue";
import SetListVue from "@/views/SetList.vue";

Vue.use(VueRouter);

const routes: Array<RouteConfig> = [
  {
    path: "/sheetViewer/:path:",
    component: SheetViewer,
    name: RouteNames.SheetViewer,
  },
  { path: "/", redirect: "/overview", name: RouteNames.Root },
  {
    path: "/sheetSelection/:path?",
    name: RouteNames.SheetSelection,
    component: SheetSelection,
  },
  {
    path: "/folderSetup",
    name: RouteNames.FolderSetup,
    component: FolderSetup,
  },
  {
    path: "/overview",
    name: RouteNames.Overview,
    component: Overview,
  },
  {
    path: "/SetListList",
    name: RouteNames.SetListList,
    component: SetListList,
  },
  {
    path: "/SetList/:id:",
    name: RouteNames.SetList,
    component: SetListVue,
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
