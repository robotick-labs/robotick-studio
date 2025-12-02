import fs from "fs";
import path from "path";
import { screen } from "electron";
import { ensureLauncherReady, stopManagedLauncher } from "./launcher-manager";
import type {
  BrowserWindow as ElectronBrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
  Menu as ElectronMenu,
  Rectangle,
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
  getBounds: () => Rectangle;
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

type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
};

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1400,
  height: 900,
};

const WINDOW_STATE_FILE =
  process.env.ROBOTICK_WINDOW_STATE_FILE ||
  path.join(
    process.env.ROBOTICK_WORKSPACE_ROOT ?? process.cwd(),
    ".studio",
    "window-state.json",
  );

function readWindowState(): WindowState {
  try {
    const contents = fs.readFileSync(WINDOW_STATE_FILE, { encoding: "utf-8" });
    return { ...DEFAULT_WINDOW_STATE, ...JSON.parse(contents) };
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

function writeWindowState(state: WindowState) {
  try {
    fs.mkdirSync(path.dirname(WINDOW_STATE_FILE), { recursive: true });
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2), {
      encoding: "utf-8",
    });
  } catch (error) {
    console.error("[Launcher] Failed to persist window state", error);
  }
}

function clampToDisplay(state: WindowState) {
  const bounds = { ...state };
  const rect: Rectangle = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x ?? 0,
    y: bounds.y ?? 0,
  };
  const display = screen?.getDisplayMatching?.(rect) ?? screen?.getPrimaryDisplay?.();
  if (!display) {
    return bounds;
  }
  const workArea = display.workArea;
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const x = Math.min(
    Math.max(bounds.x ?? workArea.x, workArea.x),
    workArea.x + workArea.width - width
  );
  const y = Math.min(
    Math.max(bounds.y ?? workArea.y, workArea.y),
    workArea.y + workArea.height - height
  );
  return { ...bounds, x, y, width, height };
}

const getDefaultWindowOptions = (state: WindowState = DEFAULT_WINDOW_STATE) => ({
  width: state.width,
  height: state.height,
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
    const saveState = () => {
      const state: WindowState = {
        ...win.getBounds(),
        isMaximized: win.isMaximized(),
      };
      writeWindowState(state);
    };
    win.on("maximize", saveState);
    win.on("unmaximize", saveState);
    win.on("focus", saveState);
    win.on("resize", saveState);
    win.on("move", saveState);
    win.on("close", saveState);
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

  const storedState = clampToDisplay(readWindowState());
  const createWindow = () => {
    const win = new BrowserWindow(getDefaultWindowOptions(storedState));

    if (storedState.isMaximized) {
      win.maximize();
    }

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
