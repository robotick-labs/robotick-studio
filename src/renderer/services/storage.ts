type StorageResult = {
  value: string | null;
  key: string | null;
};

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStorageValue(key: string): string | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function setStorageValue(key: string, value: string): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function removeStorageValue(key: string): void {
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
