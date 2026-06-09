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

const store = new Map<string, FloatingPanelRecord[]>();
const listeners = new Map<string, Set<Listener>>();

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

function ensure(scope: string): FloatingPanelRecord[] {
  if (!store.has(scope)) {
    store.set(scope, []);
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
    settings:
      next.settings !== undefined
        ? { ...next.settings }
        : { ...current.settings },
  };
  notify(scope);
}

export function removeFloatingPanel(scope: string, panelId: string): void {
  const panels = ensure(scope);
  const next = panels.filter((panel) => panel.id !== panelId);
  if (next.length === panels.length) return;
  store.set(scope, next);
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
  notify(scope);
}

export function replaceFloatingPanels(
  scope: string,
  panels: FloatingPanelRecord[]
): void {
  store.set(scope, clone(panels));
  notify(scope);
}
