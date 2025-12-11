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

function getBridge(): StorageBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.robotick?.storage ?? null;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

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
