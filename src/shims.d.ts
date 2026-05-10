import { basename, dirname, relative } from "node:path";

export declare global {
  import IpcRenderer = Electron.IpcRenderer;

  interface Window {
    ipcRenderer: IpcRenderer;
    path: {
      sep: string;
      relative: typeof relative;
      basename: typeof basename;
      dirname: typeof dirname;
    };
    shell: {
      openExternal: (url: string) => Promise<void>
    };
  }
}

declare module "vuex" {
  export * from "vuex/types/helpers.d.ts";
  export * from "vuex/types/index.d.ts";
  export * from "vuex/types/logger.d.ts";
}
