import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPollingTask } from "../../../renderer/utils/polling";

describe("createPollingTask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("invokes the handler immediately and on each interval by default", async () => {
    const handler = vi.fn();
    const task = createPollingTask(handler, { intervalMs: 100 });

    task.start();
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(handler).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(200);
    expect(handler).toHaveBeenCalledTimes(4);

    task.stop();
  });

  it("supports changing intervals without triggering immediate runs when requested", async () => {
    const handler = vi.fn();
    const task = createPollingTask(handler, {
      intervalMs: 50,
      runImmediately: false,
    });

    task.start();
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(handler).toHaveBeenCalledTimes(1);

    task.setIntervalMs(200, { immediate: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("flush runs the handler even when stopped", async () => {
    const handler = vi.fn();
    const task = createPollingTask(handler, { intervalMs: 100 });

    await task.flush();
    expect(handler).toHaveBeenCalledTimes(1);

    task.start();
    task.stop();
    await task.flush();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
