import fs from "fs";
import path from "path";
import { screen } from "electron";
import { ensureLauncherReady, stopManagedLauncher } from "./launcher-manager";
import { registerRendererStorage } from "./renderer-storage";
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

type PreventableEvent = {
  preventDefault?: () => void;
};

type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
};

type WindowControlsState = {
  hasWindowControls: boolean;
  usesNativeFrame: boolean | null;
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

/**
 * Adjusts a stored window state so its position and size fit within the current display work area.
 *
 * @param state - Window state containing `width`, `height`, and optional `x`/`y` position to be clamped
 * @returns A window state object with `x`, `y`, `width`, and `height` adjusted to fit inside the matched display's work area
 */
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

type WindowOptionsConfig = {
  useNativeFrame?: boolean;
};

const getDefaultWindowOptions = (
  state: WindowState = DEFAULT_WINDOW_STATE,
  platform: NodeJS.Platform = process.platform,
  iconPath?: string,
  config: WindowOptionsConfig = {}
) => {
  const isMac = platform === "darwin";
  const useNativeFrame = config.useNativeFrame === true;
  const frameless = !useNativeFrame;

  const base: Record<string, unknown> = {
    width: state.width,
    height: state.height,
    show: false,
    icon: iconPath,
    frame: useNativeFrame ? true : false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      sandbox: true,
      contextIsolation: true,
    },
  };

  if (frameless) {
    Object.assign(base, {
      titleBarStyle: isMac ? "hiddenInset" : "hidden",
      trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    });
  }

  return {
    ...base,
  };
};

const WINDOW_CONTROLS_SCRIPT = `
(() => {
  const robotick = window.robotick || {};
  const env = robotick.environment || {};
  return {
    hasWindowControls: Boolean(robotick.windowControls),
    usesNativeFrame:
      typeof env.usesNativeWindowFrame === "boolean"
        ? env.usesNativeWindowFrame
        : null,
  };
})()
`;

/**
 * Detects whether the renderer has custom window controls and whether it uses the native window frame.
 *
 * @param win - The browser window whose renderer will be probed for window control state
 * @returns `WindowControlsState` containing `hasWindowControls` and `usesNativeFrame` when detection succeeds, or `null` if probing is unavailable or failed
 */
async function probeWindowControls(
  win: BrowserWindowInstance
): Promise<WindowControlsState | null> {
  const exec = win.webContents.executeJavaScript;
  if (typeof exec !== "function") {
    return null;
  }
  try {
    const result = await exec(WINDOW_CONTROLS_SCRIPT);
    if (
      typeof result === "object" &&
      result !== null &&
      "hasWindowControls" in result
    ) {
      const typed = result as {
        hasWindowControls: unknown;
        usesNativeFrame?: unknown;
      };
      return {
        hasWindowControls: Boolean(typed.hasWindowControls),
        usesNativeFrame:
          typeof typed.usesNativeFrame === "boolean"
            ? typed.usesNativeFrame
            : null,
      };
    }
  } catch (error) {
    console.warn("[Bootstrap] Failed to inspect window controls", error);
  }
  return null;
}

/**
 * Log the renderer's window control configuration to the console.
 *
 * @param state - Detected window control state, or `null` if detection failed
 */
function logWindowControlsState(state: WindowControlsState | null) {
  if (!state) {
    console.warn(
      "[Bootstrap] Unable to determine renderer window control availability."
    );
    return;
  }
  const { hasWindowControls, usesNativeFrame } = state;
  if (usesNativeFrame) {
    console.log("[Bootstrap] Native OS window controls enabled.");
    return;
  }
  if (hasWindowControls) {
    console.log("[Bootstrap] Custom window controls registered.");
  } else {
    console.warn(
      "[Bootstrap] Custom window controls missing; header buttons will not render."
    );
  }
}

/**
 * Attach a one-time probe that logs whether the renderer uses native OS window controls or custom header controls after the window's page finishes loading.
 *
 * @param win - The browser window to monitor
 */
function attachWindowControlsLogger(win: BrowserWindowInstance) {
  win.webContents.once?.("did-finish-load", () => {
    void probeWindowControls(win).then((state) => {
      logWindowControlsState(state);
    });
  });
}

