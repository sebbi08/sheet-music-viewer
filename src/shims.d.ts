/* eslint-disable import/no-unresolved */
export declare global {
  import IpcRenderer = Electron.IpcRenderer;

  interface Window {
    ipcRenderer: IpcRenderer;
    path: {sep: string};
  }
}

declare module "vuex" {
  export * from "vuex/types/index.d.ts";
  export * from "vuex/types/helpers.d.ts";
  export * from "vuex/types/logger.d.ts";
}