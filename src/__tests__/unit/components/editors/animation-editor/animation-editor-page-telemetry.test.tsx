import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import AnimationEditorPage from "../../../../../renderer/components/editors/animation-editor/AnimationEditorPage";

const targetPanelSpy = vi.fn();
const timelineControllerSpy = vi.fn();

vi.mock("../../../../../renderer/components/workspaces/PanelInstanceContext", () => ({
  usePanelInstance: () => ({ panelId: "panel-1", workspaceId: "workspace-1" }),
}));

vi.mock("../../../../../renderer/data-sources/launcher/internal/ProjectContext", () => ({
  useProjectContext: () => ({ projectPath: "/tmp/project.robotick.yaml" }),
}));

vi.mock("../../../../../renderer/data-sources/launcher", () => ({
  ProjectData: {
    use: () => ({ projectModels: { data: [] } }),
  },
  useLauncherService: () => ({
    fetchProjectWorkloadsRegistry: vi.fn(),
  }),
}));

vi.mock("../../../../../renderer/data-sources/telemetry", () => ({
  useTelemetryService: () => ({
    getIngressRateHz: () => 20,
    setWorkloadInputFieldsData: vi.fn().mockResolvedValue({ ok: true }),
    setWorkloadInputConnectionState: vi.fn().mockResolvedValue({ ok: true }),
  }),
  useTelemetryStream: () => ({
    model: {
      schemaSessionId: "schema-1",
      workloads: [{ name: "actual_anim_workload" }],
      getField: vi.fn(),
    },
  }),
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/hooks/useAnimCompatibleSources", () => ({
  useAnimCompatibleSources: () => [
    {
      id: "source-1",
      type: "anim",
      label: "Model A | stale_model_workload_name",
      modelName: "Model A",
      modelPath: "model-a",
      telemetryBaseUrl: "http://telemetry",
      workloadName: "stale_model_workload_name",
    },
  ],
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/hooks/useAnimTelemetryService", () => ({
  useAnimTelemetryService: () => ({
    animTelemetryServiceId: "anim:actual_anim_workload",
    buildAnimServiceUrl: () => "http://telemetry/api/anim",
    loadLiveClipData: vi.fn(),
    performAnimAuthoringAction: vi.fn(),
    performAnimSave: vi.fn(),
    reloadAnimsetClipRefs: vi.fn(),
  }),
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/hooks/useAnimControlFields", () => ({
  useAnimControlFields: () => ({
    heldSuppressedAnimControlFieldsRef: { current: new Set<string>() },
    readFieldValue: (fieldPath: string) => {
      const fields: Record<string, unknown> = {
        "actual_anim_workload.outputs.anim_state.playback_state": 0,
        "actual_anim_workload.outputs.anim_state.playhead_time_sec": 1.25,
        "actual_anim_workload.outputs.anim_state.is_loop_reset_active": false,
        "actual_anim_workload.outputs.anim_state.loop_reset_progress_norm": 0,
        "actual_anim_workload.outputs.anim_state.active_clip_index": 0,
        "actual_anim_workload.inputs.anim_controls.loop": false,
        "actual_anim_workload.inputs.animset_path": "content/anim/animsets/base.animset.yaml",
        "actual_anim_workload.config.channelset_path": "content/anim/channelsets/base.channelset.yaml",
      };
      return fields[fieldPath];
    },
    resolveAnimWritableField: vi.fn(),
    setAnimControlConnectionState: vi.fn().mockResolvedValue(true),
    writeAnimControlField: vi.fn().mockResolvedValue(undefined),
    writeAnimControlFieldRaw: vi.fn().mockResolvedValue(true),
    ensureAnimControlSuppressed: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/hooks/useClipWriteQueue", () => ({
  useClipWriteQueue: () => ({
    drawWriteStateRef: { current: { clipIndex: -1, channel: "", queuedStartSampleIndex: null, queuedEndSampleIndex: null, inFlight: false, timerId: null, acceptedClipRevision: "0" } },
    clearDrawFlushTimer: vi.fn(),
    beginDrawStrokeSession: vi.fn(),
    commitDrawStrokeSession: vi.fn().mockResolvedValue(undefined),
    cancelDrawStrokeSession: vi.fn().mockResolvedValue(undefined),
    queueDrawStrokeRange: vi.fn(),
  }),
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/hooks/useAnimToolSettings", () => ({
  useAnimToolSettings: () => ({
    activeTool: null,
    lineSnapEnd: true,
    lineSnapStart: true,
    rangeFalloffCurve: 1,
    rangeFalloffSec: 0.12,
    rangeSizeSec: 0.45,
    selectedTimeRange: null,
    setActiveTool: vi.fn(),
    setLineSnapEnd: vi.fn(),
    setLineSnapStart: vi.fn(),
    setRangeFalloffSec: vi.fn(),
    setSelectedTimeRange: vi.fn(),
    setSelectedTimeRangeDurationSec: vi.fn(),
    smoothApplyRateHz: 60,
    smoothBrushPreview: null,
    smoothFalloffCurve: 1,
    smoothFalloffSec: 0.18,
    smoothRangeSec: 0.45,
    smoothStrength: 0.65,
    toolSettingsContext: {
      durationSec: 1,
      lineSnapStart: true,
      lineSnapEnd: true,
      setLineSnapStart: vi.fn(),
      setLineSnapEnd: vi.fn(),
      rangeMidpointSec: 0.5,
      rangeMidpointDraft: "0.500",
      setRangeMidpointDraft: vi.fn(),
      setSelectedTimeRangeMidpointSec: vi.fn(),
      rangeSizeSec: 0.45,
      rangeSizeDraft: "0.450",
      setRangeSizeDraft: vi.fn(),
      setSelectedTimeRangeDurationSec: vi.fn(),
      rangeFalloffSec: 0.12,
      rangeFalloffDraft: "0.12",
      setRangeFalloffDraft: vi.fn(),
      setRangeFalloffSec: vi.fn(),
      rangeFalloffCurve: 1,
      rangeFalloffCurveDraft: "1.00",
      setRangeFalloffCurveDraft: vi.fn(),
      setRangeFalloffCurve: vi.fn(),
      warpMode: "time+value",
      setWarpMode: vi.fn(),
      warpTimeStrength: 1,
      warpTimeStrengthDraft: "1.00",
      setWarpTimeStrengthDraft: vi.fn(),
      setWarpTimeStrength: vi.fn(),
      warpValueStrength: 1,
      warpValueStrengthDraft: "1.00",
      setWarpValueStrengthDraft: vi.fn(),
      setWarpValueStrength: vi.fn(),
      warpLockEndpoints: true,
      setWarpLockEndpoints: vi.fn(),
      smoothRangeSec: 0.45,
      smoothRangeDraft: "0.450",
      setSmoothRangeDraft: vi.fn(),
      setSmoothRangeSec: vi.fn(),
      smoothFalloffSec: 0.18,
      smoothFalloffDraft: "0.180",
      setSmoothFalloffDraft: vi.fn(),
      setSmoothFalloffSec: vi.fn(),
      smoothFalloffCurve: 1,
      smoothFalloffCurveDraft: "1.00",
      setSmoothFalloffCurveDraft: vi.fn(),
      setSmoothFalloffCurve: vi.fn(),
      smoothStrength: 0.65,
      smoothStrengthDraft: "0.65",
      setSmoothStrengthDraft: vi.fn(),
      setSmoothStrength: vi.fn(),
      smoothApplyRateHz: 60,
      smoothApplyRateDraft: "60",
      setSmoothApplyRateDraft: vi.fn(),
      setSmoothApplyRateHz: vi.fn(),
      smoothRangeStepSec: 0.01,
      rangeFalloffStepSec: 0.01,
    },
    warpBrushPreview: null,
    warpLockEndpoints: true,
    warpMode: "time+value",
    warpTimeStrength: 1,
    warpValueStrength: 1,
    setSmoothBrushPreview: vi.fn(),
    setWarpBrushPreview: vi.fn(),
    setSmoothFalloffSec: vi.fn(),
    setSmoothRangeSec: vi.fn(),
    setSmoothStrength: vi.fn(),
    rangeFalloffStepSec: 0.01,
    smoothRangeStepSec: 0.01,
  }),
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/hooks/useAnimTimelineController", () => ({
  useAnimTimelineController: (args: { runtimePlayheadSec: number | null }) => {
    timelineControllerSpy(args);
    return {
      applyActiveClipPath: vi.fn(),
      beginDrawStroke: vi.fn(),
      beginPlayheadDragFromClientX: vi.fn(),
      beginRangeOffset: vi.fn(),
      beginRangeSelection: vi.fn(),
      bottomRulerRef: { current: null },
      firstLaneSvgRef: { current: null },
      fitLaneRangeForChannel: vi.fn(),
      handleLaneHoverChange: vi.fn(),
      handleLaneSelect: vi.fn(),
      handleSmoothBrushPreviewChange: vi.fn(),
      handleWarpBrushPreviewChange: vi.fn(),
      hoveredChannel: null,
      laneRange: {},
      localScrubTimeSec: null,
      notePlayheadRendered: vi.fn(),
      playheadOverlayMetrics: {
        width: 1000,
        height: 100,
        topRulerHeight: 24,
        bottomRulerTop: 76,
        bottomRulerHeight: 24,
        topBlobCenterY: 18,
        bottomBlobCenterY: 82,
      },
      playheadRenderHz: 12,
      playheadSec: args.runtimePlayheadSec ?? 0,
      playheadViewportInsetsPx: { left: 77, right: 14 },
      playheadViewportRef: { current: null },
      selectedChannel: null,
      setHoveredChannel: vi.fn(),
      setLaneRangeForChannel: vi.fn(),
      setLocalScrubTimeSec: vi.fn(),
      setSelectedChannel: vi.fn(),
      timelineRef: { current: null },
      timelineViewportRangeNorm: { startNorm: 0, endNorm: 1 },
      topRulerRef: { current: null },
      onViewportRangeNormChange: vi.fn(),
      syncClipChannels: vi.fn(),
    };
  },
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/hooks/useAnimAuthoringActions", () => ({
  useAnimAuthoringActions: () => ({
    handleCommitDurationSec: vi.fn(),
    handleCommitLoopResetDurationSec: vi.fn(),
    handleCreateAnimset: vi.fn(),
    handleCreateClip: vi.fn(),
    handleDeleteAnimset: vi.fn(),
    handleDeleteClip: vi.fn(),
    handleDuplicateAnimset: vi.fn(),
    handleDuplicateClip: vi.fn(),
    handleRenameAnimset: vi.fn(),
    handleRenameClip: vi.fn(),
    handleSave: vi.fn(),
    saveButtonUi: { label: "Save", title: "No unsaved animation changes.", disabled: true, tone: "neutral", showDirtyDot: false },
  }),
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/AnimationTargetPanel", () => ({
  AnimationTargetPanel: (props: { animsetPath: string; channelsetPath: string }) => {
    targetPanelSpy(props);
    return (
      <div data-testid="target-panel">
        {JSON.stringify({
          animsetPath: props.animsetPath,
          channelsetPath: props.channelsetPath,
        })}
      </div>
    );
  },
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/AnimationChannelsPanel", () => ({
  AnimationChannelsPanel: () => <div data-testid="channels-panel" />,
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/AnimationToolBar", () => ({
  AnimationToolBar: () => <div data-testid="toolbar" />,
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/AnimationTimelineViewport", () => ({
  AnimationTimelineViewport: () => <div data-testid="timeline" />,
}));

vi.mock("../../../../../renderer/components/editors/animation-editor/TransportBar", () => ({
  TransportBar: (props: { isPlaying: boolean; loopEnabled: boolean; playheadSec: number }) => (
    <div data-testid="transport-props">
      {JSON.stringify({
        isPlaying: props.isPlaying,
        loopEnabled: props.loopEnabled,
        playheadSec: props.playheadSec,
      })}
    </div>
  ),
}));

describe("AnimationEditorPage telemetry reflection", () => {
  it("reflects transport and playhead state using the discovered anim service workload fallback", () => {
    targetPanelSpy.mockClear();
    timelineControllerSpy.mockClear();
    render(<AnimationEditorPage />);

    expect(screen.getByTestId("transport-props")).toHaveTextContent(
      JSON.stringify({
        isPlaying: false,
        loopEnabled: false,
        playheadSec: 1.25,
      })
    );
    expect(screen.getByTestId("target-panel")).toHaveTextContent(
      JSON.stringify({
        animsetPath: "content/anim/animsets/base.animset.yaml",
        channelsetPath: "content/anim/channelsets/base.channelset.yaml",
      })
    );
    expect(targetPanelSpy).toHaveBeenCalled();
    expect(timelineControllerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        activeClipIndexRaw: 0,
        runtimePlayheadSec: 1.25,
        selectedWorkloadName: "actual_anim_workload",
      })
    );
  });
});
