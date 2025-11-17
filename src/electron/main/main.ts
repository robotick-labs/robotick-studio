const { app, BrowserWindow } = require("electron");
const path = require("path");

app.commandLine.appendSwitch("remote-debugging-port", "9222");

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
    },
    sandbox: false,
  });

  win.setMenuBarVisibility(false);

  // In dev mode, load the Vite/React dev server.
  if (process.env.ELECTRON_DEV === "1") {
    win.loadURL("http://localhost:5173");
  } else {
    // In production, load the built static files.
    const indexPath = path.join(__dirname, "../../renderer/index.html");
    console.log("Launching app at:", indexPath);
    win.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
