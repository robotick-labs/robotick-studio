import { contextBridge, ipcRenderer } from "electron";

const expose = () => {
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
        return Object.prototype.hasOwnProperty.call(storageCache, key)
          ? storageCache[key]
          : null;
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
      usesNativeWindowFrame,
    },
    windowControls,
    storage: storageBridge,
  };

  contextBridge.exposeInMainWorld("robotick", robotickGlobals);
};

expose();
