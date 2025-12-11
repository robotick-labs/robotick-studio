import fs from "fs";
import path from "path";
import type { IpcMain } from "electron";

type StorageState = Record<string, string>;

/**
 * Parse JSON text into a StorageState when the JSON represents an object whose values are strings.
 *
 * @param content - JSON string to parse
 * @returns The parsed `StorageState` if `content` is a JSON object with only string values; otherwise an empty object
 */
function safeParse(content: string): StorageState {
  try {
    const parsed = JSON.parse(content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Object.values(parsed).every((value) => typeof value === "string")
    ) {
      return parsed as StorageState;
    }
  } catch {
    // fall through to empty object
  }
  return {};
}

/**
 * Registers IPC handlers that provide a simple string key–value storage for renderer processes, optionally persisted to a JSON file.
 *
 * When a `storageFile` path is provided, the module keeps a per-process in-memory cache backed by that file and persists changes to disk. When `storageFile` is omitted, storage operations become no-ops and loads indicate the storage is not file-backed.
 *
 * @param storageFile - Optional filesystem path to a JSON file used to persist storage; if omitted, storage is not persisted and read/write handlers are effectively disabled
 */
export function registerRendererStorage(
  ipcMain: IpcMain,
  storageFile?: string
) {
  let cache: StorageState | null = null;

  const ensureCache = (): StorageState => {
    if (cache) {
      return cache;
    }
    if (!storageFile) {
      cache = {};
      return cache;
    }
    try {
      const raw = fs.readFileSync(storageFile, "utf-8");
      cache = raw ? safeParse(raw) : {};
    } catch (error) {
      cache = {};
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[Bootstrap] Failed to read renderer storage:", error);
      }
    }
    return cache;
  };

  const persist = () => {
    if (!storageFile || !cache) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(storageFile), { recursive: true });
      fs.writeFileSync(
        storageFile,
        JSON.stringify(cache, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.warn("[Bootstrap] Failed to persist renderer storage:", error);
    }
  };

  ipcMain.on("robotick-storage:load", (event) => {
    const data = storageFile ? ensureCache() : null;
    event.returnValue = {
      data,
      fileBacked: Boolean(storageFile),
    };
  });

  ipcMain.handle(
    "robotick-storage:set",
    async (_event, payload: { key: string; value: string }) => {
      if (!storageFile) {
        return;
      }
      const state = ensureCache();
      state[payload.key] = payload.value;
      persist();
    }
  );

  ipcMain.handle(
    "robotick-storage:remove",
    async (_event, payload: { key: string }) => {
      if (!storageFile) {
        return;
      }
      const state = ensureCache();
      if (Object.prototype.hasOwnProperty.call(state, payload.key)) {
        delete state[payload.key];
        persist();
      }
    }
  );

  ipcMain.handle("robotick-storage:clear", async () => {
    if (!storageFile) {
      return;
    }
    cache = {};
    persist();
  });
}