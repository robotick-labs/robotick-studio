import fs from "fs";
import os from "os";
import path from "path";
import { screen } from "electron";
import { registerRendererStorage } from "./renderer-storage";
import {
  ensureChildWindowInDocument,
  listChildWindowIdsInDocument,
  registerStudioPersistence,
} from "./studio-persistence";
import {
  acquireProjectLock,
  type ProjectLockOwner,
  type ProjectSelectionIssue,
  readProjectLockStatus,
  releaseProjectLock,
  resolveProjectLockDirectory,
  resolveProjectPath,
} from "./project-locks";
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
  getURL?: () => string;
};

export type ElectronApp = {
  commandLine: {
    appendSwitch: (name: string, value: string) => void;
  };
  getAppMetrics?: () => ElectronAppMetric[];
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
  isMinimized?: () => boolean;
  isDestroyed?: () => boolean;
  isFocused?: () => boolean;
  close: () => void;
  destroy?: () => void;
  restore?: () => void;
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

type WindowStateStore = {
  version: 2;
  windows: Record<string, WindowState>;
};

type WindowMetadata = {
  scope: string;
  isPrimary: boolean;
};

type WindowControlsState = {
  hasWindowControls: boolean;
  usesNativeFrame: boolean | null;
};

type RendererErrorPayload = {
  type?: unknown;
  message?: unknown;
  stack?: unknown;
  source?: unknown;
  lineno?: unknown;
  colno?: unknown;
  reason?: unknown;
  href?: unknown;
};

type StudioProcessStats = {
  cpuPercent: number;
  memoryMb: number;
};

type ProjectSelectionState = {
  currentProjectPath: string;
  bootstrapIssue: ProjectSelectionIssue | null;
};

type ProjectSelectionResult = {
  accepted: boolean;
  currentProjectPath: string;
  issue: ProjectSelectionIssue | null;
};

type ElectronAppMetric = {
  pid?: number;
  type?: string;
  cpu?: {
    percentCPU?: number;
  };
  memory?: {
    workingSetSize?: number;
  };
};

type StudioCpuSample = {
  usage: NodeJS.CpuUsage;
  timeNs: bigint;
};

type LinuxProcessCpuSample = {
  totalSystemTicks: number;
  perPidTicks: Map<number, number>;
  sampledAtNs: bigint;
  lastPercent: number;
};

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1400,
  height: 900,
};

const PRIMARY_WINDOW_SCOPE = "primary";
const CHILD_WINDOW_SCOPE_PREFIX = "child-window-";
const WINDOW_SCOPE_ARG_PREFIX = "--robotick-window-scope=";
const WINDOW_PRIMARY_ARG_PREFIX = "--robotick-window-primary=";

const WINDOW_STATE_FILE =
  process.env.ROBOTICK_WINDOW_STATE_FILE ||
  path.join(
    process.env.ROBOTICK_WORKSPACE_ROOT ?? process.cwd(),
    ".studio",
    "window-state.json",
  );

const WINDOW_STATE_WRITE_DEBOUNCE_MS = 500;
let pendingWindowStateStore: WindowStateStore | null = null;
let windowStateWriteTimer: NodeJS.Timeout | null = null;
let windowStateWriteInFlight = false;
let lastStudioCpuSample: StudioCpuSample | null = null;
let lastLinuxProcessCpuSample: LinuxProcessCpuSample | null = null;
const DEV_SERVER_PORT_CANDIDATES = [
  5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182, 5183,
];
const DEV_SERVER_PROBE_TIMEOUT_MS = 800;

const PUBLIC_ICON_RELATIVE = path.join(
  "public",
  "renderer",
  "static",
  "images",
  "icon.png",
);

function isWindowState(value: unknown): value is WindowState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Record<string, unknown>;
  return (
    typeof data.width === "number" &&
    Number.isFinite(data.width) &&
    typeof data.height === "number" &&
    Number.isFinite(data.height)
  );
}

