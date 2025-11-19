const { app, BrowserWindow } = require("electron");
const { bootstrapElectron } = require("./bootstrap");

bootstrapElectron({ app, BrowserWindow }).catch((error: unknown) => {
  console.error("Failed to bootstrap Electron app", error);
});
