// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import {contextBridge, ipcRenderer} from "electron";

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
    sep: "/",
});
