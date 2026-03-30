/**
 * Internal telemetry polling store.
 */
import {
  createTelemetryModel,
  type ITelemetryModel,
  type LayoutModel,
  fetchLayout,
  fetchRaw,
} from "./telemetry-client";
import {
  launcherEvents,
  type LauncherStatus,
} from "../../launcher/internal/LauncherContext";
import { createPollingTask, type PollingTask } from "../../../utils/polling";

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
  layoutFetchPromise: Promise<LayoutModel | null> | null;
  model: ITelemetryModel | null;
  lastRaw: { buffer: ArrayBuffer; timestamp: number; sid: string } | null;
  lastLayoutFetchSid: string;
  pollingTask: PollingTask | null;
  pollingIntervalMs: number;
};

type TelemetryStoreDeps = {
  fetchLayout?: typeof fetchLayout;
  fetchRaw?: typeof fetchRaw;
  createTelemetryModel?: typeof createTelemetryModel;
  launcherEventTarget?: EventTarget;
  createPollingTask?: typeof createPollingTask;
  maxConcurrentFetches?: number;
};

export type TelemetryStore = {
  subscribeTelemetry: (
    baseUrl: string,
    pollingRateHz: number,
    subscriber: SubscriberCallbacks
  ) => () => void;
  ensureLayout: (baseUrl: string) => Promise<ITelemetryModel | null>;
  getLatestModel: (baseUrl: string) => ITelemetryModel | null;
  reset: () => void;
};

const DEFAULT_POLLING_INTERVAL_MS = 200;
const DEFAULT_MAX_CONCURRENT_FETCHES = 4;

/**
 * Create a telemetry polling store that manages subscriptions, per-base-url polling, and delivery of telemetry models to subscribers.
 *
 * @param deps - Optional overrides for network, model-creation, event target, polling task factory, and max concurrent fetches
 * @returns A TelemetryStore exposing `subscribeTelemetry(baseUrl, pollingRateHz, subscriber)` to subscribe and receive telemetry models and `reset()` to stop and clear the store
 */
