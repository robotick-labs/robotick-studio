import path from "path";

export type ElectronApp = {
  commandLine: {
    appendSwitch: (name: string, value: string) => void;
  };
  whenReady: () => Promise<unknown>;
  on: (event: string, handler: () => void) => void;
  quit: () => void;
};

type BrowserWindowInstance = {
  setMenuBarVisibility: (visible: boolean) => void;
  loadURL: (url: string) => void;
  loadFile: (filePath: string) => void;
};

export type BrowserWindowConstructor = {
  new (options: Record<string, unknown>): BrowserWindowInstance;
  getAllWindows: () => BrowserWindowInstance[];
};

type BootstrapOptions = {
  app: ElectronApp;
  BrowserWindow: BrowserWindowConstructor;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

export async function bootstrapElectron({
  app,
  BrowserWindow,
  env = process.env,
  platform = process.platform,
}: BootstrapOptions) {
  if (env.ELECTRON_DEV === "1") {
    app.commandLine.appendSwitch("remote-debugging-port", "9222");
  }

  const createWindow = () => {
    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      titleBarStyle: "hidden",
      webPreferences: {
        preload: path.join(__dirname, "../preload/preload.js"),
      },
      sandbox: true,
    });

    win.setMenuBarVisibility(false);

    if (env.ELECTRON_DEV === "1") {
      win.loadURL("http://localhost:5173");
    } else {
      const indexPath = path.join(__dirname, "../../renderer/index.html");
      console.log("Launching app at:", indexPath);
      win.loadFile(indexPath);
    }
  };

  app.on("window-all-closed", () => {
    if (platform !== "darwin") {
      app.quit();
    }
  });

  await app.whenReady();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
