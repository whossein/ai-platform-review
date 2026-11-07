const { app, BrowserWindow } = require("electron");
const path = require("path");
const { fork } = require("child_process");
const http = require("http");

let mainWindow;
let serverProcess;

const DEFAULT_PORT = process.env.PORT || "4000";

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
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

app.whenReady().then(createWindow);

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
