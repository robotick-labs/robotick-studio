import { readStorageValue, setStorageValue } from "../../../services/storage";
import { addWindowEventListener } from "../../../utils/domEnvironment";

type PanelSettings = Record<string, unknown>;

export type FloatingPanelRecord = {
  id: string;
  editorId: string;
  title?: string;
  settings: PanelSettings;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
};

export type FloatingPanelSpawnConfig = {
  editorId: string;
  title?: string;
  settings?: PanelSettings;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
};

type Listener = (panels: FloatingPanelRecord[]) => void;

const STORAGE_PREFIX = "floating-panels:";
const store = new Map<string, FloatingPanelRecord[]>();
const listeners = new Map<string, Set<Listener>>();

addWindowEventListener("storage", (event: StorageEvent) => {
  if (!event.key || !event.key.startsWith(STORAGE_PREFIX)) {
    return;
  }
  const scope = event.key.slice(STORAGE_PREFIX.length);
  store.delete(scope);
  notify(scope);
});

function clone(records: FloatingPanelRecord[]): FloatingPanelRecord[] {
  return records.map((record) => ({
    ...record,
    settings: { ...record.settings },
  }));
}

function load(scope: string): FloatingPanelRecord[] {
  try {
    const raw = readStorageValue(`${STORAGE_PREFIX}${scope}`);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" && item.id ? item.id : generateId(),
        editorId: String(item.editorId ?? ""),
        title: typeof item.title === "string" ? item.title : undefined,
        settings:
          item.settings && typeof item.settings === "object"
            ? { ...item.settings }
            : {},
        initialPosition:
          item.initialPosition &&
          typeof item.initialPosition.x === "number" &&
          typeof item.initialPosition.y === "number" &&
          Number.isFinite(item.initialPosition.x) &&
          Number.isFinite(item.initialPosition.y)
            ? { x: item.initialPosition.x, y: item.initialPosition.y }
            : undefined,
        initialSize:
          item.initialSize &&
          typeof item.initialSize.width === "number" &&
          typeof item.initialSize.height === "number" &&
          Number.isFinite(item.initialSize.width) &&
          Number.isFinite(item.initialSize.height) &&
          item.initialSize.width > 0 &&
          item.initialSize.height > 0
            ? {
                width: item.initialSize.width,
                height: item.initialSize.height,
              }
            : undefined,
        minSize:
          item.minSize &&
          typeof item.minSize.width === "number" &&
          typeof item.minSize.height === "number" &&
          Number.isFinite(item.minSize.width) &&
          Number.isFinite(item.minSize.height) &&
          item.minSize.width > 0 &&
          item.minSize.height > 0
            ? {
                width: item.minSize.width,
                height: item.minSize.height,
              }
            : undefined,
      }))
      .filter((item) => item.editorId.length > 0);
  } catch {
    return [];
  }
}

function persist(scope: string) {
  const records = store.get(scope) ?? [];
  try {
    setStorageValue(`${STORAGE_PREFIX}${scope}`, JSON.stringify(records));
  } catch {
    /* ignore storage failures */
  }
}

function ensure(scope: string): FloatingPanelRecord[] {
  if (!store.has(scope)) {
    store.set(scope, load(scope));
  }
  return store.get(scope)!;
}

function notify(scope: string) {
  const subs = listeners.get(scope);
  if (!subs) return;
  const snapshot = clone(ensure(scope));
  for (const listener of subs) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error("[floating-panels] listener error", err);
    }
  }
}

export function subscribeFloatingPanels(
  scope: string,
  listener: (panels: FloatingPanelRecord[]) => void
): () => void {
  const current = ensure(scope);
  listener(clone(current));
  const scoped = listeners.get(scope) ?? new Set<Listener>();
  const wrapper: Listener = (panels) => listener(panels);
  scoped.add(wrapper);
  listeners.set(scope, scoped);
  return () => {
    const set = listeners.get(scope);
    if (!set) return;
    set.delete(wrapper);
  };
}

export function spawnFloatingPanel(
  scope: string,
  config: FloatingPanelSpawnConfig
): string {
  const panels = ensure(scope);
  const id = generateId();
  panels.push({
    id,
    editorId: config.editorId,
    title: config.title,
    settings: { ...(config.settings ?? {}) },
    initialPosition: config.initialPosition,
    initialSize: config.initialSize,
    minSize: config.minSize,
  });
  persist(scope);
  notify(scope);
  return id;
}

export function updateFloatingPanel(
  scope: string,
  panelId: string,
  update:
    | Partial<Omit<FloatingPanelRecord, "id" | "editorId">>
    | ((panel: FloatingPanelRecord) => FloatingPanelRecord)
): void {
  const panels = ensure(scope);
  const index = panels.findIndex((panel) => panel.id === panelId);
  if (index === -1) return;
  const current = panels[index];
  const next =
    typeof update === "function" ? update(current) : { ...current, ...update };
  const editorId =
    typeof (next as FloatingPanelRecord).editorId === "string"
      ? (next as FloatingPanelRecord).editorId
      : current.editorId;
  panels[index] = {
    ...current,
    ...next,
    id: current.id,
    editorId,
    settings: { ...current.settings, ...(next.settings ?? {}) },
  };
  persist(scope);
  notify(scope);
}

export function removeFloatingPanel(scope: string, panelId: string): void {
  const panels = ensure(scope);
  const next = panels.filter((panel) => panel.id !== panelId);
  if (next.length === panels.length) return;
  store.set(scope, next);
  persist(scope);
  notify(scope);
}

export function getFloatingPanels(scope: string): FloatingPanelRecord[] {
  return clone(ensure(scope));
}

function generateId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `fp-${Math.random().toString(36).slice(2, 9)}`;
}

export function clearFloatingPanels(scope: string): void {
  store.set(scope, []);
  persist(scope);
  notify(scope);
}
