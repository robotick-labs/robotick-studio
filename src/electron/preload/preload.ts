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
  const workspaceRoot =
    process.env.ROBOTICK_WORKSPACE_ROOT ??
    process.env.ROBOTICK_PROJECT_DIR;
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
        createWindow: (projectPath?: string, scope?: string) =>
          ipcRenderer.invoke("robotick-window-command", {
            command: "createWindow",
            projectPath,
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

  let latestActivationEvent: { activated_path: string[] } | null = null;
  const activationListeners = new Set<
    (payload: { activated_path: string[] }) => void
  >();
  ipcRenderer.on(
    "robotick-studio-activation:changed",
    (_event, payload: { activated_path?: string[] } | undefined) => {
      latestActivationEvent = {
        activated_path: Array.isArray(payload?.activated_path)
          ? payload.activated_path.filter((segment) => typeof segment === "string")
          : [],
      };
      for (const callback of activationListeners) {
        callback(latestActivationEvent);
      }
    }
  );

  const studioControlBridge = {
    reportActiveResource(payload: {
      window_id?: string;
      workbench_id?: string;
      layout_id?: string;
      panel_id?: string;
    }) {
      ipcRenderer.send("robotick-studio-runtime:active-resource", payload);
    },
    getLastActivation() {
      return latestActivationEvent;
    },
    onActivationChanged(callback: (payload: { activated_path: string[] }) => void) {
      activationListeners.add(callback);
      return () => {
        activationListeners.delete(callback);
      };
    },
  };

  const diagnosticsBridge = {
    publishSnapshot(snapshot: Record<string, unknown>) {
      ipcRenderer.send("robotick-renderer-diagnostics", snapshot);
    },
    publishEvent(event: {
      source: string;
      level?: "debug" | "info" | "warn" | "error";
      message: string;
      payload?: Record<string, unknown> | null;
    }) {
      ipcRenderer.send("robotick-renderer-diagnostics-event", event);
    },
    requestCommand(commandId: string, input?: Record<string, unknown>) {
      return ipcRenderer.invoke("robotick-renderer-command", {
        commandId,
        input: input ?? {},
      });
    },
    getLogSnapshot(options?: { tail?: number; target?: "studio" }) {
      return ipcRenderer.invoke("robotick-studio-diagnostics-log-snapshot", options);
    },
    onLogEvent(
      callback: (record: {
        target: "runtime" | "studio";
        source: string;
        window_id: string | null;
        recorded_at: string;
        level: "debug" | "info" | "warn" | "error";
        message: string;
        source_url: string | null;
        line: number | null;
        column: number | null;
        stack: string | null;
        payload: Record<string, unknown> | null;
      }) => void
    ) {
      const listener = (
        _event: unknown,
        payload:
          | {
              target: "runtime" | "studio";
              source: string;
              window_id: string | null;
              recorded_at: string;
              level: "debug" | "info" | "warn" | "error";
              message: string;
              source_url: string | null;
              line: number | null;
              column: number | null;
              stack: string | null;
              payload: Record<string, unknown> | null;
            }
          | undefined
      ) => {
        if (payload) {
          callback(payload);
        }
      };
      ipcRenderer.on("robotick-studio-diagnostics-log", listener);
      return () => {
        ipcRenderer.off("robotick-studio-diagnostics-log", listener);
      };
    },
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

  const studioPersistenceBridge = {
    readStudioDocument(projectPath: string): Promise<string | null> {
      return ipcRenderer.invoke("robotick-studio-persistence:read", {
        projectPath,
      }) as Promise<string | null>;
    },
    ensureStudioDocument(projectPath: string): Promise<void> {
      return ipcRenderer.invoke("robotick-studio-persistence:ensure", {
        projectPath,
      }) as Promise<void>;
    },
    writeStudioDocument(projectPath: string, content: string): Promise<void> {
      return ipcRenderer.invoke("robotick-studio-persistence:write", {
        projectPath,
        content,
        windowScope: readArgument(WINDOW_SCOPE_ARG_PREFIX) ?? "primary",
      }) as Promise<void>;
    },
    deleteChildWindow(projectPath: string, windowId: string): Promise<boolean> {
      return ipcRenderer
        .invoke("robotick-studio-persistence:delete-child-window", {
          projectPath,
          windowId,
        })
        .then((response) => Boolean(response?.deleted));
    },
    onDocumentChanged(callback: (projectPath: string) => void): () => void {
      const listener = (
        _event: unknown,
        payload: { projectPath?: string } | undefined
      ) => {
        if (typeof payload?.projectPath === "string") {
          callback(payload.projectPath);
        }
      };
      ipcRenderer.on("robotick-studio-persistence:changed", listener);
      return () => {
        ipcRenderer.off("robotick-studio-persistence:changed", listener);
      };
    },
  };

  const projectSelectionBridge = {
    getState: () =>
      ipcRenderer.invoke("robotick-project-selection:get-state") as Promise<{
        currentProjectPath: string;
        bootstrapIssue: {
          type: "locked" | "error";
          projectPath: string;
          instanceName?: string;
          pid?: number;
          message: string;
        } | null;
      }>,
    setProject: (projectPath: string) =>
      ipcRenderer.invoke("robotick-project-selection:set", {
        projectPath,
      }) as Promise<{
        accepted: boolean;
        currentProjectPath: string;
        issue: {
          type: "locked" | "error";
          projectPath: string;
          instanceName?: string;
          pid?: number;
          message: string;
        } | null;
      }>,
    getLockStatuses: (projectPaths: string[]) =>
      ipcRenderer.invoke("robotick-project-selection:lock-statuses", {
        projectPaths,
      }) as Promise<{
        statuses: Array<{
          projectPath: string;
          state: "available" | "current" | "locked";
          instanceName?: string;
          pid?: number;
          message?: string;
        }>;
      }>,
    onStateChanged: (
        callback: (state: {
          currentProjectPath: string;
          bootstrapIssue: {
            type: "locked" | "error";
            projectPath: string;
            instanceName?: string;
            pid?: number;
          message: string;
        } | null;
      }) => void
    ) => {
      const listener = (
        _event: unknown,
        payload:
          | {
              currentProjectPath?: string;
              bootstrapIssue?: {
                type: "locked" | "error";
                projectPath: string;
                instanceName?: string;
                pid?: number;
                message: string;
              } | null;
            }
          | undefined
      ) => {
        callback({
          currentProjectPath: payload?.currentProjectPath?.trim() || "",
          bootstrapIssue: payload?.bootstrapIssue ?? null,
        });
      };
      ipcRenderer.on("robotick-project-selection:changed", listener);
      return () => {
        ipcRenderer.off("robotick-project-selection:changed", listener);
      };
    },
  };

  type TelemetryBridgeEvent =
    | {
        subscriptionId: string;
        type: "layout";
        payload: unknown;
      }
    | {
        subscriptionId: string;
        type: "frame";
        payload: unknown;
      }
    | {
        subscriptionId: string;
        type: "error";
        message: string;
      };
  type TelemetryBridgeCallbackEvent =
    | {
        type: "layout";
        payload: unknown;
      }
    | {
        type: "frame";
        payload: unknown;
      }
    | {
        type: "error";
        message: string;
      };
  let telemetrySubscriptionSeq = 0;
  const telemetryBridge = {
    ensureLayout(baseUrl: string) {
      return ipcRenderer.invoke("robotick-telemetry:ensure-layout", {
        baseUrl,
      }) as Promise<unknown>;
    },
    refreshLayout(baseUrl: string) {
      return ipcRenderer.invoke("robotick-telemetry:refresh-layout", {
        baseUrl,
      }) as Promise<unknown>;
    },
    getDiagnostics(baseUrl: string) {
      return ipcRenderer.invoke("robotick-telemetry:diagnostics", {
        baseUrl,
      }) as Promise<unknown>;
    },
    getHealth(baseUrl: string) {
      return ipcRenderer.invoke("robotick-telemetry:health", {
        baseUrl,
      }) as Promise<unknown>;
    },
    getPushStats(baseUrl: string) {
      return ipcRenderer.invoke("robotick-telemetry:push-stats", {
        baseUrl,
      }) as Promise<unknown>;
    },
    setWorkloadInputFieldsData(baseUrl: string, request: unknown) {
      return ipcRenderer.invoke(
        "robotick-telemetry:set-workload-input-fields-data",
        {
          baseUrl,
          request,
        },
      ) as Promise<unknown>;
    },
    setWorkloadInputConnectionState(baseUrl: string, request: unknown) {
      return ipcRenderer.invoke(
        "robotick-telemetry:set-workload-input-connection-state",
        {
          baseUrl,
          request,
        },
      ) as Promise<unknown>;
    },
    subscribe(
      baseUrl: string,
      callback: (event: TelemetryBridgeCallbackEvent) => void
    ) {
      const subscriptionId = `renderer-${process.pid}-${Date.now()}-${++telemetrySubscriptionSeq}`;
      const listener = (_event: unknown, payload: TelemetryBridgeEvent | undefined) => {
        if (!payload || payload.subscriptionId !== subscriptionId) {
          return;
        }
        if (payload.type === "error") {
          callback({ type: "error", message: payload.message });
          return;
        }
        callback({ type: payload.type, payload: payload.payload });
      };
      ipcRenderer.on("robotick-telemetry:event", listener);
      void ipcRenderer.invoke("robotick-telemetry:subscribe", {
        subscriptionId,
        baseUrl,
      });
      return () => {
        ipcRenderer.off("robotick-telemetry:event", listener);
        void ipcRenderer.invoke("robotick-telemetry:unsubscribe", {
          subscriptionId,
        });
      };
    },
  };

  const robotickGlobals = {
    environment: {
      isStandaloneApp: true,
      appTitle: "Robotick Studio",
      cesiumToken,
      hubEndpoint: process.env.ROBOTICK_HUB_ENDPOINT?.trim() || undefined,
      selectedProject:
        process.env.ROBOTICK_STUDIO_SELECTED_PROJECT?.trim() || undefined,
      usesNativeWindowFrame,
      windowScope: readArgument(WINDOW_SCOPE_ARG_PREFIX) ?? "primary",
      isPrimaryWindow:
        (readArgument(WINDOW_PRIMARY_ARG_PREFIX) ?? "1") !== "0",
      workspaceRoot,
    },
    hub: {
      getEndpoint: () =>
        ipcRenderer.invoke("robotick-hub:get-endpoint") as Promise<string | undefined>,
    },
    windowControls,
    studioProcess,
    studioControl: studioControlBridge,
    diagnostics: diagnosticsBridge,
    storage: storageBridge,
    studioPersistence: studioPersistenceBridge,
    projectSelection: projectSelectionBridge,
    telemetry: telemetryBridge,
  };

  contextBridge.exposeInMainWorld("robotick", robotickGlobals);
};

expose();