function readWindowStateStore(): WindowStateStore {
  try {
    const contents = fs.readFileSync(WINDOW_STATE_FILE, { encoding: "utf-8" });
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === 2 &&
      parsed.windows &&
      typeof parsed.windows === "object"
    ) {
      const windows = Object.fromEntries(
        Object.entries(parsed.windows as Record<string, unknown>)
          .filter(([, value]) => isWindowState(value))
          .map(([scope, value]) => [
            scope,
            { ...DEFAULT_WINDOW_STATE, ...(value as WindowState) },
          ])
      );
      return {
        version: 2,
        windows:
          Object.keys(windows).length > 0
            ? windows
            : { [PRIMARY_WINDOW_SCOPE]: DEFAULT_WINDOW_STATE },
      };
    }
    if (isWindowState(parsed)) {
      return {
        version: 2,
        windows: {
          [PRIMARY_WINDOW_SCOPE]: { ...DEFAULT_WINDOW_STATE, ...parsed },
        },
      };
    }
  } catch {
    // fall through to default
  }
  return {
    version: 2,
    windows: {
      [PRIMARY_WINDOW_SCOPE]: DEFAULT_WINDOW_STATE,
    },
  };
}

async function canReachDevServer(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEV_SERVER_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/@vite/client`, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveDevServerUrl(): Promise<string> {
  const envUrl = process.env.ROBOTICK_STUDIO_DEV_URL?.trim();
  if (envUrl && (await canReachDevServer(envUrl))) {
    return envUrl;
  }
  for (const port of DEV_SERVER_PORT_CANDIDATES) {
    const candidate = `http://localhost:${port}`;
    if (await canReachDevServer(candidate)) {
      return candidate;
    }
  }
  return "http://localhost:5173";
}

