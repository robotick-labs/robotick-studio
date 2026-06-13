/**
 * Internal telemetry websocket store.
 */
import {
  createTelemetryModel,
  fetchTelemetryLayout,
  type ITelemetryModel,
  type LayoutModel,
} from "./telemetry-client";
import {
  subscribeTelemetryWs,
  resetTelemetryWsClients,
  type TelemetryWsFrame,
} from "./telemetry-ws-client";
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

type LayoutWaiter = {
  resolve: (model: ITelemetryModel | null) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type StoreEntry = {
  baseUrl: string;
  subscribers: Set<SubscriberEntry>;
  layout: LayoutModel | null;
  model: ITelemetryModel | null;
  lastRaw: { buffer: ArrayBuffer; timestamp: number; sid: string } | null;
  wsUnsubscribe: (() => void) | null;
  layoutWaiters: Set<LayoutWaiter>;
  ingressTimestampsMs: number[];
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

type TelemetryStoreDeps = {
  subscribeTelemetryWs?: typeof subscribeTelemetryWs;
  createTelemetryModel?: typeof createTelemetryModel;
  launcherEventTarget?: EventTarget;
  layoutEnsureTimeoutMs?: number;
};

export type TelemetryStore = {
  subscribeTelemetry: (
    baseUrl: string,
    samplingRateHz: number,
    subscriber: SubscriberCallbacks
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

const DEFAULT_LAYOUT_ENSURE_TIMEOUT_MS = 3000;
const SUBSCRIBER_CADENCE_TOLERANCE_MS = 8;

/**
 * Create a telemetry websocket store that manages subscriptions, per-base-url socket lifecycle,
 * and delivery of telemetry models to subscribers.
 */
export function createTelemetryStore(
  deps: TelemetryStoreDeps = {}
): TelemetryStore {
  const subscribeTelemetryWsImpl = deps.subscribeTelemetryWs ?? subscribeTelemetryWs;
  const createTelemetryModelImpl =
    deps.createTelemetryModel ?? createTelemetryModel;
  const launcherEventTarget = deps.launcherEventTarget ?? launcherEvents;
  const layoutEnsureTimeoutMs = Math.max(
    200,
    deps.layoutEnsureTimeoutMs ?? DEFAULT_LAYOUT_ENSURE_TIMEOUT_MS,
  );

  const stores = new Map<string, StoreEntry>();
  const microtask =
    typeof queueMicrotask === "function"
      ? queueMicrotask
      : (cb: () => void) => Promise.resolve().then(cb);

  let statusChangeListener: EventListener | null = null;
  let runRequestedListener: EventListener | null = null;
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
        layoutWaiters: new Set(),
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

  function getOrCreateModel(entry: StoreEntry): ITelemetryModel | null {
    if (!entry.layout) {
      return null;
    }
    if (!entry.model) {
      entry.model = createTelemetryModelImpl(entry.layout);
    }
    return entry.model;
  }

  function resolveLayoutWaiters(entry: StoreEntry, model: ITelemetryModel | null) {
    if (entry.layoutWaiters.size === 0) {
      return;
    }

    const waiters = Array.from(entry.layoutWaiters);
    entry.layoutWaiters.clear();
    waiters.forEach((waiter) => {
      clearTimeout(waiter.timeoutId);
      waiter.resolve(model);
    });
  }

  function deliverToSubscriber(
    subscriber: SubscriberEntry,
    model: ITelemetryModel,
    force = false
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

  function updateModelFromFrame(entry: StoreEntry, frame: TelemetryWsFrame) {
    const hasSid = frame.sid.length > 0;
    const nowMs = Date.now();
    // Track raw websocket ingress cadence before any frame-seq filtering so
    // receive-rate metrics reflect everything the engine pushed to Studio.
    entry.ingressTimestampsMs.push(nowMs);
    const keepAfterMs = nowMs - 30_000;
    entry.ingressTimestampsMs = entry.ingressTimestampsMs.filter(
      (ts) => ts >= keepAfterMs
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
    setEntryLayout(entry, layout);
    const model = getOrCreateModel(entry);
    if (!model) {
      resolveLayoutWaiters(entry, null);
      return;
    }

    if (entry.lastRaw) {
      model.raw = entry.lastRaw.buffer;
      if (entry.lastRaw.sid) {
        model.schemaSessionId = entry.lastRaw.sid;
      }
    }

    resolveLayoutWaiters(entry, model);

    if (entry.lastRaw) {
      notifySubscribers(entry, model);
    }
  }

  function ensureWsSubscription(entry: StoreEntry) {
    if (telemetrySuspended || entry.wsUnsubscribe) {
      return;
    }

    entry.wsUnsubscribe = subscribeTelemetryWsImpl(entry.baseUrl, {
      onLayout: (layout) => {
        handleLayoutMessage(entry, layout);
      },
      onFrame: (frame) => {
        updateModelFromFrame(entry, frame);
      },
      onError: (error) => {
        entry.lastErrorAt = new Date().toISOString();
        entry.lastErrorMessage = error instanceof Error ? error.message : String(error);
        entry.subscribers.forEach((sub) => sub.error?.(error));
      },
    });
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
    if (entry.subscribers.size > 0 || entry.layoutWaiters.size > 0) {
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
      } else if (entry.subscribers.size > 0 || entry.layoutWaiters.size > 0) {
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
  const runEventHandler: EventListener = () => {
    setTelemetrySuspended(false);
  };
  const stopEventHandler: EventListener = () => {
    setTelemetrySuspended(true);
  };

  function registerLauncherListeners() {
    if (!launcherEventTarget) return;
    if (!statusChangeListener) {
      statusChangeListener = statusEventHandler;
      launcherEventTarget.addEventListener(
        "status-changed",
        statusChangeListener
      );
    }
    if (!runRequestedListener) {
      runRequestedListener = runEventHandler;
      launcherEventTarget.addEventListener("run-requested", runRequestedListener);
    }
    if (!stopRequestedListener) {
      stopRequestedListener = stopEventHandler;
      launcherEventTarget.addEventListener(
        "stop-requested",
        stopRequestedListener
      );
    }
  }

  function unregisterLauncherListeners() {
    if (!launcherEventTarget) return;
    if (statusChangeListener) {
      launcherEventTarget.removeEventListener(
        "status-changed",
        statusChangeListener
      );
      statusChangeListener = null;
    }
    if (runRequestedListener) {
      launcherEventTarget.removeEventListener(
        "run-requested",
        runRequestedListener
      );
      runRequestedListener = null;
    }
    if (stopRequestedListener) {
      launcherEventTarget.removeEventListener(
        "stop-requested",
        stopRequestedListener
      );
      stopRequestedListener = null;
    }
  }

  registerLauncherListeners();

  function subscribeTelemetry(
    baseUrl: string,
    samplingRateHz = 20,
    subscriber: SubscriberCallbacks
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

  async function ensureLayout(baseUrl: string): Promise<ITelemetryModel | null> {
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

    return new Promise<ITelemetryModel | null>((resolve) => {
      const waiter: LayoutWaiter = {
        resolve: (model) => {
          resolve(model);
          maybeCleanupEntry(entry);
        },
        timeoutId: setTimeout(() => {
          entry.layoutWaiters.delete(waiter);
          resolve(null);
          maybeCleanupEntry(entry);
        }, layoutEnsureTimeoutMs),
      };

      entry.layoutWaiters.add(waiter);
    });
  }

  async function refreshLayout(baseUrl: string): Promise<ITelemetryModel | null> {
    if (!baseUrl) {
      return null;
    }

    const entry = getOrCreateEntry(baseUrl);
    const layout = await fetchTelemetryLayout(baseUrl);
    handleLayoutMessage(entry, layout);
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
      entry.layoutWaiters.forEach((waiter) => {
        clearTimeout(waiter.timeoutId);
        waiter.resolve(null);
      });
      entry.layoutWaiters.clear();
    }
    stores.clear();
    telemetrySuspended = false;
    unregisterLauncherListeners();
    registerLauncherListeners();
    resetTelemetryWsClients();
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

const defaultTelemetryStore = createTelemetryStore();

export const subscribeTelemetry = defaultTelemetryStore.subscribeTelemetry;
export const ensureTelemetryLayout = defaultTelemetryStore.ensureLayout;
export const refreshTelemetryLayout = defaultTelemetryStore.refreshLayout;
export const getLatestTelemetryModel = defaultTelemetryStore.getLatestModel;
export const getTelemetryIngressRateHz = defaultTelemetryStore.getIngressRateHz;
export const getTelemetryDiagnostics = defaultTelemetryStore.getDiagnostics;
export const resetTelemetryStore = () => defaultTelemetryStore.reset();