/**
 * Locates a candidate application icon file by checking project and module locations.
 *
 * @param env - Environment variables used to resolve project/workspace roots (`ROBOTICK_WORKSPACE_ROOT`, `ROBOTICK_PROJECT_DIR`); `process.cwd()` is used if neither is present
 * @returns The filesystem path to the first existing icon file found, or `undefined` if none are present
 */
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

/**
 * Initializes and configures the Electron application runtime, creates the main window, and wires IPC, window state persistence, and graceful shutdown handlers.
 *
 * Sets up app identity, command-line switches, devtools hooks, window creation and defaults, window state persistence, IPC handlers for window commands, runtime probing of window controls, smoke-test checks, and process signal/error handlers.
 *
 * @param app - The minimal Electron app surface used to control application lifecycle and settings.
 * @param BrowserWindow - Constructor/utility for creating and querying browser windows.
 * @param ipcMain - Optional IPC handler used to register renderer storage and handle window commands.
 * @param Menu - Optional Electron Menu API used to build and show system menus.
 * @param env - Optional environment variables object to influence behavior (e.g., DEV flags, project paths, frame mode).
 * @param platform - Optional platform identifier (e.g., "darwin", "win32", "linux") to apply platform-specific behaviors.
 */
export async function bootstrapElectron({
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  env = process.env,
  platform = process.platform,
}: BootstrapOptions) {
  const projectRootEnv =
    env.ROBOTICK_PROJECT_DIR || env.ROBOTICK_WORKSPACE_ROOT;
  const resolvedProjectRoot = projectRootEnv
    ? path.resolve(projectRootEnv)
    : undefined;
  const storageDir = resolvedProjectRoot
    ? path.join(resolvedProjectRoot, ".studio")
    : undefined;
  const storageFile =
    storageDir && env.ROBOTICK_DISABLE_PROJECT_STORAGE !== "1"
      ? path.join(storageDir, "renderer-storage.json")
      : undefined;
  if (ipcMain) {
    registerRendererStorage(ipcMain, storageFile);
  }

  const useNativeFrame = env.ROBOTICK_USE_NATIVE_FRAME === "1";
  console.log(
    `[Bootstrap] Window frame mode: ${useNativeFrame ? "native" : "custom"}`
  );
  const cesiumToken = env.CESIUM_TOKEN?.trim();
  if (cesiumToken) {
    console.log("[Bootstrap] CESIUM_TOKEN detected.");
  }
  const desiredCwd =
    env.ROBOTICK_PROJECT_DIR || env.ROBOTICK_WORKSPACE_ROOT;
  const isSmokeTest = env.ROBOTICK_SMOKE_TEST === "1";
  const skipSmokeWindowControlsCheck =
    env.ROBOTICK_SMOKE_SKIP_WINDOW_CONTROLS === "1";
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
        windowIconPath,
        { useNativeFrame }
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

  let gracefulQuitInFlight = false;
  const runGracefulQuit = async () => {
    if (gracefulQuitInFlight) {
      return;
    }
    gracefulQuitInFlight = true;
    await cleanupLauncher();
    app.quit();
  };

  app.on("before-quit", (event: unknown) => {
    if (gracefulQuitInFlight) {
      return;
    }
    (event as PreventableEvent | undefined)?.preventDefault?.();
    void runGracefulQuit();
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
        const controls = await probeWindowControls(win);
        if (!controls) {
          if (!skipSmokeWindowControlsCheck) {
            throw new Error("[Smoke] Unable to determine window controls state");
          }
          console.warn(
            "[Smoke] Skipping window controls verification; probe unavailable."
          );
        } else {
          console.log(
            `[Smoke] Window controls -> native:${controls.usesNativeFrame} custom:${controls.hasWindowControls}`
          );
          if (
            !skipSmokeWindowControlsCheck &&
            controls.usesNativeFrame === false &&
            !controls.hasWindowControls
          ) {
            throw new Error("[Smoke] Custom window controls not detected");
          }
        }
        setTimeout(() => app.quit(), 200);
      } catch (error) {
        console.error("[Smoke] Renderer failed to load", error);
        setTimeout(() => shutdown(1), 200);
      }
    });
  };
  const createWindow = () => {
    const win = new BrowserWindow(
      getDefaultWindowOptions(storedState, platform, windowIconPath, {
        useNativeFrame,
      })
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
    attachWindowControlsLogger(win);
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
      void runGracefulQuit();
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
