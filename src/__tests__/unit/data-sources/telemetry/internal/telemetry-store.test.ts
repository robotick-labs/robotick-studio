import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTelemetryStore,
} from "../../../../../renderer/data-sources/telemetry/internal/telemetry-store";

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

describe("telemetry-store Electron bridge", () => {
  let store: ReturnType<typeof createTelemetryStore>;
  let eventTarget: EventTarget;
  let listenersByBaseUrl: Map<string, (event: any) => void>;
  let electronTelemetryBridge: NonNullable<Window["robotick"]>["telemetry"];

  beforeEach(() => {
    vi.useFakeTimers();
    createTelemetryModel.mockImplementation(makeModel);
    eventTarget = new EventTarget();
    listenersByBaseUrl = new Map();
    electronTelemetryBridge = {
      ensureLayout: vi.fn(async () => ({
        layout,
        latestRaw: null,
      })),
      refreshLayout: vi.fn(async () => ({
        layout,
        latestRaw: null,
      })),
      getDiagnostics: vi.fn(),
      setWorkloadInputFieldsData: vi.fn(),
      setWorkloadInputConnectionState: vi.fn(),
      subscribe: vi.fn((baseUrl: string, listener: (event: any) => void) => {
      listenersByBaseUrl.set(baseUrl, listener);
      return () => listenersByBaseUrl.delete(baseUrl);
      }),
    };

    store = createTelemetryStore({
      createTelemetryModel: (...args) => createTelemetryModel(...args),
      electronTelemetryBridge,
      launcherEventTarget: eventTarget,
    });
  });

  afterEach(() => {
    store.reset();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function emitLayout(baseUrl: string, nextLayout = layout) {
    listenersByBaseUrl.get(baseUrl)?.({
      type: "layout",
      payload: {
        layout: nextLayout,
        latestRaw: null,
      },
    });
  }

  function emitFrame(baseUrl: string, sid: string, frameSeq: number | null, bytes = 4) {
    listenersByBaseUrl.get(baseUrl)?.({
      type: "frame",
      payload: {
        raw: new ArrayBuffer(bytes),
        sid,
        frameSeq,
        timestamp: Date.now(),
      },
    });
  }

  it("uses subscriber cadence throttling with Electron bridge frames", async () => {
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
    electronTelemetryBridge.ensureLayout = vi.fn(async () => ({
      layout: { ...layout, engine_session_id: "sid-layout" },
      latestRaw: null,
    }));

    const ensured = await store.ensureLayout("base");

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

  it("reports telemetry diagnostics including subscriber count, last frame, and last error", async () => {
    const callback = vi.fn();
    const error = vi.fn();
    const unsubscribe = store.subscribeTelemetry("base", 10, {
      callback,
      error,
    });

    emitLayout("base");
    emitFrame("base", "sid", 2);
    listenersByBaseUrl.get("base")?.({
      type: "error",
      message: "socket broke",
    });

    const diagnostics = store.getDiagnostics("base");

    expect(diagnostics).toMatchObject({
      subscriberCount: 1,
      layoutLoaded: true,
      lastErrorMessage: "socket broke",
    });
    expect(diagnostics.lastFrameAt).toEqual(expect.any(String));
    expect(error).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("clears stale renderer frames on stop and reconnects on restart requests", () => {
    const callback = vi.fn();
    const unsubscribe = store.subscribeTelemetry("base", 10, {
      callback,
    });

    emitLayout("base", { ...layout, engine_session_id: "sid-old" });
    emitFrame("base", "sid-old", 2);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(store.getDiagnostics("base").lastFrameAt).toEqual(
      expect.any(String)
    );

    eventTarget.dispatchEvent(new Event("stop-requested"));

    expect(listenersByBaseUrl.has("base")).toBe(false);
    expect(store.getDiagnostics("base")).toMatchObject({
      subscriberCount: 1,
      layoutLoaded: false,
      lastFrameAt: null,
      lastErrorMessage: null,
    });
    expect(store.getLatestModel("base")).toBeNull();

    eventTarget.dispatchEvent(new Event("restart-requested"));

    expect(listenersByBaseUrl.has("base")).toBe(true);
    emitLayout("base", { ...layout, engine_session_id: "sid-new" });
    emitFrame("base", "sid-new", 2);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(store.getDiagnostics("base").lastFrameAt).toEqual(
      expect.any(String)
    );

    unsubscribe();
  });

  it("clears telemetry diagnostics errors after recovered websocket data", () => {
    const callback = vi.fn();
    const unsubscribe = store.subscribeTelemetry("base", 10, {
      callback,
    });

    listenersByBaseUrl.get("base")?.({
      type: "error",
      message: "socket broke",
    });
    expect(store.getDiagnostics("base").lastErrorMessage).toBe("socket broke");

    emitLayout("base");
    expect(store.getDiagnostics("base").lastErrorMessage).toBeNull();

    listenersByBaseUrl.get("base")?.({
      type: "error",
      message: "socket broke again",
    });
    expect(store.getDiagnostics("base").lastErrorMessage).toBe("socket broke again");

    emitFrame("base", "sid", 2);
    expect(store.getDiagnostics("base").lastErrorMessage).toBeNull();

    unsubscribe();
  });
  it("uses the Electron telemetry bridge instead of opening a renderer websocket", async () => {
    createTelemetryModel.mockImplementation(makeModel);
    const callbacks: Array<(event: any) => void> = [];
    const unsubscribe = vi.fn();
    const isolatedElectronTelemetryBridge = {
      ensureLayout: vi.fn(async () => ({
        layout,
        latestRaw: {
          raw: new ArrayBuffer(8),
          sid: "sid",
          frameSeq: 2,
          timestamp: 1000,
        },
      })),
      refreshLayout: vi.fn(),
      getDiagnostics: vi.fn(),
      setWorkloadInputFieldsData: vi.fn(),
      setWorkloadInputConnectionState: vi.fn(),
      subscribe: vi.fn((_baseUrl: string, callback: (event: any) => void) => {
        callbacks.push(callback);
        return unsubscribe;
      }),
    };
    const store = createTelemetryStore({
      createTelemetryModel: (...args) => createTelemetryModel(...args),
      electronTelemetryBridge: isolatedElectronTelemetryBridge,
      launcherEventTarget: new EventTarget(),
    });

    try {
      const callback = vi.fn();
      const stop = store.subscribeTelemetry("base", 20, { callback });
      const ensured = await store.ensureLayout("base");

      expect(ensured).not.toBeNull();
      expect(isolatedElectronTelemetryBridge.subscribe).toHaveBeenCalledWith(
        "base",
        expect.any(Function),
      );
      expect(isolatedElectronTelemetryBridge.ensureLayout).toHaveBeenCalledWith("base");

      callbacks[0]?.({
        type: "frame",
        payload: {
          raw: new ArrayBuffer(8),
          sid: "sid",
          frameSeq: 4,
          timestamp: 1100,
        },
      });

      expect(callback).toHaveBeenCalledTimes(1);
      stop();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      store.reset();
    }
  });
});
