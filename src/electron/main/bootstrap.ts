import path from "path";

export type ElectronApp = {
  commandLine: {
    appendSwitch: (name: string, value: string) => void;
  };
  whenReady: () => Promise<unknown>;
  on: (
    event: string,
    handler: (event: unknown, ...args: unknown[]) => void,
  ) => void;
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

type WebContentsInstance = {
  setWindowOpenHandler?: (
    handler: (details: unknown) => {
      action: "allow" | "deny";
      overrideBrowserWindowOptions?: Record<string, unknown>;
    },
  ) => void;
};

type BootstrapOptions = {
  app: ElectronApp;
  BrowserWindow: BrowserWindowConstructor;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

const getDefaultWindowOptions = () => ({
  width: 1400,
  height: 900,
  titleBarStyle: "hidden",
  webPreferences: {
    preload: path.join(__dirname, "../preload/preload.js"),
  },
  sandbox: true,
  autoHideMenuBar: true,
});

export async function bootstrapElectron({
  app,
  BrowserWindow,
  env = process.env,
  platform = process.platform,
}: BootstrapOptions) {
  if (env.ELECTRON_DEV === "1") {
    app.commandLine.appendSwitch("remote-debugging-port", "9222");
  }

  app.on("browser-window-created", (_event, window) => {
    const browserWindow = window as BrowserWindowInstance;
    browserWindow.setMenuBarVisibility(false);
  });

  app.on("web-contents-created", (_event, contents) => {
    const webContents = contents as WebContentsInstance;
    webContents.setWindowOpenHandler?.(() => ({
      action: "allow",
      overrideBrowserWindowOptions: getDefaultWindowOptions(),
    }));
  });

  const createWindow = () => {
    const win = new BrowserWindow(getDefaultWindowOptions());

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
