import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSelectedClipLoader } from "../../../../../renderer/components/editors/animation-editor/hooks/useSelectedClipLoader";

function makeClipData(animclipPath: string, dirty = false) {
  return {
    animclipPath,
    name: "clip",
    channels: {},
    durationSec: 1,
    loopResetDurationSec: 1,
    sampleCount: 0,
    liveSampleRateHz: 30,
    clipRevision: "7",
    dirty,
  };
}

describe("useSelectedClipLoader", () => {
  it("does not let a stale background clip load overwrite dirty local edits for the same clip", async () => {
    let resolveLoad: ((value: ReturnType<typeof makeClipData>) => void) | null = null;
    const loadLiveClipData = vi.fn(
      () =>
        new Promise<ReturnType<typeof makeClipData>>((resolve) => {
          resolveLoad = resolve;
        })
    );
    const applyLoadedClipData = vi.fn();
    const clipDataRef = { current: makeClipData("content/anim/clip_a.animclip.yaml", false) };

    renderHook(() =>
      useSelectedClipLoader({
        animTelemetryServiceId: "anim:workload",
        clipDataRef,
        clipRefs: [{ name: "clip_a", animclipPath: "content/anim/clip_a.animclip.yaml" }],
        loadLiveClipData,
        applyLoadedClipData,
        reportAnimLoadStatus: vi.fn(),
        selectedClipPath: "content/anim/clip_a.animclip.yaml",
      })
    );

    clipDataRef.current = makeClipData("content/anim/clip_a.animclip.yaml", true);

    await act(async () => {
      resolveLoad?.(makeClipData("content/anim/clip_a.animclip.yaml", false));
      await Promise.resolve();
    });

    expect(applyLoadedClipData).not.toHaveBeenCalled();
  });

  it("still applies a requested clip load when switching to a different clip", async () => {
    const loadLiveClipData = vi.fn(async (_clipIndex: number, clipName?: string) =>
      makeClipData(clipName === "clip_b" ? "content/anim/clip_b.animclip.yaml" : "content/anim/clip_a.animclip.yaml", false)
    );
    const applyLoadedClipData = vi.fn();
    const clipDataRef = { current: makeClipData("content/anim/clip_a.animclip.yaml", true) };
    const reportAnimLoadStatus = vi.fn();

    const { rerender } = renderHook(
      ({ selectedClipPath }) =>
        useSelectedClipLoader({
          animTelemetryServiceId: "anim:workload",
          clipDataRef,
          clipRefs: [
            { name: "clip_a", animclipPath: "content/anim/clip_a.animclip.yaml" },
            { name: "clip_b", animclipPath: "content/anim/clip_b.animclip.yaml" },
          ],
          loadLiveClipData,
          applyLoadedClipData,
          reportAnimLoadStatus,
          selectedClipPath,
        }),
      {
        initialProps: { selectedClipPath: "content/anim/clip_a.animclip.yaml" },
      }
    );

    await act(async () => {
      rerender({ selectedClipPath: "content/anim/clip_b.animclip.yaml" });
      await Promise.resolve();
    });

    expect(applyLoadedClipData).toHaveBeenCalledWith(
      expect.objectContaining({
        animclipPath: "content/anim/clip_b.animclip.yaml",
      })
    );
  });
});
