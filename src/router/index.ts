import { createRouter, createWebHashHistory, type RouterOptions } from "vue-router";
import useStore from "../store";
import { RouteNames } from "../Enums";
import Overview from "../views/Overview.vue";
import FolderSetup from "../views/FolderSetup.vue";
import SheetSelection from "../views/SheetSelection.vue";
import SetListList from "../views/SetListList.vue";
import SetListVue from "../views/SetList.vue";
import SheetViewer from "../views/SheetViewer.vue";

const routes: RouterOptions["routes"] = [
  {
    path: "/sheetViewer/:path:",
    component: SheetViewer,
    name: RouteNames.SheetViewer,
  },
  { path: "/", name: RouteNames.Overview, component: Overview },
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


const router = createRouter({

  history: createWebHashHistory(),
  routes,
});


router.beforeEach((to, from, next) => {
  
const store = useStore();
  if (to.name === "FolderSetup") {
    next();
    return;
  }
  if (store.sheetMusicFolder && to.name !== "FolderSetup") {
    next();
  } else {
    next({ name: "FolderSetup" });
  }
});

export default router;
