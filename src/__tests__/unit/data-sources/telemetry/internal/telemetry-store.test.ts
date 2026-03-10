import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTelemetryStore } from "../../../../../renderer/data-sources/telemetry/internal/telemetry-store";

const fetchLayout = vi.fn();
const fetchRaw = vi.fn();
const createTelemetryModel = vi.fn();

vi.mock(
  "../../../../../renderer/data-sources/telemetry/internal/telemetry-client",
  () => ({
    fetchLayout: (...args: any[]) => fetchLayout(...args),
    fetchRaw: (...args: any[]) => fetchRaw(...args),
    createTelemetryModel: (...args: any[]) => createTelemetryModel(...args),
  })
);

const layout = {
  workloads: [],
  types: [],
  engine_session_id: "sid",
  workloads_buffer_size_used: 0,
  process_memory_used: 0,
};

function makeModel() {
  return { raw: null } as any;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("telemetry-store polling", () => {
  let store: ReturnType<typeof createTelemetryStore>;
  let eventTarget: EventTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchLayout.mockResolvedValue(layout);
    fetchRaw.mockResolvedValue({
      raw: new ArrayBuffer(0),
      sid: "sid",
      frameSeq: null,
    });
    createTelemetryModel.mockImplementation(makeModel);
    eventTarget = new EventTarget();
    store = createTelemetryStore({
      fetchLayout: (...args) => fetchLayout(...args),
      fetchRaw: (...args) => fetchRaw(...args),
      createTelemetryModel: (...args) => createTelemetryModel(...args),
      launcherEventTarget: eventTarget,
    });
  });

  afterEach(() => {
    store.reset();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses the fastest subscriber interval and adjusts when subscribers change", async () => {
    const fastCb = vi.fn();
    const slowCb = vi.fn();

    const unsubscribeFast = store.subscribeTelemetry("base", 10, {
      callback: fastCb,
    });
    await flushMicrotasks();
    expect(fetchRaw).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchRaw).toHaveBeenCalledTimes(2);

    const unsubscribeSlow = store.subscribeTelemetry("base", 2, {
      callback: slowCb,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchRaw).toHaveBeenCalledTimes(3);

    unsubscribeFast();
    await flushMicrotasks();
    expect(fetchRaw).toHaveBeenCalledTimes(4); // restart poll immediately

    await vi.advanceTimersByTimeAsync(400);
    expect(fetchRaw).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchRaw).toHaveBeenCalledTimes(5);

    unsubscribeSlow();
    await flushMicrotasks();
  });

  it("delivers cached snapshots to late subscribers", async () => {
    const firstCb = vi.fn();
    const secondCb = vi.fn();

    const unsubscribeFirst = store.subscribeTelemetry("base", 5, {
      callback: firstCb,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    expect(firstCb).toHaveBeenCalled();
    const unsubscribeSecond = store.subscribeTelemetry("base", 5, {
      callback: secondCb,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    expect(secondCb).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeSecond();
    await flushMicrotasks();
  });

  it("refreshes layout when telemetry session id changes", async () => {
    const layoutV1 = { ...layout, engine_session_id: "sid-old" };
    const layoutV2 = { ...layout, engine_session_id: "sid-new" };
    fetchLayout
      .mockResolvedValueOnce(layoutV1)
      .mockResolvedValueOnce(layoutV2);
    fetchRaw
      .mockResolvedValueOnce({
        raw: new ArrayBuffer(0),
        sid: "sid-old",
        frameSeq: null,
      })
      .mockResolvedValueOnce({
        raw: new ArrayBuffer(0),
        sid: "sid-new",
        frameSeq: null,
      });

    const callback = vi.fn();
    const unsubscribe = store.subscribeTelemetry("base", 10, {
      callback,
    });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();

    expect(fetchLayout).toHaveBeenCalledTimes(2);
    expect(createTelemetryModel).toHaveBeenNthCalledWith(1, layoutV1);
    expect(createTelemetryModel).toHaveBeenNthCalledWith(2, layoutV2);
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();
    await flushMicrotasks();
  });

  it("reuses the telemetry model across steady-state samples", async () => {
    const firstRaw = new ArrayBuffer(4);
    const secondRaw = new ArrayBuffer(8);
    fetchRaw
      .mockResolvedValueOnce({
        raw: firstRaw,
        sid: "sid",
        frameSeq: null,
      })
      .mockResolvedValueOnce({
        raw: secondRaw,
        sid: "sid",
        frameSeq: null,
      });

    const callback = vi.fn();
    const unsubscribe = store.subscribeTelemetry("base", 10, {
      callback,
    });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();

    expect(createTelemetryModel).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[0]?.[0]).toBe(callback.mock.calls[1]?.[0]);
    expect(callback.mock.calls[0]?.[0]?.raw).toBe(secondRaw);

    unsubscribe();
    await flushMicrotasks();
  });

  it("skips odd frame sequence telemetry samples", async () => {
    fetchRaw
      .mockResolvedValueOnce({
        raw: new ArrayBuffer(0),
        sid: "sid",
        frameSeq: 3,
      })
      .mockResolvedValueOnce({
        raw: new ArrayBuffer(0),
        sid: "sid",
        frameSeq: 4,
      });

    const callback = vi.fn();
    const unsubscribe = store.subscribeTelemetry("base", 10, {
      callback,
    });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    await flushMicrotasks();
  });
});
