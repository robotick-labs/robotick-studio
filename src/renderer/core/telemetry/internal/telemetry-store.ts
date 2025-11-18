/**
 * Internal: shared polling store that fans out raw telemetry updates to any
 * subscriber. Consumers should call `subscribeTelemetry` via
 * `core/telemetry/index.ts` instead of importing this file directly.
 */
import {
  createTelemetryModel,
  ITelemetryModel,
  LayoutModel,
  fetchLayout,
  fetchRaw,
} from "./telemetry-client";

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
  pollingTimer: ReturnType<typeof setInterval> | null;
  pollingIntervalMs: number;
};

const stores = new Map<string, StoreEntry>();
const DEFAULT_POLLING_INTERVAL_MS = 200;
const MAX_CONCURRENT_FETCHES = 4;

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

    if (activeFetches < MAX_CONCURRENT_FETCHES) {
      run();
    } else {
      fetchQueue.push(run);
    }
  });
}

export function subscribeTelemetry(
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
    const model = createTelemetryModel(entry.layout);
    model.raw = entry.lastRaw.buffer;
    deliverToSubscriber(subscriberEntry, model, true);
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

function getOrCreateEntry(baseUrl: string): StoreEntry {
  let entry = stores.get(baseUrl);
  if (!entry) {
    entry = {
      baseUrl,
      subscribers: new Set(),
      layout: null,
      lastRaw: null,
      pollingTimer: null,
      pollingIntervalMs: DEFAULT_POLLING_INTERVAL_MS,
    };
    stores.set(baseUrl, entry);
  }
  return entry;
}

function startPolling(entry: StoreEntry) {
  if (entry.pollingTimer) return;
  const poll = () => {
    void pollEntry(entry);
  };

  poll();
  entry.pollingTimer = setInterval(poll, entry.pollingIntervalMs);
}

function stopPolling(entry: StoreEntry) {
  if (entry.pollingTimer) {
    clearInterval(entry.pollingTimer);
  }
  entry.pollingTimer = null;
}

async function pollEntry(entry: StoreEntry) {
  try {
    if (!entry.layout) {
      const layout = await enqueueFetch(() => fetchLayout(entry.baseUrl));
      if (layout) {
        entry.layout = layout;
      }
    }
    if (!entry.layout) return;

    const { raw, sid } = await enqueueFetch(() => fetchRaw(entry.baseUrl));
    entry.lastRaw = { buffer: raw, timestamp: Date.now(), sid };
    const model = createTelemetryModel(entry.layout);
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

  if (entry.pollingTimer && entry.pollingIntervalMs === fastestInterval) {
    return;
  }

  entry.pollingIntervalMs = fastestInterval;
  stopPolling(entry);
  startPolling(entry);
}

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
