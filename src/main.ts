import {
  app,
  BrowserWindow,
  protocol,
  ipcMain,
  dialog,
  type IpcMainEvent,
  autoUpdater,
} from "electron";
import installExtension, { VUEJS_DEVTOOLS } from "electron-devtools-installer";
import { EventNames } from "./Enums";
import path from "path";
import * as fs from "fs-extra";
import { glob } from "glob";
import startup from "electron-squirrel-startup";
const isDevelopment = !app.isPackaged;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (startup) {
  app.quit();
}

if (!isDevelopment) {
  const server = "https://update.sebmahr.de";
  let platform = process.platform as string;
  if (platform === "win32") {
    if (process.arch === "x64") {
      platform = "win64";
    }
  }
  const url = `${server}/update/${platform}/${app.getVersion()}`;
  autoUpdater.setFeedURL({ url });
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 60000);

  autoUpdater.checkForUpdates();
  autoUpdater.on("update-downloaded", (event, releaseNotes, releaseName) => {
    const dialogOpts = {
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
}

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { secure: true, standard: true } },
]);

let mainWindow: BrowserWindow | null;
const createWindow = (): void => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: "sheet-music-viewer",
    height: 600,
    width: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.maximize();

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  if (isDevelopment) {
    mainWindow.webContents.openDevTools();
  }
};

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
      if (e instanceof Error) {
        console.error("Vue Devtools failed to install:", e.toString());
      }
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

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

ipcMain.on(EventNames.GET_VERSION, (event: IpcMainEvent) => {
  event.reply(
    EventNames.SEND_VERSION,
    isDevelopment ? "development" : app.getVersion()
  );
});

ipcMain.on(EventNames.SELECT_FOLDER, (event: IpcMainEvent) => {
  dialog
    .showOpenDialog({
      properties: ["openDirectory"],
    })
    .then(function (result) {
      event.reply(EventNames.FOLDER_SELECTED, result.filePaths[0]);
    });
});

ipcMain.on(
  EventNames.FOLDER_SELECTED,
  async (
    event: IpcMainEvent,
    args: { basePath: string; relativePath: string }
  ) => {
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

    event.reply(EventNames.FOLDER_LOADED, filesAndFolders);
  }
);
ipcMain.on(
  EventNames.SEARCH_FILES,
  async (
    event: IpcMainEvent,
    args: { basePath: string; searchTerm: string }
  ) => {
    const basePath = args.basePath;
    const searchTerm = args.searchTerm;
    const matches = await glob("**/*" + searchTerm + "*.*", {
      cwd: basePath,
      nocase: true,
    });
    // matches = matches.map((filepath) => filepath.split("/").join(path.sep));

    const filesAndFolders = matches.map((item) => {
      const filePath = item.includes("/") ? "/" + path.dirname(item) : "";

      return {
        path: basePath + filePath,
        name: path.basename(item),
        isFile: true,
        isSearch: true,
      };
    });
    event.reply(EventNames.SEARCH_RESULTS, filesAndFolders);
  }
);
ipcMain.on(
  EventNames.START_LOAD_OVERLAY_DATA,
  async (event: IpcMainEvent, args: { path: string }) => {
    const sheetPath = args.path;

    const overlayDataPath = getOverlayDataFilePathFromSheetPath(sheetPath);

    let overlayData;

    try {
      overlayData = (await fs.readFile(overlayDataPath)).toString();
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code !== "ENOENT") {
        console.log("Error while loading data file");
        console.log(e);
      }
      overlayData = "";
    }

    event.reply(EventNames.LOAD_OVERLAY_DATA, overlayData);
  }
);

ipcMain.on(
  EventNames.SAVE_OVERLAY_DATA,
  async (event: IpcMainEvent, args: { path: string; data: string }) => {
    const sheetPath = args.path;
    const overlayData = args.data;
    const overlayDataPath = getOverlayDataFilePathFromSheetPath(sheetPath);
    try {
      await fs.writeFile(overlayDataPath, overlayData);
    } catch (e) {
      console.log("Error while saving:");
      console.log(e);
    }
  }
);

ipcMain.on(
  EventNames.LOAD_SET_LISTS,
  async (event: IpcMainEvent, args: { basePath: string }) => {
    const basePath = args.basePath;
    let setListsJson: string;
    try {
      const setListJsonPath = path.join(basePath, ".set-lists.json");
      setListsJson = (await fs.readFile(setListJsonPath)).toString();
    } catch (e) {
      console.log(e);
      setListsJson = "[]";
    }
    event.reply(EventNames.LOAD_SET_LISTS_RESULT, JSON.parse(setListsJson));
  }
);
ipcMain.on(
  EventNames.SAVE_SET_LISTS,
  async (event: IpcMainEvent, args: { setLists: string; basePath: string }) => {
    const setLists = args.setLists;
    const basePath = args.basePath;
    await fs.writeFile(
      path.join(basePath, ".set-lists.json"),
      JSON.stringify(setLists)
    );
  }
);

function getOverlayDataFilePathFromSheetPath(sheetPath: string): string {
  let overlayDataPath = path.basename(sheetPath);
  overlayDataPath =
    "." + overlayDataPath.replace(path.extname(overlayDataPath), ".data");
  overlayDataPath = sheetPath.replace(
    path.basename(sheetPath),
    overlayDataPath
  );

  return overlayDataPath;
}
