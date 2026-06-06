import { contextBridge, ipcRenderer } from "electron";

const WINDOW_SCOPE_ARG_PREFIX = "--robotick-window-scope=";
const WINDOW_PRIMARY_ARG_PREFIX = "--robotick-window-primary=";

type RendererErrorReport = {
  type: "error" | "unhandledrejection";
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  reason?: string;
  href?: string;
};

function describeUnknownError(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    const withMaybeStack = value as { message: string; stack?: unknown; name?: unknown };
    if (typeof withMaybeStack.stack === "string" && withMaybeStack.stack.length > 0) {
      return withMaybeStack.stack;
    }
    const name =
      typeof withMaybeStack.name === "string" && withMaybeStack.name.length > 0
        ? withMaybeStack.name
        : "Error";
    return `${name}: ${withMaybeStack.message}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function reportRendererError(payload: RendererErrorReport) {
  try {
    ipcRenderer.send("robotick-renderer-error", payload);
  } catch (error) {
    console.error("[Preload] Failed to report renderer error:", error);
  }
}

function installRendererErrorForwarding() {
  window.addEventListener("error", (event) => {
    const maybeError = event.error;
    reportRendererError({
      type: "error",
      message: event.message || maybeError?.message || "Unknown renderer error",
      stack:
        maybeError instanceof Error
          ? maybeError.stack
          : typeof maybeError === "string"
          ? maybeError
          : undefined,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      href: window.location.href,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportRendererError({
      type: "unhandledrejection",
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection",
      stack: reason instanceof Error ? reason.stack : undefined,
      reason: describeUnknownError(reason),
      href: window.location.href,
    });
  });
}

function installAppQuittingForwarding() {
  ipcRenderer.on("robotick-app-quitting", () => {
    window.dispatchEvent(new Event("robotick:app-quitting"));
  });
}

function readArgument(prefix: string): string | undefined {
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  if (!arg) {
    return undefined;
  }
  const value = arg.slice(prefix.length).trim();
  return value.length > 0 ? value : undefined;
}

const expose = () => {
  installRendererErrorForwarding();
  installAppQuittingForwarding();

  const usesNativeWindowFrame = process.env.ROBOTICK_USE_NATIVE_FRAME === "1";
  const windowControls = usesNativeWindowFrame
    ? undefined
    : {
        minimize: () =>
          ipcRenderer.invoke("robotick-window-command", { command: "minimize" }),
        maximize: () =>
          ipcRenderer.invoke("robotick-window-command", {
            command: "maximize",
          }),
        restore: () =>
          ipcRenderer.invoke("robotick-window-command", { command: "restore" }),
        close: () =>
          ipcRenderer.invoke("robotick-window-command", { command: "close" }),
        createWindow: (seedUrl?: string, scope?: string) =>
          ipcRenderer.invoke("robotick-window-command", {
            command: "createWindow",
            seedUrl,
            scope,
          }),
        getChildWindowScopes: async () => {
          const response = (await ipcRenderer.invoke("robotick-window-command", {
            command: "childScopes",
          })) as { childScopes?: string[] } | undefined;
          return Array.isArray(response?.childScopes) ? response.childScopes : [];
        },
        toggleMaximize: () =>
          ipcRenderer.invoke("robotick-window-command", {
            command: "toggleMaximize",
          }),
        showSystemMenu: (x: number, y: number) =>
          ipcRenderer.invoke("robotick-window-command", {
            command: "systemMenu",
            x,
            y,
          }),
        onStateChange: (callback: (state: { isMaximized: boolean }) => void) => {
          const listener = (_event: unknown, state: { isMaximized: boolean }) => {
            callback(state);
          };
          ipcRenderer.on("robotick-window-state", listener);
          ipcRenderer
            .invoke("robotick-window-command", { command: "state" })
            .then((state) => callback(state));
          return () => {
            ipcRenderer.off("robotick-window-state", listener);
          };
        },
      };

  const studioProcess = {
    getStats: () =>
      ipcRenderer.invoke("robotick-studio-process-stats") as Promise<{
        cpuPercent: number;
        memoryMb: number;
      }>,
  };

  const cesiumToken = process.env.CESIUM_TOKEN?.trim();
  if (!cesiumToken) {
    console.warn(
      "[Preload] CESIUM_TOKEN is not set; Cesium viewer may fail to load terrain."
    );
  }

  type StorageLoadResponse = {
    data: Record<string, string> | null;
    fileBacked: boolean;
  };
  let storageCache: Record<string, string> | null = null;
  let hasFileStore = false;
  try {
    // Intentionally use synchronous IPC so storage is ready before the renderer initializes.
    // This blocks the preload thread briefly, so if the main process is slow it can delay startup.
    const payload = ipcRenderer.sendSync(
      "robotick-storage:load"
    ) as StorageLoadResponse;
    hasFileStore = payload.fileBacked;
    storageCache = payload.fileBacked ? payload.data ?? {} : null;
  } catch (error) {
    console.warn("[Preload] Failed to bootstrap renderer storage:", error);
    storageCache = null;
    hasFileStore = false;
  }

  const storageBridge = {
    getItem(key: string): string | null {
      if (hasFileStore && storageCache) {
        try {
          const latest = ipcRenderer.sendSync("robotick-storage:get", { key }) as
            | string
            | null;
          if (latest === null) {
            delete storageCache[key];
            return null;
          }
          storageCache[key] = latest;
          return latest;
        } catch {
          return Object.prototype.hasOwnProperty.call(storageCache, key)
            ? storageCache[key]
            : null;
        }
      }
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string): void {
      if (hasFileStore) {
        if (!storageCache) {
          storageCache = {};
        }
        storageCache[key] = value;
        void ipcRenderer.invoke("robotick-storage:set", { key, value });
        return;
      }
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch (error) {
        console.warn("[Preload] Failed to write localStorage value:", error);
      }
    },
    removeItem(key: string): void {
      if (hasFileStore && storageCache) {
        if (Object.prototype.hasOwnProperty.call(storageCache, key)) {
          delete storageCache[key];
          void ipcRenderer.invoke("robotick-storage:remove", { key });
        }
        return;
      }
      try {
        globalThis.localStorage?.removeItem(key);
      } catch (error) {
        console.warn("[Preload] Failed to remove localStorage value:", error);
      }
    },
    clear(): void {
      if (hasFileStore) {
        storageCache = {};
        void ipcRenderer.invoke("robotick-storage:clear");
        return;
      }
      try {
        globalThis.localStorage?.clear();
      } catch (error) {
        console.warn("[Preload] Failed to clear localStorage:", error);
      }
    },
  };

  const robotickGlobals = {
    environment: {
      isStandaloneApp: true,
      appTitle: "Robotick Studio",
      cesiumToken,
      hubEndpoint: process.env.ROBOTICK_HUB_ENDPOINT?.trim() || undefined,
      usesNativeWindowFrame,
      windowScope: readArgument(WINDOW_SCOPE_ARG_PREFIX) ?? "primary",
      isPrimaryWindow:
        (readArgument(WINDOW_PRIMARY_ARG_PREFIX) ?? "1") !== "0",
      workspaceRoot:
        process.env.ROBOTICK_PROJECT_DIR ??
        process.env.ROBOTICK_WORKSPACE_ROOT,
    },
    windowControls,
    studioProcess,
    storage: storageBridge,
  };

  contextBridge.exposeInMainWorld("robotick", robotickGlobals);
};

expose();
