import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTelemetryStore,
} from "../../../../../renderer/data-sources/telemetry/internal/telemetry-store";
import type {
  TelemetryWsListener,
} from "../../../../../renderer/data-sources/telemetry/internal/telemetry-ws-client";

const createTelemetryModel = vi.fn();

const layout = {
  workloads: [],
  types: [],
  engine_session_id: "sid",
  workloads_buffer_size_used: 0,
  process_memory_used: 0,
};

function makeModel() {
  return {
    raw: null,
    schemaSessionId: "",
  } as any;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("telemetry-store websocket", () => {
  let store: ReturnType<typeof createTelemetryStore>;
  let eventTarget: EventTarget;
  let listenersByBaseUrl: Map<string, TelemetryWsListener>;
  let subscribeTelemetryWs: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    createTelemetryModel.mockImplementation(makeModel);
    eventTarget = new EventTarget();
    listenersByBaseUrl = new Map();
    subscribeTelemetryWs = vi.fn((baseUrl: string, listener: TelemetryWsListener) => {
      listenersByBaseUrl.set(baseUrl, listener);
      return () => listenersByBaseUrl.delete(baseUrl);
    });

    store = createTelemetryStore({
      subscribeTelemetryWs,
      createTelemetryModel: (...args) => createTelemetryModel(...args),
      launcherEventTarget: eventTarget,
      layoutEnsureTimeoutMs: 1000,
    });
  });

  afterEach(() => {
    store.reset();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function emitLayout(baseUrl: string, nextLayout = layout) {
    listenersByBaseUrl.get(baseUrl)?.onLayout?.(nextLayout as any);
  }

  function emitFrame(baseUrl: string, sid: string, frameSeq: number | null, bytes = 4) {
    listenersByBaseUrl.get(baseUrl)?.onFrame?.({
      raw: new ArrayBuffer(bytes),
      sid,
      frameSeq,
    });
  }

  it("uses subscriber cadence throttling with websocket frames", async () => {
    const fastCb = vi.fn();
    const slowCb = vi.fn();

    const unsubscribeFast = store.subscribeTelemetry("base", 10, {
      callback: fastCb,
    });
    const unsubscribeSlow = store.subscribeTelemetry("base", 2, {
      callback: slowCb,
    });

    emitLayout("base");
    emitFrame("base", "sid", 2);

    expect(fastCb).toHaveBeenCalledTimes(1);
    expect(slowCb).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    emitFrame("base", "sid", 4);

    expect(fastCb).toHaveBeenCalledTimes(2);
    expect(slowCb).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    emitFrame("base", "sid", 6);

    expect(fastCb).toHaveBeenCalledTimes(3);
    expect(slowCb).toHaveBeenCalledTimes(2);

    unsubscribeFast();
    unsubscribeSlow();
  });

  it("allows near-30Hz frame cadence despite millisecond timer jitter", async () => {
    const callback = vi.fn();

    const unsubscribe = store.subscribeTelemetry("base", 30, {
      callback,
    });

    emitLayout("base");
    emitFrame("base", "sid", 2);

    for (let frameSeq = 4; frameSeq <= 20; frameSeq += 2) {
      await vi.advanceTimersByTimeAsync(32);
      emitFrame("base", "sid", frameSeq);
    }

    expect(callback).toHaveBeenCalledTimes(10);

    unsubscribe();
  });

  it("delivers cached snapshots to late subscribers", async () => {
    const firstCb = vi.fn();
    const secondCb = vi.fn();

    const unsubscribeFirst = store.subscribeTelemetry("base", 10, {
      callback: firstCb,
    });

    emitLayout("base");
    emitFrame("base", "sid", 2);
    expect(firstCb).toHaveBeenCalledTimes(1);

    const unsubscribeSecond = store.subscribeTelemetry("base", 10, {
      callback: secondCb,
    });
    await flushMicrotasks();

    expect(secondCb).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("refreshes model creation when session id changes", async () => {
    const callback = vi.fn();
    const unsubscribe = store.subscribeTelemetry("base", 1000, {
      callback,
    });

    emitLayout("base", { ...layout, engine_session_id: "sid-old" });
    emitFrame("base", "sid-old", 2);
    expect(callback).toHaveBeenCalledTimes(1);

    emitFrame("base", "sid-new", 4);
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    emitLayout("base", { ...layout, engine_session_id: "sid-new" });
    expect(callback).toHaveBeenCalledTimes(2);

    expect(createTelemetryModel).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("can preload layout before first frame", async () => {
    const ensurePromise = store.ensureLayout("base");

    emitLayout("base", { ...layout, engine_session_id: "sid-layout" });
    const ensured = await ensurePromise;

    expect(ensured).not.toBeNull();
    expect(createTelemetryModel).toHaveBeenCalledTimes(1);
    expect(store.getLatestModel("base")).toBe(ensured);
  });

  it("skips odd frame sequence telemetry samples", () => {
    const callback = vi.fn();
    const unsubscribe = store.subscribeTelemetry("base", 10, {
      callback,
    });

    emitLayout("base");
    emitFrame("base", "sid", 3);
    expect(callback).toHaveBeenCalledTimes(0);

    emitFrame("base", "sid", 4);
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
