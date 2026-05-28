import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAnimTelemetryService } from "../../../../../renderer/components/editors/animation-editor/hooks/useAnimTelemetryService";

describe("useAnimTelemetryService", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("discovers the anim service, loads animset metadata, and aggregates clip samples", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/telemetry/services")) {
        return new Response(
          JSON.stringify({
            services: [
              {
                service_id: "anim:actual_anim_workload",
                service_type: "anim",
                display_name: "something_else",
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/telemetry/services/anim:actual_anim_workload/animset")) {
        return new Response(
          JSON.stringify({
            service_id: "anim:actual_anim_workload",
            animset_path: "content/anim/animsets/base.animset.yaml",
            animset_options: ["content/anim/animsets/base.animset.yaml"],
            channelset_path: "content/anim/channelsets/base.channelset.yaml",
            channelset_id: "base_channelset",
            clips: [
              {
                clip_index: 0,
                clip_name: "base_clip",
                animclip_path: "content/anim/clips/base.animclip.yaml",
                channels: ["look_offset_x", "look_offset_y"],
                duration_sec: 1,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/telemetry/services/anim:actual_anim_workload/clip")) {
        return new Response(
          JSON.stringify({
            service_id: "anim:actual_anim_workload",
            clip_identity: {
              clip_name: "base_clip",
              animclip_path: "content/anim/clips/base.animclip.yaml",
            },
            clip_revision: "42",
            duration_sec: 1,
            loop_reset_duration_sec: 0.25,
            sample_count: 3,
            live_sample_rate_hz: 30,
            channels: ["look_offset_x", "look_offset_y"],
            dirty: true,
            can_undo: true,
            can_redo: false,
          }),
          { status: 200 }
        );
      }
      if (url.includes("channel=look_offset_x")) {
        return new Response(new Float32Array([0, 0.5, 1]).buffer, { status: 200 });
      }
      if (url.includes("channel=look_offset_y")) {
        return new Response(new Float32Array([1, 0.5, 0]).buffer, { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const reportAnimLoadStatus = vi.fn();

    const { result } = renderHook(() => {
      const [clipRefs, setClipRefs] = React.useState<Array<{ name: string; animclipPath: string }>>([]);
      const [selectedClipPath, setSelectedClipPath] = React.useState("");
      const [animsetOptionsFromEngine, setAnimsetOptionsFromEngine] = React.useState<string[]>([]);
      const [animsetPath, setAnimsetPath] = React.useState("");
      const [channelsetPath, setChannelsetPath] = React.useState("");
      const [channelsetId, setChannelsetId] = React.useState("");

      const service = useAnimTelemetryService({
        telemetryBaseUrl: "http://telemetry",
        preferredWorkloadName: "stale_model_workload_name",
        selectedClipPath,
        reportAnimLoadStatus,
        setClipRefs,
        setSelectedClipPath,
        setAnimsetOptionsFromEngine,
        setAnimsetPath,
        setChannelsetPath,
        setChannelsetId,
        resetClipData: vi.fn(),
      });

      return {
        ...service,
        clipRefs,
        selectedClipPath,
        animsetOptionsFromEngine,
        animsetPath,
        channelsetPath,
        channelsetId,
      };
    });

    await waitFor(() => expect(result.current.animTelemetryServiceId).toBe("anim:actual_anim_workload"));
    await waitFor(() =>
      expect(result.current.clipRefs).toEqual([
        {
          name: "base_clip",
          animclipPath: "content/anim/clips/base.animclip.yaml",
          durationSec: 1,
          channels: ["look_offset_x", "look_offset_y"],
        },
      ])
    );

    expect(result.current.selectedClipPath).toBe("content/anim/clips/base.animclip.yaml");
    expect(result.current.animsetPath).toBe("content/anim/animsets/base.animset.yaml");
    expect(result.current.channelsetPath).toBe("content/anim/channelsets/base.channelset.yaml");
    expect(result.current.channelsetId).toBe("base_channelset");
    expect(result.current.animsetOptionsFromEngine).toEqual(["content/anim/animsets/base.animset.yaml"]);

    const clipData = await result.current.loadLiveClipData(0, "base_clip");
    expect(clipData).toEqual(
      expect.objectContaining({
        name: "base_clip",
        animclipPath: "content/anim/clips/base.animclip.yaml",
        clipRevision: "42",
        durationSec: 1,
        loopResetDurationSec: 0.25,
        sampleCount: 3,
        liveSampleRateHz: 30,
        dirty: true,
        canUndo: true,
        canRedo: false,
      })
    );
    expect(Array.from(clipData?.channels.look_offset_x ?? [])).toEqual([0, 0.5, 1]);
    expect(Array.from(clipData?.channels.look_offset_y ?? [])).toEqual([1, 0.5, 0]);
  });

  it("reports a warning when no anim service can be discovered", async () => {
    const reportAnimLoadStatus = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ services: [] }), { status: 200 })
    );

    const { result } = renderHook(() => {
      const [clipRefs, setClipRefs] = React.useState<Array<{ name: string; animclipPath: string }>>([]);
      const [selectedClipPath, setSelectedClipPath] = React.useState("");
      const [animsetOptionsFromEngine, setAnimsetOptionsFromEngine] = React.useState<string[]>([]);
      const [animsetPath, setAnimsetPath] = React.useState("");
      const [channelsetPath, setChannelsetPath] = React.useState("");
      const [channelsetId, setChannelsetId] = React.useState("");

      return useAnimTelemetryService({
        telemetryBaseUrl: "http://telemetry",
        preferredWorkloadName: "missing",
        selectedClipPath,
        reportAnimLoadStatus,
        setClipRefs,
        setSelectedClipPath,
        setAnimsetOptionsFromEngine,
        setAnimsetPath,
        setChannelsetPath,
        setChannelsetId,
        resetClipData: vi.fn(),
      });
    });

    await waitFor(() => expect(result.current.animTelemetryServiceId).toBe(""));
    expect(reportAnimLoadStatus).toHaveBeenCalledWith(
      "warning",
      "No anim telemetry service found. Check Terminal logs."
    );
  });
});
