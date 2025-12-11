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

/**
 * Produce a shallow copy of an array of panel records with each record's `settings` object duplicated.
 *
 * @param records - The array of FloatingPanelRecord objects to clone
 * @returns A new array where each record is a shallow copy and its `settings` object is a shallow copy
 */
function clone(records: FloatingPanelRecord[]): FloatingPanelRecord[] {
  return records.map((record) => ({
    ...record,
    settings: { ...record.settings },
  }));
}

/**
 * Load and normalize floating panel records for a given scope from persistent storage.
 *
 * Normalizes each stored item into a valid FloatingPanelRecord: ensures a non-empty `id`
 * (generating one if missing), coerces `editorId` to a string and filters out items with
 * an empty `editorId`, copies `settings`, and only includes `initialPosition`, `initialSize`,
 * and `minSize` when numeric, finite, and (for sizes) greater than zero.
 *
 * @param scope - The storage scope key used to read panel data
 * @returns An array of normalized `FloatingPanelRecord` objects for the scope; returns an empty array if no valid data exists or on parse/read errors
 */
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

/**
 * Persist the floating-panel records for a given scope to storage.
 *
 * Writes the current in-memory records for `scope` to the storage key formed by
 * prefixing `scope` with `STORAGE_PREFIX` as JSON. Storage write failures are
 * silently ignored.
 *
 * @param scope - Scope identifier used as the suffix for the storage key
 */
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

/**
 * Apply updates to an existing floating panel in the given scope.
 *
 * Updates the panel identified by `panelId` by either merging the provided partial fields or using the returned panel from the update function. If the panel does not exist, no action is taken. Updated settings are merged with the existing settings; the panel `id` is always preserved. Changes are persisted and subscribers for the scope are notified.
 *
 * @param scope - The storage scope for the panel collection
 * @param panelId - The identifier of the panel to update
 * @param update - Either a partial set of panel fields to merge (may include `editorId`) or a function that receives the current panel and returns the updated panel
 */
export function updateFloatingPanel(
  scope: string,
  panelId: string,
  update:
    | Partial<Omit<FloatingPanelRecord, "id">>
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

/**
 * Get the current floating panel records for the given scope.
 *
 * @param scope - Identifier for the per-scope panel store
 * @returns A snapshot array of floating panel records for `scope`
 */
export function getFloatingPanels(scope: string): FloatingPanelRecord[] {
  return clone(ensure(scope));
}

/**
 * Generates a unique identifier for a floating panel.
 *
 * @returns A unique identifier string; if the environment provides a UUID generator, a UUID is returned, otherwise a short random id prefixed with `fp-`.
 */
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