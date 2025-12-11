import { contextBridge, ipcRenderer } from "electron";
import fs from "fs";
import path from "path";

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

  const projectRoot =
    process.env.ROBOTICK_PROJECT_DIR || process.env.ROBOTICK_WORKSPACE_ROOT;
  const resolvedProjectRoot = projectRoot
    ? path.resolve(projectRoot)
    : undefined;
  const storageDir = resolvedProjectRoot
    ? path.join(resolvedProjectRoot, ".studio")
    : undefined;
  const storageFile = storageDir
    ? path.join(storageDir, "renderer-storage.json")
    : undefined;
  let storageCache: Record<string, string> | null = null;
  let writeTimeout: ReturnType<typeof setTimeout> | null = null;

  const readStorageFile = (): Record<string, string> | null => {
    if (!storageFile) {
      return null;
    }
    if (storageCache) {
      return storageCache;
    }
    try {
      const raw = fs.readFileSync(storageFile, { encoding: "utf-8" });
      if (!raw) {
        storageCache = {};
        return storageCache;
      }
      const parsed = JSON.parse(raw);
      const isValidObject =
        typeof parsed === "object" &&
        parsed !== null &&
        Object.entries(parsed).every(
          ([key, value]) => typeof key === "string" && typeof value === "string"
        );
      if (isValidObject) {
        storageCache = parsed as Record<string, string>;
      } else {
        console.warn(
          "[Preload] Renderer storage contained invalid data; resetting."
        );
        storageCache = {};
      }
    } catch (error) {
      storageCache = {};
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[Preload] Failed to read renderer storage:", error);
      }
    }
    return storageCache;
  };

  const writeStorageFile = () => {
    if (!storageFile || !storageCache) {
      return;
    }
    if (writeTimeout) {
      clearTimeout(writeTimeout);
    }
    writeTimeout = setTimeout(() => {
      writeTimeout = null;
      try {
        fs.mkdirSync(path.dirname(storageFile), { recursive: true });
        fs.writeFileSync(
          storageFile,
          JSON.stringify(storageCache, null, 2),
          "utf-8"
        );
      } catch (error) {
        console.warn("[Preload] Failed to persist renderer storage:", error);
      }
    }, 100);
  };

  const storageBridge = {
    getItem(key: string): string | null {
      const fileStore = readStorageFile();
      if (fileStore) {
        return Object.prototype.hasOwnProperty.call(fileStore, key)
          ? fileStore[key]
          : null;
      }
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string): void {
      const fileStore = readStorageFile();
      if (fileStore) {
        fileStore[key] = value;
        writeStorageFile();
        return;
      }
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch (error) {
        console.warn("[Preload] Failed to write localStorage value:", error);
      }
    },
    removeItem(key: string): void {
      const fileStore = readStorageFile();
      if (fileStore) {
        if (Object.prototype.hasOwnProperty.call(fileStore, key)) {
          delete fileStore[key];
          writeStorageFile();
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
      const fileStore = readStorageFile();
      if (fileStore) {
        storageCache = {};
        writeStorageFile();
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
