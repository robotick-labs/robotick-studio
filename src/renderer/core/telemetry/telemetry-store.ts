import {
  createTelemetryModel,
  LayoutModel,
  ITelemetryModel,
} from "./telemetry-client";

type Subscriber = {
  callback: (model: ITelemetryModel) => void;
  error?: (err: unknown) => void;
};

type StoreEntry = {
  baseUrl: string;
  subscribers: Set<Subscriber>;
  layout: LayoutModel | null;
  lastRaw: { buffer: ArrayBuffer; timestamp: number; sid: string } | null;
  pollingTimer: ReturnType<typeof setInterval> | null;
  pollingIntervalMs: number;
};

const stores = new Map<string, StoreEntry>();

export function subscribeTelemetry(
  baseUrl: string,
  intervalMs: number,
  subscriber: Subscriber
): () => void {
  const entry = getOrCreateEntry(baseUrl);
  entry.subscribers.add(subscriber);
  entry.pollingIntervalMs = Math.min(entry.pollingIntervalMs, intervalMs);
  if (!entry.pollingTimer) {
    startPolling(entry);
  }

  if (entry.layout && entry.lastRaw) {
    const model = createTelemetryModel(entry.layout);
    model.raw = entry.lastRaw.buffer;
    subscriber.callback(model);
  }

  return () => {
    const current = stores.get(baseUrl);
    if (!current) return;
    current.subscribers.delete(subscriber);
    if (current.subscribers.size === 0) {
      stopPolling(current);
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
      pollingIntervalMs: 200,
    };
    stores.set(baseUrl, entry);
  }
  return entry;
}

function startPolling(entry: StoreEntry) {
  const poll = async () => {
    try {
      if (!entry.layout) {
        const layout = await fetchLayout(entry.baseUrl);
        if (layout) {
          entry.layout = layout;
        }
      }
      if (!entry.layout) return;

      const { raw, sid } = await fetchRaw(entry.baseUrl);
      entry.lastRaw = { buffer: raw, timestamp: Date.now(), sid };
      const model = createTelemetryModel(entry.layout);
      model.raw = raw;
      entry.subscribers.forEach((sub) => sub.callback(model));
    } catch (err) {
      entry.subscribers.forEach((sub) => sub.error?.(err));
    }
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

async function fetchLayout(baseUrl: string): Promise<LayoutModel | null> {
  try {
    const response = await fetch(
      `${baseUrl}/api/telemetry/workloads_buffer/layout`,
      {
        cache: "no-store",
      }
    );
    if (!response.ok) return null;
    return (await response.json()) as LayoutModel;
  } catch (err) {
    console.warn("[telemetry-store] fetchLayout failed", err);
    return null;
  }
}

async function fetchRaw(
  baseUrl: string
): Promise<{ raw: ArrayBuffer; sid: string }> {
  try {
    const response = await fetch(
      `${baseUrl}/api/telemetry/workloads_buffer/raw`,
      {
        cache: "no-store",
      }
    );
    if (!response.ok) {
      throw new Error(`telemetry raw request failed: ${response.status}`);
    }
    const raw = await response.arrayBuffer();
    const sid = response.headers.get("x-robotick-session-id") || "";
    return { raw, sid };
  } catch (err) {
    console.warn("[telemetry-store] fetchRaw failed", err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}
