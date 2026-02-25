const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const { bootstrapElectron } = require("./bootstrap");

bootstrapElectron({ app, BrowserWindow, ipcMain, Menu }).catch((error: unknown) => {
  console.error("Failed to bootstrap Electron app", error);
});
