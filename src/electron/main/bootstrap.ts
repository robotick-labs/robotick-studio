import path from "path";
import { ensureLauncherReady, stopManagedLauncher } from "./launcher-manager";
import type {
  IpcMain,
  IpcMainInvokeEvent,
  Menu as ElectronMenu,
  BrowserWindow as ElectronBrowserWindow,
} from "electron";

type WebContentsLike = {
  send: (channel: string, ...args: unknown[]) => void;
  setWindowOpenHandler?: (
    handler: (details: unknown) => {
      action: "allow" | "deny";
      overrideBrowserWindowOptions?: Record<string, unknown>;
    }
  ) => void;
};

export type ElectronApp = {
  commandLine: {
    appendSwitch: (name: string, value: string) => void;
  };
  whenReady: () => Promise<unknown>;
  on: (
    event: string,
    handler: (event: unknown, ...args: unknown[]) => void
  ) => void;
  quit: () => void;
};

type BrowserWindowInstance = {
  setMenuBarVisibility: (visible: boolean) => void;
  loadURL: (url: string) => void;
  loadFile: (filePath: string) => void;
  minimize: () => void;
  maximize: () => void;
  unmaximize: () => void;
  isMaximized: () => boolean;
  close: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  webContents: WebContentsLike;
};

export type BrowserWindowConstructor = {
  new (options: Record<string, unknown>): BrowserWindowInstance;
  getAllWindows: () => BrowserWindowInstance[];
  fromWebContents?: (contents: WebContentsLike) => BrowserWindowInstance | null;
};

type BootstrapOptions = {
  app: ElectronApp;
  BrowserWindow: BrowserWindowConstructor;
  ipcMain?: IpcMain;
  Menu?: typeof ElectronMenu;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

const getDefaultWindowOptions = () => ({
  width: 1400,
  height: 900,
  titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
  trafficLightPosition:
    process.platform === "darwin" ? { x: 16, y: 16 } : undefined,
  titleBarOverlay: {
    color: "#11141b",
    symbolColor: "#ffffff",
    height: 48,
  },
  frame: false,
  webPreferences: {
    preload: path.join(__dirname, "../preload/preload.js"),
  },
  sandbox: true,
  autoHideMenuBar: true,
});

export async function bootstrapElectron({
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  env = process.env,
  platform = process.platform,
}: BootstrapOptions) {
  await ensureLauncherReady();

  if (env.ELECTRON_DEV === "1") {
    app.commandLine.appendSwitch("remote-debugging-port", "9222");
  }

  app.on("browser-window-created", (_event, window) => {
    const browserWindow = window as BrowserWindowInstance;
    browserWindow.setMenuBarVisibility(false);
  });

  app.on("web-contents-created", (_event, contents) => {
    const webContents = contents as WebContentsLike;
    webContents.setWindowOpenHandler?.(() => ({
      action: "allow",
      overrideBrowserWindowOptions: getDefaultWindowOptions(),
    }));
  });

  const registerWindowStateListeners = (win: BrowserWindowInstance) => {
    const notify = () => {
      win.webContents.send("robotick-window-state", {
        isMaximized: win.isMaximized(),
      });
    };
    win.on("maximize", notify);
    win.on("unmaximize", notify);
    win.on("focus", notify);
  };

  const resolveBrowserWindowFromEvent = (event: IpcMainInvokeEvent) => {
    if (BrowserWindow.fromWebContents) {
      const resolved = BrowserWindow.fromWebContents(
        event.sender as WebContentsLike
      );
      if (resolved) {
        return resolved;
      }
    }
    const [focused] = BrowserWindow.getAllWindows();
    return focused ?? null;
  };

  const showSystemMenu = (
    target: BrowserWindowInstance,
    coords?: { x?: number; y?: number }
  ) => {
    if (!Menu) return;
    const template = [
      {
        label: target.isMaximized() ? "Restore" : "Maximize",
        click: () => {
          if (target.isMaximized()) {
            target.unmaximize();
          } else {
            target.maximize();
          }
        },
      },
      {
        label: "Minimize",
        click: () => target.minimize(),
      },
      {
        label: "Close",
        click: () => target.close(),
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      window: target as unknown as ElectronBrowserWindow,
      x: coords?.x,
      y: coords?.y,
    });
  };

  const windowController = (
    command: string,
    target: BrowserWindowInstance,
    payload?: { x?: number; y?: number }
  ) => {
    switch (command) {
      case "minimize":
        target.minimize();
        break;
      case "maximize":
        target.maximize();
        break;
      case "restore":
        target.unmaximize();
        break;
      case "toggleMaximize":
        if (target.isMaximized()) {
          target.unmaximize();
        } else {
          target.maximize();
        }
        break;
      case "close":
        target.close();
        break;
      case "systemMenu":
        showSystemMenu(target, payload);
        break;
      default:
        break;
    }
    return {
      isMaximized: target.isMaximized(),
    };
  };

  if (ipcMain) {
    ipcMain.handle(
      "robotick-window-command",
      (
        event: IpcMainInvokeEvent,
        payload: { command: string; x?: number; y?: number } | undefined
      ) => {
        const target = resolveBrowserWindowFromEvent(event);
        if (!target) return { isMaximized: false };
        if (payload?.command === "state") {
          return { isMaximized: target.isMaximized() };
        }
        if (!payload?.command) {
          return { isMaximized: target.isMaximized() };
        }
        return windowController(payload.command, target, payload);
      }
    );
  }

  app.on("before-quit", () => {
    stopManagedLauncher().catch((error) => {
      console.error("[Launcher] Failed to stop cleanly", error);
    });
  });

  const createWindow = () => {
    const win = new BrowserWindow(getDefaultWindowOptions());

    win.setMenuBarVisibility(false);
    registerWindowStateListeners(win);
    win.on("ready-to-show", () => {
      win.webContents.send("robotick-window-state", {
        isMaximized: win.isMaximized(),
      });
    });

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
