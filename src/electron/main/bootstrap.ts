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
  on?: (
    event: string,
    listener: (...args: unknown[]) => void
  ) => void;
  once?: (
    event: string,
    listener: (...args: unknown[]) => void
  ) => void;
  executeJavaScript?: (code: string) => Promise<unknown>;
  openDevTools?: (options?: Record<string, unknown>) => void;
  closeDevTools?: () => void;
  isDevToolsOpened?: () => boolean;
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
  exit?: (code?: number) => void;
  setAppUserModelId?: (id: string) => void;
  setName?: (name: string) => void;
  name?: string;
  setDesktopName?: (name: string) => void;
};

type BrowserWindowInstance = {
  setMenuBarVisibility: (visible: boolean) => void;
  loadURL: (url: string) => void;
  loadFile: (filePath: string) => void;
  minimize: () => void;
  maximize: () => void;
  unmaximize: () => void;
  isMaximized: () => boolean;
  isFocused?: () => boolean;
  close: () => void;
  focus?: () => void;
  show?: () => void;
  setAlwaysOnTop?: (flag: boolean, level?: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  once?: (event: string, listener: (...args: unknown[]) => void) => void;
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

const WINDOW_STATE_WRITE_DEBOUNCE_MS = 500;
let pendingWindowState: WindowState | null = null;
let windowStateWriteTimer: NodeJS.Timeout | null = null;
let windowStateWriteInFlight = false;

const PUBLIC_ICON_RELATIVE = path.join(
  "public",
  "renderer",
  "static",
  "images",
  "icon.png",
);

function readWindowState(): WindowState {
  try {
    const contents = fs.readFileSync(WINDOW_STATE_FILE, { encoding: "utf-8" });
    return { ...DEFAULT_WINDOW_STATE, ...JSON.parse(contents) };
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

async function persistWindowState(state: WindowState) {
  try {
    await fs.promises.mkdir(path.dirname(WINDOW_STATE_FILE), {
      recursive: true,
    });
    await fs.promises.writeFile(
      WINDOW_STATE_FILE,
      JSON.stringify(state, null, 2),
      {
        encoding: "utf-8",
      },
    );
  } catch (error) {
    console.error("[Launcher] Failed to persist window state", error);
  }
}

function flushWindowStateQueue() {
  if (windowStateWriteInFlight || !pendingWindowState) {
    return;
  }
  const state = pendingWindowState;
  pendingWindowState = null;
  windowStateWriteInFlight = true;
  persistWindowState(state)
    .catch((error) => {
      console.error("[Launcher] Error writing window state", error);
    })
    .finally(() => {
      windowStateWriteInFlight = false;
      if (pendingWindowState) {
        setImmediate(flushWindowStateQueue);
      }
    });
}

function scheduleWindowStateWrite(state: WindowState) {
  pendingWindowState = state;
  if (windowStateWriteTimer) {
    clearTimeout(windowStateWriteTimer);
  }
  windowStateWriteTimer = setTimeout(() => {
    windowStateWriteTimer = null;
    flushWindowStateQueue();
  }, WINDOW_STATE_WRITE_DEBOUNCE_MS);
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

const getDefaultWindowOptions = (
  state: WindowState = DEFAULT_WINDOW_STATE,
  platform: NodeJS.Platform = process.platform,
  iconPath?: string
) => {
  const isMac = platform === "darwin";
  return {
    width: state.width,
    height: state.height,
    show: false,
    icon: iconPath,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      sandbox: false,
      contextIsolation: false,
    },
    autoHideMenuBar: true,
  };
};

function resolveWindowIconPath(env: NodeJS.ProcessEnv): string | undefined {
  const candidates = [];
  const workspace =
    env.ROBOTICK_WORKSPACE_ROOT ||
    env.ROBOTICK_PROJECT_DIR ||
    process.cwd();
  candidates.push(path.join(workspace, PUBLIC_ICON_RELATIVE));
  candidates.push(
    path.join(__dirname, "../../../", PUBLIC_ICON_RELATIVE),
  );
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore resolution failures
    }
  }
  return undefined;
}

export async function bootstrapElectron({
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  env = process.env,
  platform = process.platform,
}: BootstrapOptions) {
  const cesiumToken = env.CESIUM_TOKEN?.trim();
  if (!cesiumToken) {
    console.warn(
      "[Bootstrap] CESIUM_TOKEN is not set; Cesium viewer will be unable to authenticate."
    );
  } else {
    console.log("[Bootstrap] CESIUM_TOKEN detected.");
  }
  const desiredCwd =
    env.ROBOTICK_PROJECT_DIR || env.ROBOTICK_WORKSPACE_ROOT;
  const isSmokeTest = env.ROBOTICK_SMOKE_TEST === "1";
  if (desiredCwd && process.cwd() !== desiredCwd) {
    try {
      process.chdir(desiredCwd);
      console.log("[Bootstrap] switched cwd to", desiredCwd);
    } catch (error) {
      console.warn(
        "[Bootstrap] Failed to change cwd to",
        desiredCwd,
        error,
      );
    }
  }
  console.log(
    "[Bootstrap] cwd:",
    process.cwd(),
    "ROBOTICK_PROJECT_DIR:",
    env.ROBOTICK_PROJECT_DIR,
  );
  const windowIconPath = resolveWindowIconPath(env);
  const appIdentity = "com.robotick.studio";
  if (app.setName) {
    app.setName("Robotick Studio");
  }
  if (platform === "win32" && app.setAppUserModelId) {
    app.setAppUserModelId(appIdentity);
  } else if (platform === "linux" && app.setDesktopName) {
    app.setDesktopName(`${appIdentity}.desktop`);
  }
  process.title = "Robotick Studio";
  if (platform === "linux") {
    app.commandLine.appendSwitch("class", "RobotickStudio");
  }
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
      overrideBrowserWindowOptions: getDefaultWindowOptions(
        DEFAULT_WINDOW_STATE,
        platform,
        windowIconPath
      ),
    }));
  });

  const registerWindowStateListeners = (win: BrowserWindowInstance) => {
    const saveState = () => {
      const state: WindowState = {
        ...win.getBounds(),
        isMaximized: win.isMaximized(),
      };
      scheduleWindowStateWrite(state);
    };
    win.on("maximize", saveState);
    win.on("unmaximize", saveState);
    win.on("resize", saveState);
    win.on("move", saveState);
    win.on("close", saveState);
  };
  const registerDevtoolsShortcuts = (
    win: BrowserWindowInstance,
    platform: NodeJS.Platform
  ) => {
    const webContents = win.webContents;
    const preventDefault = (event: unknown) => {
      if (
        typeof event === "object" &&
        event !== null &&
        "preventDefault" in event &&
        typeof (event as { preventDefault?: () => void }).preventDefault ===
          "function"
      ) {
        (event as { preventDefault: () => void }).preventDefault();
      }
    };

    const shouldToggleDevtools = (rawInput: unknown): boolean => {
      if (typeof rawInput !== "object" || rawInput === null) {
        return false;
      }
      const input = rawInput as Record<string, unknown>;
      const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
      if (key !== "i") {
        return false;
      }
      if (
        platform === "darwin" &&
        input.meta === true &&
        input.alt === true
      ) {
        return true;
      }
      return (
        platform !== "darwin" &&
        input.control === true &&
        input.shift === true
      );
    };

    webContents.on?.(
      "before-input-event",
      (event: unknown, input: unknown) => {
        if (!shouldToggleDevtools(input)) {
          return;
        }
        preventDefault(event);
        if (webContents.isDevToolsOpened?.()) {
          webContents.closeDevTools?.();
          return;
        }
        webContents.openDevTools?.({ mode: "right" });
      }
    );
  };

  const resolveBrowserWindowFromEvent = (event: IpcMainInvokeEvent) => {
    if (!BrowserWindow.fromWebContents) {
      return null;
    }
    const resolved = BrowserWindow.fromWebContents(
      event.sender as WebContentsLike
    );
    return resolved ?? null;
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
        if (!target) {
          return { isMaximized: false, error: "window_not_found" as const };
        }
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

  const cleanupLauncher = (() => {
    let done = false;
    return async () => {
      if (done) return;
      done = true;
      try {
        await stopManagedLauncher();
      } catch (error) {
        console.error("[Launcher] Failed to stop cleanly", error);
      }
    };
  })();

  app.on("before-quit", () => {
    void cleanupLauncher();
  });

  app.on("will-quit", () => {
    void cleanupLauncher();
  });

  const storedState = clampToDisplay(readWindowState());

  const scheduleSmokeCheck = (win: BrowserWindowInstance) => {
    if (!isSmokeTest) {
      return;
    }
    win.webContents.once?.("did-finish-load", async () => {
      try {
        const route = await win.webContents.executeJavaScript?.(
          "window.location.pathname"
        );
        if (typeof route !== "string" || route.length === 0) {
          throw new Error(`Invalid renderer route: ${route}`);
        }
        console.log(`[Smoke] Renderer route: ${route}`);
        setTimeout(() => app.quit(), 200);
      } catch (error) {
        console.error("[Smoke] Renderer failed to load", error);
        setTimeout(() => {
          if (app.exit) {
            app.exit(1);
          } else {
            process.exit(1);
          }
        }, 200);
      }
    });
  };
  const createWindow = () => {
    const win = new BrowserWindow(
      getDefaultWindowOptions(storedState, platform, windowIconPath)
    );
    let alwaysOnTopTimer: NodeJS.Timeout | null = null;
    const clearAlwaysOnTopTimer = () => {
      if (alwaysOnTopTimer) {
        clearTimeout(alwaysOnTopTimer);
        alwaysOnTopTimer = null;
      }
    };

    if (storedState.isMaximized) {
      win.maximize();
    }

    win.setMenuBarVisibility(false);
    win.on("closed", () => {
      clearAlwaysOnTopTimer();
    });
    registerWindowStateListeners(win);
    registerDevtoolsShortcuts(win, platform);
    win.on("ready-to-show", () => {
      win.show?.();
      if (!win.isFocused?.()) {
        win.focus?.();
      }
      if (win.setAlwaysOnTop) {
        clearAlwaysOnTopTimer();
        win.setAlwaysOnTop(true, "screen-saver");
        alwaysOnTopTimer = setTimeout(() => {
          win.setAlwaysOnTop?.(false);
          alwaysOnTopTimer = null;
        }, 250);
      }
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
    scheduleSmokeCheck(win);
  };

  app.on("window-all-closed", () => {
    if (platform !== "darwin") {
      void cleanupLauncher();
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

  const shutdown = (code = 0) => {
    cleanupLauncher()
      .catch(() => {
        // ignore cleanup errors during shutdown
      })
      .finally(() => {
        if (app.exit) {
          app.exit(code);
        } else {
          process.exit(code);
        }
      });
  };

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGHUP", () => shutdown(0));
  process.on("uncaughtException", () => shutdown(1));
  process.on("unhandledRejection", () => shutdown(1));
}
