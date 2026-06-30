/**
 * Internal telemetry websocket store.
 */
import {
  createTelemetryModel,
  type ITelemetryModel,
  type LayoutModel,
} from "./telemetry-client";
import {
  launcherEvents,
  type LauncherStatus,
} from "../../launcher/internal/LauncherContext";

type SubscriberCallbacks = {
  callback: (model: ITelemetryModel) => void;
  error?: (err: unknown) => void;
};

type SubscriberEntry = SubscriberCallbacks & {
  intervalMs: number;
  lastNotified: number;
};

type StoreEntry = {
  baseUrl: string;
  subscribers: Set<SubscriberEntry>;
  layout: LayoutModel | null;
  model: ITelemetryModel | null;
  lastRaw: { buffer: ArrayBuffer; timestamp: number; sid: string } | null;
  wsUnsubscribe: (() => void) | null;
  ingressTimestampsMs: number[];
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

type LauncherModelEventDetail = {
  modelId?: string;
  telemetryBaseUrl?: string;
};

type ElectronTelemetryBridge = NonNullable<Window["robotick"]>["telemetry"];

type TelemetryStoreDeps = {
  createTelemetryModel?: typeof createTelemetryModel;
  electronTelemetryBridge?: ElectronTelemetryBridge | null;
  launcherEventTarget?: EventTarget;
};

export type TelemetryStore = {
  subscribeTelemetry: (
    baseUrl: string,
    samplingRateHz: number,
    subscriber: SubscriberCallbacks,
  ) => () => void;
  ensureLayout: (baseUrl: string) => Promise<ITelemetryModel | null>;
  refreshLayout: (baseUrl: string) => Promise<ITelemetryModel | null>;
  getLatestModel: (baseUrl: string) => ITelemetryModel | null;
  getIngressRateHz: (baseUrl: string, windowMs?: number) => number;
  getDiagnostics: (baseUrl: string) => {
    subscriberCount: number;
    layoutLoaded: boolean;
    lastFrameAt: string | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
  };
  reset: () => void;
};

const SUBSCRIBER_CADENCE_TOLERANCE_MS = 8;

/**
 * Create a telemetry websocket store that manages subscriptions, per-base-url socket lifecycle,
 * and delivery of telemetry models to subscribers.
 */
export function createTelemetryStore(
  deps: TelemetryStoreDeps = {},
): TelemetryStore {
  const createTelemetryModelImpl =
    deps.createTelemetryModel ?? createTelemetryModel;
  const maybeElectronTelemetryBridge =
    deps.electronTelemetryBridge ??
    (typeof window !== "undefined" ? window.robotick?.telemetry : null);
  if (!maybeElectronTelemetryBridge) {
    throw new Error("Electron telemetry bridge is required.");
  }
  const electronTelemetryBridge = maybeElectronTelemetryBridge;
  const launcherEventTarget = deps.launcherEventTarget ?? launcherEvents;
  const stores = new Map<string, StoreEntry>();
  const microtask =
    typeof queueMicrotask === "function"
      ? queueMicrotask
      : (cb: () => void) => Promise.resolve().then(cb);

  let statusChangeListener: EventListener | null = null;
  let runRequestedListener: EventListener | null = null;
  let restartRequestedListener: EventListener | null = null;
  let stopRequestedListener: EventListener | null = null;
  let telemetrySuspended = false;

  function getOrCreateEntry(baseUrl: string): StoreEntry {
    let entry = stores.get(baseUrl);
    if (!entry) {
      entry = {
        baseUrl,
        subscribers: new Set(),
        layout: null,
        model: null,
        lastRaw: null,
        wsUnsubscribe: null,
        ingressTimestampsMs: [],
        lastErrorAt: null,
        lastErrorMessage: null,
      };
      stores.set(baseUrl, entry);
    }
    return entry;
  }

  function setEntryLayout(entry: StoreEntry, layout: LayoutModel | null) {
    entry.layout = layout;
    entry.model = null;
  }

  function clearEntryRuntimeState(entry: StoreEntry) {
    setEntryLayout(entry, null);
    entry.lastRaw = null;
    entry.ingressTimestampsMs = [];
    entry.lastErrorAt = null;
    entry.lastErrorMessage = null;
    entry.subscribers.forEach((subscriber) => {
      subscriber.lastNotified = 0;
    });
  }

  function clearRuntimeStateForAllEntries() {
    for (const entry of stores.values()) {
      clearEntryRuntimeState(entry);
    }
  }

  function findEntryForLauncherEvent(event: Event): StoreEntry | null {
    const detail = (event as CustomEvent<LauncherModelEventDetail>).detail;
    const baseUrl = detail?.telemetryBaseUrl?.trim();
    if (!baseUrl) {
      return null;
    }
    return stores.get(baseUrl) ?? null;
  }

  function isModelScopedLauncherEvent(event: Event): boolean {
    const detail = (event as CustomEvent<LauncherModelEventDetail>).detail;
    return Boolean(detail?.modelId || detail?.telemetryBaseUrl);
  }

  function clearRuntimeStateForLauncherEvent(
    event: Event,
  ): "scoped" | "global" {
    if (!isModelScopedLauncherEvent(event)) {
      clearRuntimeStateForAllEntries();
      return "global";
    }
    const entry = findEntryForLauncherEvent(event);
    if (entry) {
      clearEntryRuntimeState(entry);
    }
    return "scoped";
  }

  function getOrCreateModel(entry: StoreEntry): ITelemetryModel | null {
    if (!entry.layout) {
      return null;
    }
    if (!entry.model) {
      entry.model = createTelemetryModelImpl(entry.layout);
    }
    return entry.model;
  }

  function deliverToSubscriber(
    subscriber: SubscriberEntry,
    model: ITelemetryModel,
    force = false,
  ) {
    const now = Date.now();
    const toleranceMs = Math.min(
      SUBSCRIBER_CADENCE_TOLERANCE_MS,
      subscriber.intervalMs * 0.1,
    );
    if (
      force ||
      subscriber.lastNotified === 0 ||
      now - subscriber.lastNotified + toleranceMs >= subscriber.intervalMs
    ) {
      subscriber.lastNotified = now;
      subscriber.callback(model);
    }
  }

  function notifySubscribers(entry: StoreEntry, model: ITelemetryModel) {
    entry.subscribers.forEach((sub) => {
      deliverToSubscriber(sub, model);
    });
  }

  function updateModelFromFrame(
    entry: StoreEntry,
    frame: { raw: ArrayBuffer; sid: string; frameSeq: number | null },
  ) {
    const hasSid = frame.sid.length > 0;
    const nowMs = Date.now();
    entry.lastErrorAt = null;
    entry.lastErrorMessage = null;
    // Track raw websocket ingress cadence before any frame-seq filtering so
    // receive-rate metrics reflect everything the engine pushed to Studio.
    entry.ingressTimestampsMs.push(nowMs);
    const keepAfterMs = nowMs - 30_000;
    entry.ingressTimestampsMs = entry.ingressTimestampsMs.filter(
      (ts) => ts >= keepAfterMs,
    );

    if (typeof frame.frameSeq === "number" && (frame.frameSeq & 1) === 1) {
      return;
    }

    entry.lastRaw = {
      buffer: frame.raw,
      timestamp: Date.now(),
      sid: frame.sid,
    };

    if (!entry.layout) {
      return;
    }

    const layoutSid = entry.layout.engine_session_id ?? "";
    if (hasSid && layoutSid.length > 0 && frame.sid !== layoutSid) {
      setEntryLayout(entry, null);
      return;
    }

    const model = getOrCreateModel(entry);
    if (!model) {
      return;
    }

    model.raw = frame.raw;
    if (hasSid) {
      model.schemaSessionId = frame.sid;
    }
    notifySubscribers(entry, model);
  }

  function handleLayoutMessage(entry: StoreEntry, layout: LayoutModel) {
    entry.lastErrorAt = null;
    entry.lastErrorMessage = null;
    setEntryLayout(entry, layout);
    const model = getOrCreateModel(entry);
    if (!model) {
      return;
    }

    if (entry.lastRaw) {
      model.raw = entry.lastRaw.buffer;
      if (entry.lastRaw.sid) {
        model.schemaSessionId = entry.lastRaw.sid;
      }
    }

    if (entry.lastRaw) {
      notifySubscribers(entry, model);
    }
  }

  function normalizeRawFramePayload(
    payload: unknown,
  ): {
    raw: ArrayBuffer;
    sid: string;
    frameSeq: number | null;
    timestamp: number;
  } | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const candidate = payload as {
      raw?: unknown;
      sid?: unknown;
      frameSeq?: unknown;
      timestamp?: unknown;
    };
    let raw: ArrayBuffer | null = null;
    if (candidate.raw instanceof ArrayBuffer) {
      raw = candidate.raw;
    } else if (ArrayBuffer.isView(candidate.raw)) {
      raw = new Uint8Array(
        candidate.raw.buffer,
        candidate.raw.byteOffset,
        candidate.raw.byteLength,
      ).slice().buffer;
    }
    if (!raw) {
      return null;
    }
    return {
      raw,
      sid: typeof candidate.sid === "string" ? candidate.sid : "",
      frameSeq:
        typeof candidate.frameSeq === "number" &&
        Number.isFinite(candidate.frameSeq)
          ? candidate.frameSeq
          : null,
      timestamp:
        typeof candidate.timestamp === "number" &&
        Number.isFinite(candidate.timestamp)
          ? candidate.timestamp
          : Date.now(),
    };
  }

  function normalizeLayoutFramePayload(
    payload: unknown,
  ): {
    layout: LayoutModel;
    latestRaw: ReturnType<typeof normalizeRawFramePayload>;
  } | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const candidate = payload as { layout?: unknown; latestRaw?: unknown };
    const layout = candidate.layout as LayoutModel | undefined;
    if (
      !layout ||
      !Array.isArray(layout.types) ||
      !Array.isArray(layout.workloads)
    ) {
      return null;
    }
    return {
      layout,
      latestRaw: normalizeRawFramePayload(candidate.latestRaw),
    };
  }

  function applyElectronLayoutFrame(entry: StoreEntry, payload: unknown) {
    const frame = normalizeLayoutFramePayload(payload);
    if (!frame) {
      return;
    }
    if (frame.latestRaw) {
      entry.lastRaw = {
        buffer: frame.latestRaw.raw,
        timestamp: frame.latestRaw.timestamp,
        sid: frame.latestRaw.sid,
      };
    }
    handleLayoutMessage(entry, frame.layout);
  }

  function applyElectronRawFrame(entry: StoreEntry, payload: unknown) {
    const frame = normalizeRawFramePayload(payload);
    if (!frame) {
      return;
    }
    updateModelFromFrame(entry, {
      raw: frame.raw,
      sid: frame.sid,
      frameSeq: frame.frameSeq,
    });
  }

  function ensureWsSubscription(entry: StoreEntry) {
    if (telemetrySuspended || entry.wsUnsubscribe) {
      return;
    }

    entry.wsUnsubscribe = electronTelemetryBridge.subscribe(
      entry.baseUrl,
      (event) => {
        if (event.type === "layout") {
          applyElectronLayoutFrame(entry, event.payload);
          return;
        }
        if (event.type === "frame") {
          applyElectronRawFrame(entry, event.payload);
          return;
        }
        entry.lastErrorAt = new Date().toISOString();
        entry.lastErrorMessage = event.message;
        entry.subscribers.forEach((sub) =>
          sub.error?.(new Error(event.message)),
        );
      },
    );
  }

  function teardownWsSubscription(entry: StoreEntry) {
    if (!entry.wsUnsubscribe) {
      return;
    }
    const unsubscribe = entry.wsUnsubscribe;
    entry.wsUnsubscribe = null;
    unsubscribe();
  }

  function maybeCleanupEntry(entry: StoreEntry) {
    if (entry.subscribers.size > 0) {
      return;
    }

    teardownWsSubscription(entry);
    if (!entry.layout && !entry.lastRaw) {
      stores.delete(entry.baseUrl);
    }
  }

  function setTelemetrySuspended(next: boolean) {
    if (telemetrySuspended === next) return;
    telemetrySuspended = next;

    for (const entry of stores.values()) {
      if (telemetrySuspended) {
        teardownWsSubscription(entry);
      } else if (entry.subscribers.size > 0) {
        ensureWsSubscription(entry);
      }
    }
  }

  function reconnectActiveSubscriptions() {
    for (const entry of stores.values()) {
      if (entry.subscribers.size === 0) {
        continue;
      }
      teardownWsSubscription(entry);
      if (!telemetrySuspended) {
        ensureWsSubscription(entry);
      }
    }
  }

  function handleLauncherStatus(status: LauncherStatus | undefined | null) {
    if (!status) return;
    setTelemetrySuspended(status !== "running");
  }

  const statusEventHandler: EventListener = (event) => {
    const detail = (event as CustomEvent<{ status: LauncherStatus }>).detail;
    handleLauncherStatus(detail?.status);
  };
  const runEventHandler: EventListener = (event) => {
    const scope = clearRuntimeStateForLauncherEvent(event);
    setTelemetrySuspended(false);
    if (scope === "global") {
      reconnectActiveSubscriptions();
      return;
    }
    const entry = findEntryForLauncherEvent(event);
    if (entry) {
      teardownWsSubscription(entry);
      if (entry.subscribers.size > 0) {
        ensureWsSubscription(entry);
      }
    }
  };
  const restartEventHandler: EventListener = (event) => {
    const scope = clearRuntimeStateForLauncherEvent(event);
    setTelemetrySuspended(false);
    if (scope === "global") {
      reconnectActiveSubscriptions();
      return;
    }
    const entry = findEntryForLauncherEvent(event);
    if (entry) {
      teardownWsSubscription(entry);
      if (entry.subscribers.size > 0) {
        ensureWsSubscription(entry);
      }
    }
  };
  const stopEventHandler: EventListener = (event) => {
    const scope = clearRuntimeStateForLauncherEvent(event);
    if (scope === "global") {
      setTelemetrySuspended(true);
      return;
    }
    const entry = findEntryForLauncherEvent(event);
    if (entry) {
      teardownWsSubscription(entry);
    }
  };

  function registerLauncherListeners() {
    if (!launcherEventTarget) return;
    if (!statusChangeListener) {
      statusChangeListener = statusEventHandler;
      launcherEventTarget.addEventListener(
        "status-changed",
        statusChangeListener,
      );
    }
    if (!runRequestedListener) {
      runRequestedListener = runEventHandler;
      launcherEventTarget.addEventListener(
        "run-requested",
        runRequestedListener,
      );
    }
    if (!restartRequestedListener) {
      restartRequestedListener = restartEventHandler;
      launcherEventTarget.addEventListener(
        "restart-requested",
        restartRequestedListener,
      );
    }
    if (!stopRequestedListener) {
      stopRequestedListener = stopEventHandler;
      launcherEventTarget.addEventListener(
        "stop-requested",
        stopRequestedListener,
      );
    }
  }

  function unregisterLauncherListeners() {
    if (!launcherEventTarget) return;
    if (statusChangeListener) {
      launcherEventTarget.removeEventListener(
        "status-changed",
        statusChangeListener,
      );
      statusChangeListener = null;
    }
    if (runRequestedListener) {
      launcherEventTarget.removeEventListener(
        "run-requested",
        runRequestedListener,
      );
      runRequestedListener = null;
    }
    if (restartRequestedListener) {
      launcherEventTarget.removeEventListener(
        "restart-requested",
        restartRequestedListener,
      );
      restartRequestedListener = null;
    }
    if (stopRequestedListener) {
      launcherEventTarget.removeEventListener(
        "stop-requested",
        stopRequestedListener,
      );
      stopRequestedListener = null;
    }
  }

  registerLauncherListeners();

  function subscribeTelemetry(
    baseUrl: string,
    samplingRateHz = 20,
    subscriber: SubscriberCallbacks,
  ): () => void {
    const entry = getOrCreateEntry(baseUrl);
    const safeRate = Math.max(1, samplingRateHz);
    const intervalMs = Math.max(1, Math.floor(1000 / safeRate));
    const subscriberEntry: SubscriberEntry = {
      ...subscriber,
      intervalMs,
      lastNotified: 0,
    };

    entry.subscribers.add(subscriberEntry);
    ensureWsSubscription(entry);

    if (entry.layout && entry.lastRaw) {
      microtask(() => {
        const current = stores.get(baseUrl);
        if (!current || !current.subscribers.has(subscriberEntry)) {
          return;
        }
        try {
          const model = getOrCreateModel(current);
          if (!model) {
            return;
          }
          model.raw = current.lastRaw?.buffer ?? null;
          if (current.lastRaw?.sid) {
            model.schemaSessionId = current.lastRaw.sid;
          }
          deliverToSubscriber(subscriberEntry, model, true);
        } catch (error) {
          subscriber.error?.(error);
        }
      });
    }

    return () => {
      const current = stores.get(baseUrl);
      if (!current) return;
      current.subscribers.delete(subscriberEntry);
      maybeCleanupEntry(current);
    };
  }

  async function ensureLayout(
    baseUrl: string,
  ): Promise<ITelemetryModel | null> {
    if (!baseUrl) {
      return null;
    }

    const entry = getOrCreateEntry(baseUrl);
    const existingModel = getOrCreateModel(entry);
    if (existingModel) {
      if (entry.lastRaw) {
        existingModel.raw = entry.lastRaw.buffer;
        if (entry.lastRaw.sid) {
          existingModel.schemaSessionId = entry.lastRaw.sid;
        }
      }
      return existingModel;
    }

    ensureWsSubscription(entry);

    try {
      const payload = await electronTelemetryBridge.ensureLayout(baseUrl);
      applyElectronLayoutFrame(entry, payload);
      return getOrCreateModel(entry);
    } catch (error) {
      entry.lastErrorAt = new Date().toISOString();
      entry.lastErrorMessage =
        error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  async function refreshLayout(
    baseUrl: string,
  ): Promise<ITelemetryModel | null> {
    if (!baseUrl) {
      return null;
    }

    const entry = getOrCreateEntry(baseUrl);
    const payload = await electronTelemetryBridge.refreshLayout(baseUrl);
    applyElectronLayoutFrame(entry, payload);
    return getOrCreateModel(entry);
  }

  function getLatestModel(baseUrl: string): ITelemetryModel | null {
    const entry = stores.get(baseUrl);
    if (!entry) {
      return null;
    }

    const model = getOrCreateModel(entry);
    if (!model) {
      return null;
    }

    if (entry.lastRaw) {
      model.raw = entry.lastRaw.buffer;
      if (entry.lastRaw.sid) {
        model.schemaSessionId = entry.lastRaw.sid;
      }
    }

    return model;
  }

  function getIngressRateHz(baseUrl: string, windowMs = 4000): number {
    const entry = stores.get(baseUrl);
    if (!entry || entry.ingressTimestampsMs.length < 2) {
      return 0;
    }
    const nowMs = Date.now();
    const minMs = nowMs - Math.max(250, windowMs);
    const active = entry.ingressTimestampsMs.filter((ts) => ts >= minMs);
    if (active.length < 2) {
      return 0;
    }
    const spanMs = Math.max(1, active[active.length - 1] - active[0]);
    return ((active.length - 1) * 1000) / spanMs;
  }

  function getDiagnostics(baseUrl: string) {
    const entry = stores.get(baseUrl);
    return {
      subscriberCount: entry?.subscribers.size ?? 0,
      layoutLoaded: entry?.layout !== null && entry?.layout !== undefined,
      lastFrameAt: entry?.lastRaw
        ? new Date(entry.lastRaw.timestamp).toISOString()
        : null,
      lastErrorAt: entry?.lastErrorAt ?? null,
      lastErrorMessage: entry?.lastErrorMessage ?? null,
    };
  }

  function reset() {
    for (const entry of stores.values()) {
      teardownWsSubscription(entry);
    }
    stores.clear();
    telemetrySuspended = false;
    unregisterLauncherListeners();
    registerLauncherListeners();
  }

  return {
    subscribeTelemetry,
    ensureLayout,
    refreshLayout,
    getLatestModel,
    getIngressRateHz,
    getDiagnostics,
    reset,
  };
}

let defaultTelemetryStore: TelemetryStore | null = null;

function getDefaultTelemetryStore(): TelemetryStore {
  if (!defaultTelemetryStore) {
    defaultTelemetryStore = createTelemetryStore();
  }
  return defaultTelemetryStore;
}

export const subscribeTelemetry: TelemetryStore["subscribeTelemetry"] = (
  baseUrl,
  samplingRateHz,
  subscriber,
) =>
  getDefaultTelemetryStore().subscribeTelemetry(
    baseUrl,
    samplingRateHz,
    subscriber,
  );

export const ensureTelemetryLayout: TelemetryStore["ensureLayout"] = (
  baseUrl,
) => getDefaultTelemetryStore().ensureLayout(baseUrl);

export const refreshTelemetryLayout: TelemetryStore["refreshLayout"] = (
  baseUrl,
) => getDefaultTelemetryStore().refreshLayout(baseUrl);

export const getLatestTelemetryModel: TelemetryStore["getLatestModel"] = (
  baseUrl,
) => getDefaultTelemetryStore().getLatestModel(baseUrl);

export const getTelemetryIngressRateHz: TelemetryStore["getIngressRateHz"] = (
  baseUrl,
  windowMs,
) => getDefaultTelemetryStore().getIngressRateHz(baseUrl, windowMs);

export const getTelemetryDiagnostics: TelemetryStore["getDiagnostics"] = (
  baseUrl,
) => getDefaultTelemetryStore().getDiagnostics(baseUrl);

export const resetTelemetryStore = () => {
  defaultTelemetryStore?.reset();
  defaultTelemetryStore = null;
};