export function createTelemetryStore(
  deps: TelemetryStoreDeps = {}
): TelemetryStore {
  const fetchLayoutImpl = deps.fetchLayout ?? fetchLayout;
  const fetchRawImpl = deps.fetchRaw ?? fetchRaw;
  const createTelemetryModelImpl =
    deps.createTelemetryModel ?? createTelemetryModel;
  const launcherEventTarget = deps.launcherEventTarget ?? launcherEvents;
  const createPollingTaskImpl = deps.createPollingTask ?? createPollingTask;
  const maxConcurrentFetches =
    deps.maxConcurrentFetches ?? DEFAULT_MAX_CONCURRENT_FETCHES;

  const stores = new Map<string, StoreEntry>();
  const microtask =
    typeof queueMicrotask === "function"
      ? queueMicrotask
      : (cb: () => void) => Promise.resolve().then(cb);
  let statusChangeListener: EventListener | null = null;
  let runRequestedListener: EventListener | null = null;
  let stopRequestedListener: EventListener | null = null;

  let telemetrySuspended = false;
  let activeFetches = 0;
  const fetchQueue: Array<() => void> = [];

  function enqueueFetch<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        activeFetches++;
        task()
          .then(resolve, reject)
          .finally(() => {
            activeFetches--;
            const next = fetchQueue.shift();
            if (next) {
              next();
            }
          });
      };

      if (activeFetches < maxConcurrentFetches) {
        run();
      } else {
        fetchQueue.push(run);
      }
    });
  }

  function getOrCreateEntry(baseUrl: string): StoreEntry {
    let entry = stores.get(baseUrl);
    if (!entry) {
      entry = {
        baseUrl,
        subscribers: new Set(),
        layout: null,
        layoutFetchPromise: null,
        model: null,
        lastRaw: null,
        lastLayoutFetchSid: "",
        pollingTask: null,
        pollingIntervalMs: DEFAULT_POLLING_INTERVAL_MS,
      };
      stores.set(baseUrl, entry);
    }
    return entry;
  }

  function ensurePollingTask(entry: StoreEntry): PollingTask {
    if (entry.pollingTask) {
      return entry.pollingTask;
    }
    entry.pollingTask = createPollingTaskImpl(() => pollEntry(entry), {
      intervalMs: entry.pollingIntervalMs,
      runImmediately: true,
      onError: (error) => {
        entry.subscribers.forEach((sub) => sub.error?.(error));
      },
    });
    return entry.pollingTask;
  }

  function stopPolling(entry: StoreEntry) {
    if (!entry.pollingTask) {
      return;
    }
    entry.pollingTask.stop();
    entry.pollingTask = null;
  }

  function setEntryLayout(entry: StoreEntry, layout: LayoutModel | null) {
    entry.layout = layout;
    entry.model = null;
    entry.lastLayoutFetchSid = layout?.engine_session_id ?? "";
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

  function fetchAndStoreLayout(entry: StoreEntry): Promise<LayoutModel | null> {
    if (entry.layout) {
      return Promise.resolve(entry.layout);
    }

    if (entry.layoutFetchPromise) {
      return entry.layoutFetchPromise;
    }

    const layoutFetchPromise = enqueueFetch(() => fetchLayoutImpl(entry.baseUrl))
      .then((layout) => {
        if (layout) {
          setEntryLayout(entry, layout);
        }
        return layout;
      })
      .finally(() => {
        if (entry.layoutFetchPromise === layoutFetchPromise) {
          entry.layoutFetchPromise = null;
        }
      });

    entry.layoutFetchPromise = layoutFetchPromise;
    return layoutFetchPromise;
  }

  async function pollEntry(entry: StoreEntry) {
    if (telemetrySuspended) return;
    try {
      if (!entry.layout) {
        const layout = await fetchAndStoreLayout(entry);
        if (layout) {
          setEntryLayout(entry, layout);
        }
      }
      if (!entry.layout) return;

      const previousRaw = entry.lastRaw;
      const { raw, sid, frameSeq } = await enqueueFetch(() =>
        fetchRawImpl(entry.baseUrl)
      );

      if (typeof frameSeq === "number" && (frameSeq & 1) === 1) {
        // Odd frame sequence means engine write in progress; skip this sample.
        return;
      }

      const hasSid = sid.length > 0;
      const previousSid = previousRaw?.sid ?? "";
      const layoutSid = entry.layout.engine_session_id ?? "";
      const sessionChanged =
        (hasSid && previousSid.length > 0 && sid !== previousSid) ||
        (hasSid && layoutSid.length > 0 && sid !== layoutSid);

      if (sessionChanged) {
        if (hasSid && entry.lastLayoutFetchSid === sid) {
          // We already fetched a layout that matches this sid.
          entry.lastRaw = { buffer: raw, timestamp: Date.now(), sid };
          const model = getOrCreateModel(entry);
          if (!model) {
            return;
          }
          model.raw = raw;
          notifySubscribers(entry, model);
          return;
        }

        const refreshedLayout = await enqueueFetch(() =>
          fetchLayoutImpl(entry.baseUrl)
        );
        if (refreshedLayout && hasSid && refreshedLayout.engine_session_id === sid) {
          setEntryLayout(entry, refreshedLayout);
        } else {
          // Avoid decoding a new session with a stale schema.
          setEntryLayout(entry, null);
          entry.lastRaw = { buffer: raw, timestamp: Date.now(), sid };
          return;
        }
      }

      entry.lastRaw = { buffer: raw, timestamp: Date.now(), sid };
      const model = getOrCreateModel(entry);
      if (!model) return;
      if (hasSid) {
        model.schemaSessionId = sid;
      }
      model.raw = raw;
      notifySubscribers(entry, model);
    } catch (err) {
      entry.subscribers.forEach((sub) => sub.error?.(err));
    }
  }

  function updatePollingTimer(entry: StoreEntry) {
    if (entry.subscribers.size === 0) {
      stopPolling(entry);
      entry.pollingIntervalMs = DEFAULT_POLLING_INTERVAL_MS;
      return;
    }

    const fastestInterval = Math.min(
      ...Array.from(entry.subscribers, (sub) => sub.intervalMs)
    );

    if (entry.pollingIntervalMs !== fastestInterval) {
      entry.pollingIntervalMs = fastestInterval;
      if (entry.pollingTask) {
        entry.pollingTask.setIntervalMs(fastestInterval, { immediate: true });
      }
    }
    const task = ensurePollingTask(entry);
    if (!telemetrySuspended && !task.isRunning()) {
      task.start({ immediate: true });
    }
  }

  function setTelemetrySuspended(next: boolean) {
    if (telemetrySuspended === next) return;
    telemetrySuspended = next;
    for (const entry of stores.values()) {
      if (telemetrySuspended) {
        stopPolling(entry);
      } else {
        updatePollingTimer(entry);
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

  function notifySubscribers(entry: StoreEntry, model: ITelemetryModel) {
    entry.subscribers.forEach((sub) => {
      deliverToSubscriber(sub, model);
    });
  }

  function deliverToSubscriber(
    subscriber: SubscriberEntry,
    model: ITelemetryModel,
    force = false
  ) {
    const now = Date.now();
    if (
      force ||
      subscriber.lastNotified === 0 ||
      now - subscriber.lastNotified >= subscriber.intervalMs
    ) {
      subscriber.lastNotified = now;
      subscriber.callback(model);
    }
  }

  function subscribeTelemetry(
    baseUrl: string,
    pollingRateHz = 20,
    subscriber: SubscriberCallbacks
  ): () => void {
    const entry = getOrCreateEntry(baseUrl);
    const safeRate = Math.max(1, pollingRateHz);
    const intervalMs = Math.max(1, Math.floor(1000 / safeRate));
    const subscriberEntry: SubscriberEntry = {
      ...subscriber,
      intervalMs,
      lastNotified: 0,
    };
    entry.subscribers.add(subscriberEntry);
    updatePollingTimer(entry);

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
      updatePollingTimer(current);
      if (
        current.subscribers.size === 0 &&
        !current.layout &&
        !current.layoutFetchPromise &&
        !current.lastRaw
      ) {
        stores.delete(baseUrl);
      }
    };
  }

  async function ensureLayout(baseUrl: string): Promise<ITelemetryModel | null> {
    if (!baseUrl) {
      return null;
    }

    const entry = getOrCreateEntry(baseUrl);
    const layout = await fetchAndStoreLayout(entry);
    if (!layout) {
      return null;
    }

    return getLatestModel(baseUrl);
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

  function reset() {
    for (const entry of stores.values()) {
      stopPolling(entry);
    }
    stores.clear();
    telemetrySuspended = false;
    activeFetches = 0;
    fetchQueue.length = 0;
  }

  return {
    subscribeTelemetry,
    ensureLayout,
    getLatestModel,
    reset,
  };
}

const defaultTelemetryStore = createTelemetryStore();

export const subscribeTelemetry = defaultTelemetryStore.subscribeTelemetry;
export const ensureTelemetryLayout = defaultTelemetryStore.ensureLayout;
export const getLatestTelemetryModel = defaultTelemetryStore.getLatestModel;
export const resetTelemetryStore = () => defaultTelemetryStore.reset();
