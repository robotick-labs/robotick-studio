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
  lastRaw: { buffer: ArrayBuffer; timestamp: number; sid: string } | null;
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
  reset: () => void;
};

const DEFAULT_POLLING_INTERVAL_MS = 200;
const DEFAULT_MAX_CONCURRENT_FETCHES = 4;

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
        lastRaw: null,
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

  function startPolling(entry: StoreEntry) {
    if (telemetrySuspended) return;
    const task = ensurePollingTask(entry);
    task.start({ immediate: true });
  }

  function stopPolling(entry: StoreEntry) {
    entry.pollingTask?.stop();
  }

  async function pollEntry(entry: StoreEntry) {
    if (telemetrySuspended) return;
    try {
      if (!entry.layout) {
        const layout = await enqueueFetch(() => fetchLayoutImpl(entry.baseUrl));
        if (layout) {
          entry.layout = layout;
        }
      }
      if (!entry.layout) return;

      const { raw, sid } = await enqueueFetch(() =>
        fetchRawImpl(entry.baseUrl)
      );
      entry.lastRaw = { buffer: raw, timestamp: Date.now(), sid };
      const model = createTelemetryModelImpl(entry.layout);
      model.raw = raw;
      notifySubscribers(entry, model);
    } catch (err) {
      entry.subscribers.forEach((sub) => sub.error?.(err));
    }
  }

  function updatePollingTimer(entry: StoreEntry) {
    if (entry.subscribers.size === 0) {
      stopPolling(entry);
      entry.pollingTask = null;
      entry.pollingIntervalMs = DEFAULT_POLLING_INTERVAL_MS;
      return;
    }

    const fastestInterval = Math.min(
      ...Array.from(entry.subscribers, (sub) => sub.intervalMs)
    );

    if (entry.pollingTask && entry.pollingIntervalMs === fastestInterval) {
      return;
    }

    entry.pollingIntervalMs = fastestInterval;
    const task = ensurePollingTask(entry);
    task.setIntervalMs(fastestInterval, { immediate: true });
    if (!telemetrySuspended) {
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

  const statusListener = (event: Event) => {
    const detail = (event as CustomEvent<{ status: LauncherStatus }>).detail;
    handleLauncherStatus(detail?.status);
  };

  launcherEventTarget?.addEventListener?.(
    "status-changed",
    statusListener as EventListener
  );
  launcherEventTarget?.addEventListener?.("run-requested", () => {
    setTelemetrySuspended(false);
  });
  launcherEventTarget?.addEventListener?.("stop-requested", () => {
    setTelemetrySuspended(true);
  });

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
        const model = createTelemetryModelImpl(entry.layout as LayoutModel);
        model.raw = entry.lastRaw?.buffer ?? null;
        deliverToSubscriber(subscriberEntry, model, true);
      });
    }

    return () => {
      const current = stores.get(baseUrl);
      if (!current) return;
      current.subscribers.delete(subscriberEntry);
      updatePollingTimer(current);
      if (current.subscribers.size === 0) {
        stores.delete(baseUrl);
      }
    };
  }

  function reset() {
    for (const entry of stores.values()) {
      entry.pollingTask?.stop();
    }
    stores.clear();
    telemetrySuspended = false;
    activeFetches = 0;
    fetchQueue.length = 0;
  }

  return {
    subscribeTelemetry,
    reset,
  };
}

const defaultTelemetryStore = createTelemetryStore();

export const subscribeTelemetry = defaultTelemetryStore.subscribeTelemetry;
export const resetTelemetryStore = () => defaultTelemetryStore.reset();
