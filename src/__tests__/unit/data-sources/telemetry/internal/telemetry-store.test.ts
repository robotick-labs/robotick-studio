import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subscribeTelemetry } from "../../../../../renderer/data-sources/telemetry/internal/telemetry-store";

const fetchLayout = vi.fn();
const fetchRaw = vi.fn();
const createTelemetryModel = vi.fn();

vi.mock("../../../../../renderer/data-sources/telemetry/internal/telemetry-client", () => ({
  fetchLayout: (...args: any[]) => fetchLayout(...args),
  fetchRaw: (...args: any[]) => fetchRaw(...args),
  createTelemetryModel: (...args: any[]) => createTelemetryModel(...args),
}));

const layout = {
  workloads: [],
  types: [],
  engine_session_id: "test",
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
  beforeEach(() => {
    vi.useFakeTimers();
    fetchLayout.mockResolvedValue(layout);
    fetchRaw.mockResolvedValue({
      raw: new ArrayBuffer(0),
      sid: "sid",
    });
    createTelemetryModel.mockImplementation(makeModel);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses the fastest subscriber interval and adjusts when subscribers change", async () => {
    const fastCb = vi.fn();
    const slowCb = vi.fn();

    const unsubscribeFast = subscribeTelemetry("base", 10, {
      callback: fastCb,
    });
    await flushMicrotasks();
    expect(fetchRaw).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchRaw).toHaveBeenCalledTimes(2);

    const unsubscribeSlow = subscribeTelemetry("base", 2, {
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

    const unsubscribeFirst = subscribeTelemetry("base", 5, {
      callback: firstCb,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    expect(firstCb).toHaveBeenCalled();
    const unsubscribeSecond = subscribeTelemetry("base", 5, {
      callback: secondCb,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    expect(secondCb).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeSecond();
    await flushMicrotasks();
  });
});
