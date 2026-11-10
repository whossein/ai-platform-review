const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const { fork } = require("child_process");
const http = require("http");

let mainWindow;
let serverProcess;

const DEFAULT_PORT = process.env.PORT || "4000";
// ponytail: macOS builds are unsigned and Squirrel.Mac rejects them; drop the platform check once signing is added.
const canAutoUpdate = app.isPackaged && process.platform !== "darwin";

// The preload also runs in any page this window navigates to, so only our own UI may drive the updater.
function assertAppPage(event) {
  if (!event.senderFrame?.url.startsWith(`http://localhost:${DEFAULT_PORT}/`)) {
    throw new Error("Forbidden");
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: canAutoUpdate ? path.join(__dirname, "preload.cjs") : undefined,
    },
  });

  if (app.isPackaged) {
    // In production, spawn the bundled server using Electron's Node environment
    serverProcess = fork(path.join(__dirname, "dist", "server.cjs"), [], {
      // ./.data lives in the per-user app data dir; the install dir may be read-only.
      cwd: app.getPath("userData"),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT: DEFAULT_PORT,
        WEB_DIST: path.join(__dirname, "apps", "web", "dist"),
      },
    });

    // Wait for the local server to be ready before loading the URL
    const checkServer = setInterval(() => {
      http
        .get(`http://localhost:${DEFAULT_PORT}`, (res) => {
          if (
            res.statusCode === 200 ||
            res.statusCode === 304 ||
            res.statusCode === 404
          ) {
            clearInterval(checkServer);
            mainWindow.loadURL(`http://localhost:${DEFAULT_PORT}`);
          }
        })
        .on("error", () => {
          /* ignore connection refused until ready */
        });
    }, 500);
  } else {
    // In development mode, wait-on ensures the server is running before electron starts
    mainWindow.loadURL(`http://localhost:${DEFAULT_PORT}`);
  }
}

app.whenReady().then(() => {
  createWindow();
  if (canAutoUpdate) {
    // Resolves with the downloaded version, or null when already up to date.
    ipcMain.handle("update:check", async (event) => {
      assertAppPage(event);
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) return null;
      await result.downloadPromise;
      return result.updateInfo.version;
    });
    ipcMain.handle("update:install", (event) => {
      assertAppPage(event);
      autoUpdater.quitAndInstall(true, true); // silent, relaunch afterwards
    });
    // Rejects while a release has no installers attached yet; the next launch retries.
    autoUpdater.checkForUpdatesAndNotify().catch(console.error);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
