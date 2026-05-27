import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useClipWriteQueue } from "../../../../../renderer/components/editors/animation-editor/hooks/useClipWriteQueue";

describe("useClipWriteQueue", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("submits draw edits through the generic clip-edit contract", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ clip_revision: "8" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const clipDataRef = {
      current: {
        name: "clip",
        channels: {
          look_offset_x: new Float32Array([0, 0.1, 0.2, 0.3, 0.4]),
        },
        durationSec: 1,
        loopResetDurationSec: 1,
        sampleCount: 5,
        liveSampleRateHz: 30,
        clipRevision: "7",
        dirty: false,
      },
    };
    const scheduleClipDataRender = vi.fn();

    const { result } = renderHook(() =>
      useClipWriteQueue({
        clipDataRef,
        clipRefs: [{ name: "clip", animclipPath: "content/anim/clip.animclip.yaml" }],
        loadLiveClipData: vi.fn().mockResolvedValue(null),
        buildAnimServiceUrl: (suffix = "", params) =>
          `http://telemetry${suffix}?clip_index=${params?.clip_index ?? ""}`,
        scheduleClipDataRender,
      })
    );

    act(() => {
      result.current.beginDrawStrokeSession(0, "look_offset_x");
      result.current.queueDrawStrokeRange(0, "look_offset_x", 1, 3);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/clip-edit");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.operation).toBe("replace_sample_range");
    expect(body.expected_clip_revision).toBe("7");
    expect(body.target).toEqual({
      start_sample_index: 1,
      end_sample_index: 3,
    });
    expect(body.parameters.channel_values[0]?.channel).toBe("look_offset_x");
    expect(body.parameters.channel_values[0]?.values).toHaveLength(3);
    expect(body.parameters.channel_values[0]?.values[0]).toBeCloseTo(0.1);
    expect(body.parameters.channel_values[0]?.values[1]).toBeCloseTo(0.2);
    expect(body.parameters.channel_values[0]?.values[2]).toBeCloseTo(0.3);
    expect(body).toMatchObject({
      operation: "replace_sample_range",
      expected_clip_revision: "7",
      target: {
        start_sample_index: 1,
        end_sample_index: 3,
      },
    });
    expect(scheduleClipDataRender).toHaveBeenCalledWith(
      expect.objectContaining({
        clipRevision: "8",
        dirty: true,
      })
    );
  });
});
