type StorageResult = {
  value: string | null;
  key: string | null;
};

type StorageBridge = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
  clear?: () => void;
};

/**
 * Retrieve an optional StorageBridge provided via window.robotick.storage.
 *
 * @returns The `StorageBridge` object from `window.robotick.storage` when available; `null` if `window` is undefined or the bridge is not present.
 */
function getBridge(): StorageBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.robotick?.storage ?? null;
}

/**
 * Accesses the browser's localStorage when it is present and accessible.
 *
 * @returns The `localStorage` object, or `null` if `window` is undefined or access to `localStorage` throws.
 */
function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Provides a Storage-compatible object, preferring the environment's `localStorage`.
 *
 * @returns A `Storage` instance — either the platform `localStorage` or an in-memory, Map-backed Storage-compatible object — or `null` if no storage can be obtained.
 */
function getFallbackStorage(): Storage | null {
  const storage = getLocalStorage();
  if (storage) return storage;
  try {
    const map = new Map<string, string>();
    return {
      length: map.size,
      clear: () => map.clear(),
      getItem: (key: string) => map.get(key) ?? null,
      key: (index: number) => Array.from(map.keys())[index] ?? null,
      removeItem: (key: string) => {
        map.delete(key);
      },
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };
  } catch {
    return null;
  }
}

/**
 * Retrieve the stored value for a key, preferring a bridge implementation and falling back to localStorage.
 *
 * @returns The `string` value associated with `key` if found; `null` if not found, if storage is unavailable, or if an error occurs during retrieval.
 */
export function readStorageValue(key: string): string | null {
  const bridge = getBridge();
  if (bridge?.getItem) {
    try {
      return bridge.getItem(key);
    } catch {
      // fall through
    }
  }
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Stores a string value under the given key using the configured storage bridge or localStorage.
 *
 * If the bridge is present it is used first; if storage is unavailable or an operation fails, errors are silently ignored.
 *
 * @param key - The storage key to set
 * @param value - The string value to store
 */
export function setStorageValue(key: string, value: string): void {
  const bridge = getBridge();
  if (bridge?.setItem) {
    try {
      bridge.setItem(key, value);
      return;
    } catch {
      // fall back
    }
  }
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * Remove the value associated with a key from storage using an optional bridge or fallback.
 *
 * Attempts to remove the specified key via an available storage bridge; if the bridge is absent
 * or its call throws, the function falls back to removing the key from localStorage. All errors
 * are swallowed and not propagated.
 *
 * @param key - The storage key to remove
 */
export function removeStorageValue(key: string): void {
  const bridge = getBridge();
  if (bridge?.removeItem) {
    try {
      bridge.removeItem(key);
      return;
    } catch {
      // ignore
    }
  }
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function buildNamespacedKey(
  base: string,
  ...segments: Array<string | undefined>
): string {
  const suffixes = segments.filter((segment) => Boolean(segment));
  if (suffixes.length === 0) {
    return base;
  }
  return [base, ...suffixes].join(".");
}

export function getFirstAvailableValue(keys: string[]): StorageResult {
  for (const key of keys) {
    const value = readStorageValue(key);
    if (value !== null) {
      return { value, key };
    }
  }
  return { value: null, key: null };
}

export function createPanelInstanceId(): string {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `anon-${Math.random().toString(16).slice(2)}`;
}