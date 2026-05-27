import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useQueuedPlayheadSeek } from "../../../../../renderer/components/editors/animation-editor/hooks/useQueuedPlayheadSeek";

describe("useQueuedPlayheadSeek", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid seek requests into throttled engine writes and reconnects after idle", async () => {
    vi.useFakeTimers();

    let localScrubTimeSec: number | null = null;
    const setLocalScrubTimeSec = vi.fn((next: number | null | ((current: number | null) => number | null)) => {
      localScrubTimeSec = typeof next === "function" ? next(localScrubTimeSec) : next;
    });
    const setAnimControlConnectionState = vi
      .fn<(...args: unknown[]) => Promise<boolean>>()
      .mockResolvedValue(true);
    const writeAnimControlFieldRaw = vi
      .fn<(...args: unknown[]) => Promise<boolean>>()
      .mockResolvedValue(true);

    const { result } = renderHook(() =>
      useQueuedPlayheadSeek({
        durationSec: 1,
        setAnimControlConnectionState,
        setLocalScrubTimeSec,
        writeAnimControlFieldRaw,
      })
    );

    act(() => {
      result.current.seekPlayheadToTimeSec(0.1);
      result.current.seekPlayheadToTimeSec(0.2);
      result.current.seekPlayheadToTimeSec(0.3);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(setAnimControlConnectionState).toHaveBeenCalledWith("time_override_sec", false);
    expect(writeAnimControlFieldRaw).toHaveBeenCalledTimes(1);
    expect(writeAnimControlFieldRaw).toHaveBeenLastCalledWith("time_override_sec", 0.1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(writeAnimControlFieldRaw).toHaveBeenCalledTimes(2);
    expect(writeAnimControlFieldRaw).toHaveBeenNthCalledWith(2, "time_override_sec", 0.3);

    act(() => {
      result.current.seekPlayheadToTimeSec(0.4);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(49);
    });
    expect(writeAnimControlFieldRaw).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(writeAnimControlFieldRaw).toHaveBeenCalledTimes(3);
    expect(writeAnimControlFieldRaw).toHaveBeenLastCalledWith("time_override_sec", 0.4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90);
    });
    expect(setAnimControlConnectionState).toHaveBeenCalledWith("time_override_sec", true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(setLocalScrubTimeSec).toHaveBeenLastCalledWith(null);
  });
});