async function notifyHubAppClosing(
  env: NodeJS.ProcessEnv,
  appId: string,
): Promise<void> {
  const hubEndpoint = env.ROBOTICK_HUB_ENDPOINT?.trim();
  if (!hubEndpoint) {
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 400);
  try {
    await fetch(`${hubEndpoint}/v1/apps/${appId}/instances/closing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pid: process.pid,
        instance_name: env.ROBOTICK_STUDIO_INSTANCE_NAME?.trim() || null,
      }),
      signal: controller.signal,
    });
  } catch {
    // best-effort signal only
  } finally {
    clearTimeout(timeout);
  }
}

async function persistWindowStateStore(state: WindowStateStore) {
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
  if (windowStateWriteInFlight || !pendingWindowStateStore) {
    return;
  }
  const state = pendingWindowStateStore;
  pendingWindowStateStore = null;
  windowStateWriteInFlight = true;
  persistWindowStateStore(state)
    .catch((error) => {
      console.error("[Launcher] Error writing window state", error);
    })
    .finally(() => {
      windowStateWriteInFlight = false;
      if (pendingWindowStateStore) {
        setImmediate(flushWindowStateQueue);
      }
    });
}

function scheduleWindowStateWrite(state: WindowStateStore) {
  pendingWindowStateStore = state;
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

function parseWindowScopeFromArgs(args: string[] | undefined): string | null {
  if (!Array.isArray(args)) {
    return null;
  }
  const scopeArg = args.find((arg) => arg.startsWith(WINDOW_SCOPE_ARG_PREFIX));
  if (!scopeArg) {
    return null;
  }
  const scope = scopeArg.slice(WINDOW_SCOPE_ARG_PREFIX.length).trim();
  return scope.length > 0 ? scope : null;
}

function parseIsPrimaryFromArgs(args: string[] | undefined): boolean {
  if (!Array.isArray(args)) {
    return true;
  }
  const primaryArg = args.find((arg) =>
    arg.startsWith(WINDOW_PRIMARY_ARG_PREFIX)
  );
  if (!primaryArg) {
    return true;
  }
  return primaryArg.slice(WINDOW_PRIMARY_ARG_PREFIX.length) === "1";
}

type WindowOptionsConfig = {
  useNativeFrame?: boolean;
  windowScope?: string;
  isPrimaryWindow?: boolean;
};

const getDefaultWindowOptions = (
  state: WindowState = DEFAULT_WINDOW_STATE,
  platform: NodeJS.Platform = process.platform,
  iconPath?: string,
  config: WindowOptionsConfig = {}
) => {
  const isMac = platform === "darwin";
  const useNativeFrame = config.useNativeFrame === true;
  const windowScope = config.windowScope ?? PRIMARY_WINDOW_SCOPE;
  const isPrimaryWindow = config.isPrimaryWindow !== false;
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
      additionalArguments: [
        `${WINDOW_SCOPE_ARG_PREFIX}${windowScope}`,
        `${WINDOW_PRIMARY_ARG_PREFIX}${isPrimaryWindow ? "1" : "0"}`,
      ],
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

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function sampleMainProcessCpuPercent(): number {
  const currentSample: StudioCpuSample = {
    usage: process.cpuUsage(),
    timeNs: process.hrtime.bigint(),
  };
  let cpuPercent = 0;
  if (lastStudioCpuSample) {
    const cpuDeltaMicros =
      currentSample.usage.user -
      lastStudioCpuSample.usage.user +
      (currentSample.usage.system - lastStudioCpuSample.usage.system);
    const timeDeltaMicros =
      Number(currentSample.timeNs - lastStudioCpuSample.timeNs) / 1000;
    if (timeDeltaMicros > 0 && Number.isFinite(timeDeltaMicros)) {
      cpuPercent = Math.max(0, (cpuDeltaMicros / timeDeltaMicros) * 100);
    }
  }
  lastStudioCpuSample = currentSample;
  const cpuCount = Math.max(1, os.cpus().length);
  return Math.max(0, Math.min(100, cpuPercent / cpuCount));
}

function sampleMainProcessMemoryMb(): number {
  const rssBytes = process.memoryUsage().rss;
  return Math.max(0, Math.round(rssBytes / (1024 * 1024)));
}

function readLinuxTotalSystemTicks(): number | null {
  try {
    const stat = fs.readFileSync("/proc/stat", { encoding: "utf-8" });
    const firstLine = stat.split("\n")[0] ?? "";
    const parts = firstLine.trim().split(/\s+/);
    if (parts.length < 2 || parts[0] !== "cpu") {
      return null;
    }
    let total = 0;
    for (let i = 1; i < parts.length; i += 1) {
      const value = Number(parts[i]);
      if (Number.isFinite(value)) {
        total += value;
      }
    }
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

function readLinuxProcessTicks(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, { encoding: "utf-8" });
    const rightParen = stat.lastIndexOf(")");
    if (rightParen === -1 || rightParen + 2 >= stat.length) {
      return null;
    }
    const fields = stat.slice(rightParen + 2).trim().split(/\s+/);
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) {
      return null;
    }
    return utime + stime;
  } catch {
    return null;
  }
}

function sampleLinuxAggregateCpuPercent(pids: number[]): number | null {
  if (pids.length === 0) {
    return null;
  }
  const sampledAtNs = process.hrtime.bigint();
  const totalSystemTicks = readLinuxTotalSystemTicks();
  if (typeof totalSystemTicks !== "number") {
    return null;
  }
  const perPidTicks = new Map<number, number>();
  for (const pid of pids) {
    const ticks = readLinuxProcessTicks(pid);
    if (typeof ticks === "number") {
      perPidTicks.set(pid, ticks);
    }
  }
  if (perPidTicks.size === 0) {
    return null;
  }

  const previous = lastLinuxProcessCpuSample;
  if (previous) {
    const elapsedMs = Number(sampledAtNs - previous.sampledAtNs) / 1_000_000;
    if (Number.isFinite(elapsedMs) && elapsedMs < 500) {
      return previous.lastPercent;
    }
  }

  if (!previous) {
    lastLinuxProcessCpuSample = {
      totalSystemTicks,
      perPidTicks,
      sampledAtNs,
      lastPercent: 0,
    };
    return 0;
  }

  const totalDelta = totalSystemTicks - previous.totalSystemTicks;
  if (!(totalDelta > 0)) {
    lastLinuxProcessCpuSample = {
      totalSystemTicks,
      perPidTicks,
      sampledAtNs,
      lastPercent: previous.lastPercent,
    };
    return 0;
  }

  let pidDelta = 0;
  for (const [pid, currentTicks] of perPidTicks.entries()) {
    const prevTicks = previous.perPidTicks.get(pid);
    if (typeof prevTicks === "number" && currentTicks >= prevTicks) {
      pidDelta += currentTicks - prevTicks;
    }
  }

  const percent = (pidDelta / totalDelta) * 100;
  const nextPercent =
    Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : previous.lastPercent;
  lastLinuxProcessCpuSample = {
    totalSystemTicks,
    perPidTicks,
    sampledAtNs,
    lastPercent: nextPercent,
  };
  return nextPercent;
}

function readLinuxProcessPssKb(pid: number): number | null {
  try {
    const smapsRollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, {
      encoding: "utf-8",
    });
    const match = smapsRollup.match(/^Pss:\s+(\d+)\s+kB$/m);
    if (!match) {
      return null;
    }
    const pssKb = Number(match[1]);
    return Number.isFinite(pssKb) && pssKb >= 0 ? pssKb : null;
  } catch {
    return null;
  }
}

function sampleLinuxAggregatePssMemoryMb(pids: number[]): number | null {
  if (pids.length === 0) {
    return null;
  }
  let totalPssKb = 0;
  let sawPss = false;
  for (const pid of pids) {
    const pssKb = readLinuxProcessPssKb(pid);
    if (typeof pssKb === "number") {
      totalPssKb += pssKb;
      sawPss = true;
    }
  }
  if (!sawPss) {
    return null;
  }
  return Math.max(0, Math.round(totalPssKb / 1024));
}

function sampleStudioProcessStats(app: ElectronApp): StudioProcessStats {
  const metrics = app.getAppMetrics?.();
  if (Array.isArray(metrics) && metrics.length > 0) {
    const metricPids = [
      ...new Set(
        metrics
          .map((metric) =>
            typeof metric?.pid === "number" &&
            Number.isFinite(metric.pid) &&
            metric.pid > 0
              ? metric.pid
              : null
          )
          .filter((pid): pid is number => pid !== null)
      ),
    ];
    let metricCpuPercent = 0;
    let sawMetricCpu = false;
    let metricWorkingSetMb = 0;
    let sawMetricMemory = false;
    for (const metric of metrics) {
      const metricCpu = metric?.cpu?.percentCPU;
      if (typeof metricCpu === "number" && Number.isFinite(metricCpu)) {
        metricCpuPercent += Math.max(0, metricCpu);
        sawMetricCpu = true;
      }
      const workingSetKb = metric?.memory?.workingSetSize;
      if (typeof workingSetKb === "number" && Number.isFinite(workingSetKb)) {
        metricWorkingSetMb += Math.max(0, workingSetKb / 1024);
        sawMetricMemory = true;
      }
    }
    const linuxAggregateCpuPercent = sampleLinuxAggregateCpuPercent(metricPids);
    const linuxAggregatePssMemoryMb = sampleLinuxAggregatePssMemoryMb(metricPids);
    return {
      cpuPercent:
        typeof linuxAggregateCpuPercent === "number"
          ? linuxAggregateCpuPercent
          : sawMetricCpu
          ? Math.max(0, Math.min(100, metricCpuPercent))
          : sampleMainProcessCpuPercent(),
      memoryMb:
        typeof linuxAggregatePssMemoryMb === "number"
          ? linuxAggregatePssMemoryMb
          : sawMetricMemory
          ? Math.max(0, Math.round(metricWorkingSetMb))
          : sampleMainProcessMemoryMb(),
    };
  }

  return {
    cpuPercent: sampleMainProcessCpuPercent(),
    memoryMb: sampleMainProcessMemoryMb(),
  };
}

type RendererGoneDetails = {
  reason?: unknown;
  exitCode?: unknown;
};

function attachRendererDiagnostics(win: BrowserWindowInstance) {
  const webContents = win.webContents;
  const currentUrl = () => {
    try {
      return webContents.getURL?.() ?? "<unknown>";
    } catch {
      return "<unknown>";
    }
  };

  webContents.on?.("render-process-gone", (_event: unknown, details: unknown) => {
    const typed = (details ?? {}) as RendererGoneDetails;
    const reason = typeof typed.reason === "string" ? typed.reason : "unknown";
    const exitCode =
      typeof typed.exitCode === "number" ? typed.exitCode : "unknown";
    console.error(
      `[Electron] Renderer process gone. reason=${reason} exitCode=${exitCode} url=${currentUrl()}`
    );
  });

  webContents.on?.(
    "did-fail-load",
    (
      _event: unknown,
      errorCode: unknown,
      errorDescription: unknown,
      validatedURL: unknown,
      isMainFrame: unknown
    ) => {
      if (isMainFrame !== true) {
        return;
      }
      console.error(
        `[Electron] Renderer failed to load main frame. errorCode=${String(
          errorCode
        )} errorDescription=${String(errorDescription)} url=${String(
          validatedURL
        )}`
      );
    }
  );

  webContents.on?.("unresponsive", () => {
    console.warn(
      `[Electron] Renderer became unresponsive. url=${currentUrl()}`
    );
  });

  webContents.on?.("responsive", () => {
    console.log(`[Electron] Renderer became responsive again. url=${currentUrl()}`);
  });
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
    ? resolveProjectLockDirectory(projectRootEnv)
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
    registerStudioPersistence(ipcMain, BrowserWindow);
  }

  const useNativeFrame = env.ROBOTICK_USE_NATIVE_FRAME === "1";
  const projectLockOwner: ProjectLockOwner = {
    pid: process.pid,
    instanceName:
      env.ROBOTICK_STUDIO_INSTANCE_NAME?.trim() || `studio-${process.pid}`,
  };
  console.log(
    `[Bootstrap] Window frame mode: ${useNativeFrame ? "native" : "custom"}`
  );
  const cesiumToken = env.CESIUM_TOKEN?.trim();
  if (cesiumToken) {
    console.log("[Bootstrap] CESIUM_TOKEN detected.");
  }
  const desiredCwd =
    env.ROBOTICK_WORKSPACE_ROOT || resolvedProjectRoot;
  const isSmokeTest = env.ROBOTICK_SMOKE_TEST === "1";
  const isHubManaged = env.ROBOTICK_STUDIO_MANAGED_BY_HUB === "1";
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
  if (env.ELECTRON_DEV === "1") {
    app.commandLine.appendSwitch(
      "remote-debugging-port",
      env.ROBOTICK_REMOTE_DEBUGGING_PORT || "9222",
    );
  }
  const disableAccelerated2dCanvas =
    env.ROBOTICK_STUDIO_DISABLE_ACCELERATED_2D_CANVAS !== "0";
  if (disableAccelerated2dCanvas) {
    app.commandLine.appendSwitch("disable-accelerated-2d-canvas", "");
    console.log("[Bootstrap] Disabled accelerated 2D canvas");
  }

  const windowStateStore = readWindowStateStore();
  const windowMetadataByWindow = new WeakMap<
    BrowserWindowInstance,
    WindowMetadata
  >();
  const openChildScopes = new Set<string>();
  const windowByScope = new Map<string, BrowserWindowInstance>();
  const requestedBootstrapProjectPath =
    env.ROBOTICK_PROJECT_DIR?.trim().length
      ? resolveProjectPath(env.ROBOTICK_PROJECT_DIR)
      : "";
  let currentProjectPath = "";
  let bootstrapProjectIssue: ProjectSelectionIssue | null = null;

  const getProjectSelectionState = (): ProjectSelectionState => ({
    currentProjectPath,
    bootstrapIssue: bootstrapProjectIssue,
  });

  const broadcastProjectSelectionState = () => {
    const payload = getProjectSelectionState();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed?.()) {
        continue;
      }
      win.webContents.send("robotick-project-selection:changed", payload);
    }
  };

  const requestProjectSelection = (
    projectPath: string,
    options: { bootstrap?: boolean } = {}
  ): ProjectSelectionResult => {
    const normalizedPath = projectPath.trim()
      ? resolveProjectPath(projectPath)
      : "";

    if (!normalizedPath) {
      if (currentProjectPath) {
        releaseProjectLock(currentProjectPath, projectLockOwner);
      }
      currentProjectPath = "";
      if (options.bootstrap) {
        bootstrapProjectIssue = null;
      }
      broadcastProjectSelectionState();
      return {
        accepted: true,
        currentProjectPath,
        issue: null,
      };
    }

    if (normalizedPath === currentProjectPath) {
      return {
        accepted: true,
        currentProjectPath,
        issue: null,
      };
    }

    try {
      acquireProjectLock(normalizedPath, projectLockOwner);
    } catch (error) {
      const issue: ProjectSelectionIssue =
        error instanceof Error && "issue" in error
          ? ((error as { issue?: ProjectSelectionIssue }).issue ?? {
              type: "error",
              projectPath: normalizedPath,
              message: error.message,
            })
          : {
              type: "error",
              projectPath: normalizedPath,
              message:
                error instanceof Error
                  ? error.message
                  : "Studio could not switch to the requested project.",
            };
      console.error("[Bootstrap] Project selection failed", issue, error);
      if (options.bootstrap) {
        bootstrapProjectIssue = issue;
        currentProjectPath = "";
        broadcastProjectSelectionState();
      }
      return {
        accepted: false,
        currentProjectPath,
        issue,
      };
    }

    const previousProjectPath = currentProjectPath;
    currentProjectPath = normalizedPath;
    bootstrapProjectIssue = null;
    if (previousProjectPath && previousProjectPath !== normalizedPath) {
      releaseProjectLock(previousProjectPath, projectLockOwner);
    }
    broadcastProjectSelectionState();
    return {
      accepted: true,
      currentProjectPath,
      issue: null,
    };
  };

  if (requestedBootstrapProjectPath) {
    const initialSelection = requestProjectSelection(requestedBootstrapProjectPath, {
      bootstrap: true,
    });
    if (!initialSelection.accepted && initialSelection.issue) {
      console.warn(
        "[Bootstrap] Initial project lock unavailable",
        initialSelection.issue
      );
    }
  }

  const getWindowStateForScope = (scope: string): WindowState => {
    const scopedState = windowStateStore.windows[scope];
    const fallbackState = windowStateStore.windows[PRIMARY_WINDOW_SCOPE];
    return clampToDisplay({
      ...DEFAULT_WINDOW_STATE,
      ...(scopedState ?? fallbackState ?? DEFAULT_WINDOW_STATE),
    });
  };

  const setWindowStateForScope = (scope: string, state: WindowState) => {
    windowStateStore.windows[scope] = {
      ...DEFAULT_WINDOW_STATE,
      ...state,
    };
    scheduleWindowStateWrite(windowStateStore);
  };

  const registerWindowMetadata = (
    win: BrowserWindowInstance,
    metadata: WindowMetadata
  ) => {
    windowMetadataByWindow.set(win, metadata);
    windowByScope.set(metadata.scope, win);
    if (!metadata.isPrimary) {
      openChildScopes.add(metadata.scope);
    }
    win.on("closed", () => {
      const mapped = windowByScope.get(metadata.scope);
      if (mapped === win) {
        windowByScope.delete(metadata.scope);
      }
      if (!metadata.isPrimary) {
        openChildScopes.delete(metadata.scope);
      }
    });
  };

  const allocateChildScope = (reservedScopes: Iterable<string> = []): string => {
    const reserved = new Set(reservedScopes);
    let index = 1;
    while (
      openChildScopes.has(`${CHILD_WINDOW_SCOPE_PREFIX}${index}`) ||
      reserved.has(`${CHILD_WINDOW_SCOPE_PREFIX}${index}`)
    ) {
      index += 1;
    }
    return `${CHILD_WINDOW_SCOPE_PREFIX}${index}`;
  };

  app.on("browser-window-created", (_event, window) => {
    const browserWindow = window as BrowserWindowInstance;
    browserWindow.setMenuBarVisibility(false);
    if (windowMetadataByWindow.has(browserWindow)) {
      return;
    }
    const scope =
      parseWindowScopeFromArgs(
        (window as { webContents?: { getLastWebPreferences?: () => { additionalArguments?: string[] } } })
          ?.webContents?.getLastWebPreferences?.()?.additionalArguments
      ) ?? PRIMARY_WINDOW_SCOPE;
    const isPrimary = parseIsPrimaryFromArgs(
      (window as { webContents?: { getLastWebPreferences?: () => { additionalArguments?: string[] } } })
        ?.webContents?.getLastWebPreferences?.()?.additionalArguments
    );
    registerWindowMetadata(browserWindow, {
      scope,
      isPrimary,
    });
  });

  app.on("web-contents-created", (_event, contents) => {
    const webContents = contents as WebContentsLike;
    webContents.setWindowOpenHandler?.(() => ({
      action: "allow",
      overrideBrowserWindowOptions: getDefaultWindowOptions(
        getWindowStateForScope(PRIMARY_WINDOW_SCOPE),
        platform,
        windowIconPath,
        {
          useNativeFrame,
          windowScope: PRIMARY_WINDOW_SCOPE,
          isPrimaryWindow: true,
        }
      ),
    }));
  });

  const registerWindowStateListeners = (
    win: BrowserWindowInstance,
    scope: string
  ) => {
    const saveState = () => {
      const state: WindowState = {
        ...win.getBounds(),
        isMaximized: win.isMaximized(),
      };
      setWindowStateForScope(scope, state);
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

  let createWindow: (options?: {
    scope?: string;
    isPrimary?: boolean;
    projectPath?: string;
  }) => BrowserWindowInstance;

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
    payload?: { x?: number; y?: number; projectPath?: string; scope?: string }
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
      case "createWindow": {
        const createWithScope = (scope: string) => {
          const existing = windowByScope.get(scope);
          if (existing && !(existing.isDestroyed?.() ?? false)) {
            if (existing.isMinimized?.()) {
              existing.restore?.();
            }
            existing.show?.();
            existing.focus?.();
            return {
              isMaximized: target.isMaximized(),
            };
          }
          if (payload?.projectPath) {
            return ensureChildWindowInDocument(payload.projectPath, scope).then(
              () => {
                createWindow({
                  scope,
                  isPrimary: false,
                  projectPath: payload.projectPath,
                });
                return {
                  isMaximized: target.isMaximized(),
                };
              }
            );
          }
          createWindow({
            scope,
            isPrimary: false,
            projectPath: payload?.projectPath,
          });
          return {
            isMaximized: target.isMaximized(),
          };
        };

        const explicitScope = payload?.scope?.trim();
        if (explicitScope) {
          return createWithScope(explicitScope);
        }

        if (payload?.projectPath) {
          return listChildWindowIdsInDocument(payload.projectPath).then(
            (persistedScopes) => createWithScope(allocateChildScope(persistedScopes))
          );
        }

        return createWithScope(allocateChildScope());
        break;
      }
      case "childScopes":
        return {
          isMaximized: target.isMaximized(),
          childScopes: Array.from(openChildScopes),
        };
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
    ipcMain.on("robotick-renderer-error", (_event, payload: RendererErrorPayload) => {
      const type = typeof payload?.type === "string" ? payload.type : "unknown";
      const message =
        typeof payload?.message === "string" && payload.message.length > 0
          ? payload.message
          : "No message";
      const source =
        typeof payload?.source === "string" && payload.source.length > 0
          ? payload.source
          : typeof payload?.href === "string" && payload.href.length > 0
          ? payload.href
          : "<unknown>";
      const lineno =
        typeof payload?.lineno === "number" ? payload.lineno : "unknown";
      const colno =
        typeof payload?.colno === "number" ? payload.colno : "unknown";
      const stack =
        typeof payload?.stack === "string" && payload.stack.length > 0
          ? payload.stack
          : typeof payload?.reason === "string" && payload.reason.length > 0
          ? payload.reason
          : formatUnknownError(payload?.reason);

      console.error(
        `[Electron] Renderer ${type}: ${message} @ ${source}:${lineno}:${colno}\n${stack}`
      );
    });

    ipcMain.handle(
      "robotick-window-command",
      (
        event: IpcMainInvokeEvent,
        payload:
          | { command: string; x?: number; y?: number; projectPath?: string; scope?: string }
          | undefined
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
    ipcMain.handle("robotick-project-selection:get-state", () =>
      getProjectSelectionState()
    );
    ipcMain.handle(
      "robotick-project-selection:set",
      (
        _event: IpcMainInvokeEvent,
        payload: { projectPath?: string } | undefined
      ) => requestProjectSelection(payload?.projectPath?.trim() || "")
    );
    ipcMain.handle(
      "robotick-project-selection:lock-statuses",
      (
        _event: IpcMainInvokeEvent,
        payload: { projectPaths?: string[] } | undefined
      ) => ({
        statuses: (Array.isArray(payload?.projectPaths)
          ? payload.projectPaths
          : []
        )
          .filter((projectPath): projectPath is string => typeof projectPath === "string")
          .map((projectPath) => readProjectLockStatus(projectPath, projectLockOwner)),
      })
    );
    ipcMain.handle("robotick-studio-process-stats", () =>
      sampleStudioProcessStats(app)
    );
  }

  const shutdown = (code = 0) => {
    if (currentProjectPath) {
      releaseProjectLock(currentProjectPath, projectLockOwner);
    }
    if (app.exit) {
      app.exit(code);
    } else {
      process.exit(code);
    }
  };

  const notifyRenderersAppQuitting = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send("robotick-app-quitting");
      } catch {
        // ignore renderer notification failures during shutdown
      }
    }
  };

  const closeAllWindowsForQuit = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.destroy?.();
      } catch {
        try {
          win.close();
        } catch {
          // ignore close failures during shutdown
        }
      }
    }
  };

  let gracefulQuitInFlight = false;
  let forcedShutdownTimer: NodeJS.Timeout | null = null;
  let closingNotificationSent = false;
  const runGracefulQuit = async () => {
    if (gracefulQuitInFlight) {
      return;
    }
    gracefulQuitInFlight = true;
    if (!forcedShutdownTimer) {
      forcedShutdownTimer = setTimeout(() => shutdown(0), 1500);
    }
    if (isHubManaged && !closingNotificationSent) {
      closingNotificationSent = true;
      void notifyHubAppClosing(env, "studio");
    }
    if (currentProjectPath) {
      releaseProjectLock(currentProjectPath, projectLockOwner);
    }
    notifyRenderersAppQuitting();
    closeAllWindowsForQuit();
    app.quit();
  };

  app.on("before-quit", (event: unknown) => {
    if (gracefulQuitInFlight) {
      return;
    }
    (event as PreventableEvent | undefined)?.preventDefault?.();
    void runGracefulQuit();
  });

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
  createWindow = (options) => {
    const isPrimary = options?.isPrimary !== false;
    const scope =
      options?.scope ?? (isPrimary ? PRIMARY_WINDOW_SCOPE : allocateChildScope());
    const storedState = getWindowStateForScope(scope);
    const win = new BrowserWindow(
      getDefaultWindowOptions(storedState, platform, windowIconPath, {
        useNativeFrame,
        windowScope: scope,
        isPrimaryWindow: isPrimary,
      })
    );
    let alwaysOnTopTimer: NodeJS.Timeout | null = null;
    const clearAlwaysOnTopTimer = () => {
      if (alwaysOnTopTimer) {
        clearTimeout(alwaysOnTopTimer);
        alwaysOnTopTimer = null;
      }
    };

    registerWindowMetadata(win, { scope, isPrimary });

    if (storedState.isMaximized) {
      win.maximize();
    }

    win.setMenuBarVisibility(false);
    win.on("closed", () => {
      clearAlwaysOnTopTimer();
      if (isPrimary && platform !== "darwin" && isHubManaged) {
        void runGracefulQuit();
      }
    });
    registerWindowStateListeners(win, scope);
    registerDevtoolsShortcuts(win, platform);
    attachRendererDiagnostics(win);
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
      void resolveDevServerUrl().then((url) => {
        win.loadURL(url);
      });
    } else {
      const indexPath = path.join(__dirname, "../../renderer/index.html");
      console.log("Launching app at:", indexPath);
      win.loadFile(indexPath);
    }
    scheduleSmokeCheck(win);
    return win;
  };

  app.on("window-all-closed", () => {
    if (platform !== "darwin") {
      void runGracefulQuit();
    }
  });

  await app.whenReady();

  createWindow({
    scope: PRIMARY_WINDOW_SCOPE,
    isPrimary: true,
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({
        scope: PRIMARY_WINDOW_SCOPE,
        isPrimary: true,
      });
    }
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGHUP", () => shutdown(0));
  process.on("uncaughtException", (error) => {
    console.error(
      `[Electron] Main process uncaughtException\n${formatUnknownError(error)}`
    );
    shutdown(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(
      `[Electron] Main process unhandledRejection\n${formatUnknownError(reason)}`
    );
    shutdown(1);
  });
}
