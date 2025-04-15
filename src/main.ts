import { app, BrowserWindow, protocol, autoUpdater } from "electron";
import installExtension, { VUEJS_DEVTOOLS } from "electron-devtools-installer";
import path from "path";
import startup from "electron-squirrel-startup";
// eslint-disable-next-line import/no-unresolved
import { createIPCHandler } from "electron-trpc/main";
import { trcpRouter } from "./trcpRouter";
const isDevelopment = !app.isPackaged;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (startup) {
  app.quit();
} else {
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
    }, 60_000);

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
        sandbox: false,
        preload: path.join(__dirname, "preload.js"),
      },
    });

    createIPCHandler({ router: trcpRouter, windows: [mainWindow]});
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
      const decodedUrl = decodeURIComponent(
        Buffer.from(url, "base64").toString()
      );
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
}
