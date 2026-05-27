import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useClipWriteQueue } from "../../../../../renderer/components/editors/animation-editor/hooks/useClipWriteQueue";

describe("useClipWriteQueue", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("streams draw edits through begin/apply/commit transaction endpoints", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/begin-edit")) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ transaction_id: "edit_1", clip_revision: "7" }),
        } as Response;
      }
      if (url.includes("/apply-preview-delta")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accepted: true }),
        } as Response;
      }
      if (url.includes("/commit-edit")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ clip_revision: "8" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const clipDataRef = {
      current: {
        animclipPath: "content/anim/clip.animclip.yaml",
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
        canUndo: false,
        canRedo: false,
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
    await act(async () => {
      await result.current.commitDrawStrokeSession();
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [beginUrl, beginInit] = fetchMock.mock.calls[0]!;
    expect(String(beginUrl)).toContain("/begin-edit");
    expect(beginInit?.method).toBe("POST");
    expect(JSON.parse(String(beginInit?.body))).toEqual({
      clip_index: 0,
      expected_clip_revision: "7",
    });

    const [applyUrl, applyInit] = fetchMock.mock.calls[1]!;
    expect(String(applyUrl)).toContain("/apply-preview-delta");
    expect(applyInit?.method).toBe("POST");
    const [commitUrl, commitInit] = fetchMock.mock.calls[2]!;
    expect(String(commitUrl)).toContain("/commit-edit");
    expect(commitInit?.method).toBe("POST");
    expect(JSON.parse(String(commitInit?.body))).toEqual({
      transaction_id: "edit_1",
    });

    const body = JSON.parse(String(applyInit?.body));
    expect(body.transaction_id).toBe("edit_1");
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

  it("does not let a new stroke clobber an in-flight commit", async () => {
    vi.useFakeTimers();

    let resolveCommit: (() => void) | null = null;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/begin-edit")) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ transaction_id: "edit_1", clip_revision: "7" }),
        } as Response;
      }
      if (url.includes("/apply-preview-delta")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accepted: true }),
        } as Response;
      }
      if (url.includes("/commit-edit")) {
        await new Promise<void>((resolve) => {
          resolveCommit = resolve;
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({ clip_revision: "8" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const clipDataRef = {
      current: {
        animclipPath: "content/anim/clip.animclip.yaml",
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
        canUndo: false,
        canRedo: false,
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
      expect(result.current.beginDrawStrokeSession(0, "look_offset_x")).toBe(true);
      result.current.queueDrawStrokeRange(0, "look_offset_x", 1, 3);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    let commitPromise: Promise<void> | null = null;
    await act(async () => {
      commitPromise = result.current.commitDrawStrokeSession();
      await Promise.resolve();
    });

    expect(result.current.beginDrawStrokeSession(0, "look_offset_x")).toBe(false);

    await act(async () => {
      resolveCommit?.();
      await commitPromise;
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/commit-edit"))).toBe(true);
    expect(scheduleClipDataRender).toHaveBeenCalledWith(
      expect.objectContaining({
        clipRevision: "8",
        dirty: true,
      })
    );
  });
});
