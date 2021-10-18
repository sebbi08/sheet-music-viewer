"use strict";

import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
} from "electron";
import { createProtocol } from "vue-cli-plugin-electron-builder/lib";
import installExtension, { VUEJS_DEVTOOLS } from "electron-devtools-installer";
import { EventNames } from "@/Enums";
import * as path from "path";
import * as fs from "fs/promises";
import log from "electron-log";
import { glob } from "glob";

Object.assign(console, log.functions);

const isDevelopment = process.env.NODE_ENV !== "production";

const DOMAIN = "https://updatefile.sebmahr.de";
const suffix =
  process.platform === "darwin"
    ? `/RELEASES.json?method=JSON&version=${app.getVersion()}`
    : "";
let updateError = "";
try {
  const url = `${DOMAIN}/sheet-viewer/8cb6264c2ffe3d74c14502443f492c0d/${process.platform}/${process.arch}${suffix}`;
  console.log(url);
  autoUpdater.setFeedURL({
    url: url,
    serverType: "json",
  });
} catch (e) {
  updateError = e;
  console.log(e);
}

autoUpdater.on("update-downloaded", (event, releaseNotes, releaseName) => {
  const dialogOpts = {
    type: "info",
    buttons: ["Restart", "Later"],
    title: "Application Update",
    message: process.platform === "win32" ? releaseNotes : releaseName,
    detail:
      "A new version has been downloaded. Restart the application to apply the updates.",
  };

  dialog.showMessageBox(dialogOpts).then((returnValue) => {
    if (returnValue.response === 0) autoUpdater.quitAndInstall();
  });
});

autoUpdater.on("error", (message) => {
  console.error("There was a problem updating the application");
  console.error(message);
});

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { secure: true, standard: true } },
]);

async function createWindow() {
  // Create the browser window.
  const preloadPath = path.join(__dirname, "preload.js");
  // eslint-disable-next-line no-debugger
  const win = new BrowserWindow({
    webPreferences: {
      // Use pluginOptions.nodeIntegration, leave this alone
      // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
      nodeIntegration: process.env
        .ELECTRON_NODE_INTEGRATION as unknown as boolean,
      contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION,
      preload: preloadPath,
    },
  });
  win.maximize();

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL as string);
    if (!process.env.IS_TEST) win.webContents.openDevTools();
  } else {
    createProtocol("app");
    // Load the index.html when not in development
    win.loadURL("app://./index.html");
  }
  if (updateError) {
    dialog.showMessageBox({
      message: "error",
      type: "info",
      detail: updateError.toString(),
    });
  } else {
    autoUpdater.checkForUpdates();
    // setInterval(() => {
    //   autoUpdater.checkForUpdates();
    // }, 60000);
  }
}

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", async () => {
  registerLocalResourceProtocol();
  if (isDevelopment && !process.env.IS_TEST) {
    // Install Vue Devtools
    try {
      await installExtension(VUEJS_DEVTOOLS);
    } catch (e) {
      console.error("Vue Devtools failed to install:", e.toString());
    }
  }
  createWindow();
});

function registerLocalResourceProtocol() {
  protocol.registerFileProtocol("local-resource", (request, callback) => {
    const url = request.url.replace(/^local-resource:\/\//, "");
    // Decode URL to prevent errors when loading filenames with UTF-8 chars or chars like "#"
    const decodedUrl = decodeURI(url); // Needed in case URL contains spaces
    try {
      return callback(decodedUrl);
    } catch (error) {
      console.error(
        "ERROR: registerLocalResourceProtocol: Could not get file path:",
        error
      );
    }
  });
}

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === "win32") {
    process.on("message", (data) => {
      if (data === "graceful-exit") {
        app.quit();
      }
    });
  } else {
    process.on("SIGTERM", () => {
      app.quit();
    });
  }
}

ipcMain.on(EventNames.GET_VERSION, (event) => {
  event.reply(EventNames.SEND_VERSION, app.getVersion());
});

ipcMain.on(EventNames.SELECT_FOLDER, (event) => {
  dialog
    .showOpenDialog({
      properties: ["openDirectory"],
    })
    .then(function (result) {
      event.reply(EventNames.FOLDER_SELECTED, result.filePaths[0]);
    });
});

ipcMain.on(EventNames.FOLDER_SELECTED, async (event, args) => {
  const basePath = args.basePath;
  const relativePath = args.relativePath;
  const folderPath = path.join(basePath, relativePath);
  let folderContent = await fs.readdir(folderPath, { withFileTypes: true });

  folderContent = folderContent.filter((item) => !item.name.startsWith("."));

  const filesAndFolders = folderContent.map((item) => {
    return {
      path: basePath,
      name: item.name,
      isFile: item.isFile(),
      isSearch: false,
    };
  });
  console.log(filesAndFolders);

  event.reply(EventNames.FOLDER_LOADED, filesAndFolders);
});
ipcMain.on(EventNames.SEARCH_FILES, async (event, args) => {
  const basePath = args.basePath;
  const searchTerm = args.searchTerm;
  glob("**/*" + searchTerm + "*.*", { cwd: basePath }, (err, matches) => {
    if (err) {
      console.log(err);
      return;
    }
    matches = matches.map((filepath) => filepath.split("/").join(path.sep));

    const filesAndFolders = matches.map((item) => {
      return {
        path: basePath + path.sep + path.dirname(item),
        name: path.basename(item),
        isFile: true,
        isSearch: true,
      };
    });
    event.reply(EventNames.SEARCH_RESULTS, filesAndFolders);
  });
});
