// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from "electron";
// eslint-disable-next-line import/no-unresolved
import { exposeElectronTRPC } from "electron-trpc/main";
import { basename, relative, sep,dirname } from "node:path";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("ipcRenderer", {
  send: (channel: string, data: unknown) => {
    // whitelist channels
    ipcRenderer.send(channel, data);
  },
  on: (channel: string, func: () => void) => {
    ipcRenderer.on(channel, func);
  },
  once: (channel: string, func: () => void) => {
    ipcRenderer.once(channel, func);
  },
  removeListener: (channel: string, func: () => void) => {
    ipcRenderer.removeListener(channel, func);
  },
});

contextBridge.exposeInMainWorld("path", {
  sep: sep,
  relative: relative,
  basename,
  dirname
});

process.once("loaded", async () => {
  exposeElectronTRPC();
});
