import React from "react";
import { ProjectData, useLauncherService } from "../../../data-sources/launcher";
import { useTelemetryService, useTelemetryStream } from "../../../data-sources/telemetry";
import { usePanelInstance } from "../../workspaces/PanelInstanceContext";
import { createPanelInstanceId, buildNamespacedKey } from "../../../services/storage";
import { useProjectContext } from "../../../data-sources/launcher/internal/ProjectContext";
import {
  applySampleDeltaToBuffer,
  applyOffsetToSampleRangeWithFalloff,
  applySmoothBrushToSamples,
  buildInterpolatedDrawDelta,
  sampleIndexFromTime,
  sampleIndexRangeFromTimes,
} from "./anim-sample-editing";
import { AnimationTimelineViewport } from "./AnimationTimelineViewport";
import { AnimationToolBar } from "./AnimationToolBar";
import { AnimationChannelsPanel } from "./AnimationChannelsPanel";
import { AnimationTargetPanel } from "./AnimationTargetPanel";
import { TransportBar } from "./TransportBar";
import {
  DEFAULT_EMPTY_CLIP_DURATION_SEC,
  selectTelemetryWorkload,
  type AnimLoadStatusLevel,
  type ClipData,
  type ClipRef,
} from "./anim-editor-shared";
import { defaultLaneRangeForChannel, normalizeTimeRange } from "./anim-editor-lane-utils";
import { listAnimationTools } from "./tools/registry";
import { useClipWriteQueue } from "./hooks/useClipWriteQueue";
import {
  resolveInitialPersistedAnimEditorState,
  useAnimEditorPersistence,
} from "./hooks/useAnimEditorPersistence";
import { useAnimAuthoringActions } from "./hooks/useAnimAuthoringActions";
import { useAnimCompatibleSources } from "./hooks/useAnimCompatibleSources";
import { useAnimControlFields } from "./hooks/useAnimControlFields";
import { useAnimTelemetryService } from "./hooks/useAnimTelemetryService";
import { useAnimTimelineController } from "./hooks/useAnimTimelineController";
import { useAnimToolSettings } from "./hooks/useAnimToolSettings";
import { useQueuedPlayheadSeek } from "./hooks/useQueuedPlayheadSeek";
import { isAnimPlaybackActive } from "./playback-state";
import styles from "./AnimationEditorPage.module.css";
const DEFAULT_ANIMSET = "content/anim/animsets/barr_e_expression_mvp.animset.yaml";
const DEFAULT_CHANNELSET = "content/anim/channelsets/barr_e_expression_mvp.channelset.yaml";
const ANIM_EDITOR_STORAGE_BASE_KEY = "robotick-studio.anim-editor.state.v1";
const RANGE_FALLOFF_FRACTION_STEP = 0.05;
const ANIM_TELEMETRY_SAMPLE_RATE_HZ = 20;
const CADENCE_WINDOW_MS = 4000;

export default function AnimationEditorPage() {
  const panelInstance = usePanelInstance();
  const fallbackPanelIdRef = React.useRef<string | undefined>(undefined);
  if (!fallbackPanelIdRef.current) {
    fallbackPanelIdRef.current = createPanelInstanceId();
  }
  const panelInstanceId = panelInstance.panelId ?? fallbackPanelIdRef.current;
  const workspaceIdentifier = panelInstance.workspaceId ?? "workspace";
  const panelStorageKey = React.useMemo(
    () => buildNamespacedKey(ANIM_EDITOR_STORAGE_BASE_KEY, workspaceIdentifier, panelInstanceId),
    [panelInstanceId, workspaceIdentifier]
  );
  const initialPersistedState = React.useMemo(
    () => resolveInitialPersistedAnimEditorState(panelStorageKey, ANIM_EDITOR_STORAGE_BASE_KEY),
    [panelStorageKey]
  );
  const launcherService = useLauncherService();
  const telemetryService = useTelemetryService();
  const { projectPath } = useProjectContext();
  const { projectModels } = ProjectData.use();
  const [isPlaying, setIsPlaying] = React.useState(true);
  const [loopEnabled, setLoopEnabled] = React.useState(true);
  const [selectedSourceId, setSelectedSourceId] = React.useState(() => initialPersistedState?.selectedSourceId ?? "");
  const [animsetPath, setAnimsetPath] = React.useState(DEFAULT_ANIMSET);
  const [animsetOptionsFromEngine, setAnimsetOptionsFromEngine] = React.useState<string[]>([]);
  const [channelsetPath, setChannelsetPath] = React.useState(DEFAULT_CHANNELSET);
  const [channelsetId, setChannelsetId] = React.useState("barr_e_expression_mvp");
  const [animLoadStatus, setAnimLoadStatus] = React.useState<{ level: AnimLoadStatusLevel; message: string }>({
    level: "ok",
    message: "OK",
  });
  const [clipRefs, setClipRefs] = React.useState<ClipRef[]>([]);
  const [selectedClipPath, setSelectedClipPath] = React.useState(
    () => initialPersistedState?.selectedClipPath ?? ""
  );
  const [clipData, setClipData] = React.useState<ClipData>({
    name: "clip",
    channels: {},
    durationSec: DEFAULT_EMPTY_CLIP_DURATION_SEC,
    loopResetDurationSec: 1,
    sampleCount: 0,
    liveSampleRateHz: 0,
    clipRevision: "0",
    dirty: false,
  });
  const clipDataRef = React.useRef(clipData);
  const animationTools = React.useMemo(() => listAnimationTools(), []);
  const [channelVisible, setChannelVisible] = React.useState<Record<string, boolean>>(
    () => initialPersistedState?.channelVisible ?? {}
  );
  const [channelColor, setChannelColor] = React.useState<Record<string, string>>(
    () => initialPersistedState?.channelColor ?? {}
  );
  const [recordArmByChannel, setRecordArmByChannel] = React.useState<Record<string, boolean>>(
    () => initialPersistedState?.channelRecordArm ?? {}
  );
  const pendingClipDataRenderRef = React.useRef<ClipData | null>(null);
  const pendingClipDataRafRef = React.useRef<number | null>(null);
  const syncClipChannelsRef = React.useRef<(nextClipData: ClipData) => void>(() => {});
  React.useEffect(() => {
    clipDataRef.current = clipData;
  }, [clipData]);

  const reportAnimLoadStatus = React.useCallback((level: AnimLoadStatusLevel, message: string) => {
    const rank: Record<AnimLoadStatusLevel, number> = { ok: 0, warning: 1, error: 2 };
    setAnimLoadStatus((prev) => (rank[level] >= rank[prev.level] ? { level, message } : prev));
  }, []);

  const flushPendingClipDataRender = React.useCallback(() => {
    if (pendingClipDataRafRef.current !== null) {
      cancelAnimationFrame(pendingClipDataRafRef.current);
      pendingClipDataRafRef.current = null;
    }
    const pending = pendingClipDataRenderRef.current;
    if (!pending) return;
    pendingClipDataRenderRef.current = null;
    clipDataRef.current = pending;
    setClipData(pending);
  }, []);

  const scheduleClipDataRender = React.useCallback((nextClipData: ClipData) => {
    clipDataRef.current = nextClipData;
    pendingClipDataRenderRef.current = nextClipData;
    if (pendingClipDataRafRef.current !== null) {
      return;
    }
    pendingClipDataRafRef.current = requestAnimationFrame(() => {
      pendingClipDataRafRef.current = null;
      const pending = pendingClipDataRenderRef.current;
      if (!pending) return;
      pendingClipDataRenderRef.current = null;
      clipDataRef.current = pending;
      setClipData(pending);
    });
  }, []);

  const compatibleSources = useAnimCompatibleSources({
    launcherService,
    projectModels,
    projectPath,
  });

  React.useEffect(() => {
    if (!compatibleSources.length) {
      setSelectedSourceId("");
      return;
    }
    if (!selectedSourceId || !compatibleSources.some((s) => s.id === selectedSourceId)) {
      setSelectedSourceId(compatibleSources[0].id);
    }
  }, [compatibleSources, selectedSourceId]);

  const selectedSource = React.useMemo(
    () => compatibleSources.find((source) => source.id === selectedSourceId) ?? null,
    [compatibleSources, selectedSourceId]
  );
  const preferredWorkloadName = selectedSource?.workloadName ?? "";
  const telemetryBaseUrl = selectedSource?.telemetryBaseUrl ?? "";

  const applyLoadedClipData = React.useCallback((nextClipData: ClipData) => {
    if (pendingClipDataRafRef.current !== null) {
      cancelAnimationFrame(pendingClipDataRafRef.current);
      pendingClipDataRafRef.current = null;
    }
    pendingClipDataRenderRef.current = null;
    clipDataRef.current = nextClipData;
    setClipData(nextClipData);
    const names = Object.keys(nextClipData.channels);
    setChannelVisible((prev) => {
      const next: Record<string, boolean> = {};
      names.forEach((n) => (next[n] = prev[n] ?? true));
      return next;
    });
    setChannelColor((prev) => {
      const palette = ["#77ceff", "#7ef9a9", "#ffd166", "#ff7b72", "#d9a3ff", "#7afcff", "#fcbf49", "#f07167"];
      const next: Record<string, string> = {};
      names.forEach((n, i) => (next[n] = prev[n] ?? palette[i % palette.length]));
      return next;
    });
    syncClipChannelsRef.current(nextClipData);
  }, []);

  const resetClipData = React.useCallback(() => {
    setClipData({
      name: "clip",
      channels: {},
      durationSec: DEFAULT_EMPTY_CLIP_DURATION_SEC,
      loopResetDurationSec: 1,
      sampleCount: 0,
      liveSampleRateHz: 0,
      clipRevision: "0",
      dirty: false,
    });
  }, []);

  const {
    animTelemetryServiceId,
    buildAnimServiceUrl,
    loadLiveClipData,
    performAnimAuthoringAction,
    performAnimSave,
    reloadAnimsetClipRefs,
  } = useAnimTelemetryService({
    telemetryBaseUrl,
    preferredWorkloadName,
    selectedClipPath,
    reportAnimLoadStatus,
    applyLoadedClipData,
    setClipRefs,
    setSelectedClipPath,
    setAnimsetOptionsFromEngine,
    setAnimsetPath,
    setChannelsetPath,
    setChannelsetId,
    resetClipData,
  });
  const { model: telemetryModel } = useTelemetryStream(telemetryBaseUrl, ANIM_TELEMETRY_SAMPLE_RATE_HZ);
  const fallbackWorkloadNameFromServiceId = React.useMemo(() => {
    if (!animTelemetryServiceId.startsWith("anim:")) return "";
    return animTelemetryServiceId.slice("anim:".length);
  }, [animTelemetryServiceId]);
  const selectedTelemetryWorkload = React.useMemo(
    () =>
      selectTelemetryWorkload(
        telemetryModel?.workloads,
        selectedSource?.workloadName ?? "",
        fallbackWorkloadNameFromServiceId
      ),
    [fallbackWorkloadNameFromServiceId, selectedSource?.workloadName, telemetryModel?.workloads]
  );
  const selectedWorkloadName =
    selectedTelemetryWorkload?.name ?? selectedSource?.workloadName ?? fallbackWorkloadNameFromServiceId;
  const {
    heldSuppressedAnimControlFieldsRef,
    readFieldValue,
    resolveAnimWritableField,
    setAnimControlConnectionState,
    writeAnimControlField,
    writeAnimControlFieldRaw,
    ensureAnimControlSuppressed,
  } = useAnimControlFields({
    telemetryBaseUrl,
    telemetryModel,
    telemetryService,
    selectedSourceWorkloadName: selectedSource?.workloadName ?? "",
    selectedWorkloadName,
  });

  const playbackStateRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.playback_state`)
    : null;
  const playheadTimeRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.playhead_time_sec`)
    : null;
  const isLoopResetActiveRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.is_loop_reset_active`)
    : null;
  const loopResetProgressRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.loop_reset_progress_norm`)
    : null;
  const activeClipIndexRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.active_clip_index`)
    : null;

  const runtimePlayheadSec = typeof playheadTimeRaw === "number" ? Math.max(0, playheadTimeRaw) : null;
  const {
    activeTool,
    lineSnapEnd,
    lineSnapStart,
    rangeFalloffCurve,
    rangeFalloffSec,
    rangeSizeSec,
    selectedTimeRange,
    setActiveTool,
    setLineSnapEnd,
    setLineSnapStart,
    setRangeFalloffSec,
    setSelectedTimeRange,
    setSelectedTimeRangeDurationSec,
    smoothApplyRateHz,
    smoothBrushPreview,
    smoothFalloffCurve,
    smoothFalloffSec,
    smoothRangeSec,
    smoothStrength,
    toolSettingsContext,
    warpBrushPreview,
    warpLockEndpoints,
    warpMode,
    warpTimeStrength,
    warpValueStrength,
    setSmoothBrushPreview,
    setWarpBrushPreview,
    setSmoothFalloffSec,
    setSmoothRangeSec,
    setSmoothStrength,
    rangeFalloffStepSec,
    smoothRangeStepSec,
  } = useAnimToolSettings({
    durationSec: Math.max(DEFAULT_EMPTY_CLIP_DURATION_SEC, clipData.durationSec),
    playheadSec: runtimePlayheadSec ?? 0,
    initialPersistedState,
  });
  const {
    drawWriteStateRef,
    clearDrawFlushTimer,
    beginDrawStrokeSession,
    commitDrawStrokeSession,
    cancelDrawStrokeSession,
    queueDrawStrokeRange,
  } = useClipWriteQueue({
    clipDataRef,
    clipRefs,
    loadLiveClipData,
    buildAnimServiceUrl,
    scheduleClipDataRender,
  });

  React.useEffect(() => {
    setAnimLoadStatus({ level: "ok", message: "OK" });
  }, [selectedSourceId, selectedWorkloadName, animTelemetryServiceId]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadSelectedClip() {
      if (!animTelemetryServiceId || !selectedClipPath) return;
      const selectedClip = clipRefs.find((clip) => clip.animclipPath === selectedClipPath) ?? null;
      const clipIndex = selectedClip ? clipRefs.findIndex((clip) => clip.animclipPath === selectedClip.animclipPath) : -1;
      if (clipIndex < 0) return;
      const parsed = await loadLiveClipData(clipIndex, selectedClip?.name);
      if (cancelled) return;
      if (!parsed) return;
    }
    void loadSelectedClip().catch(() => {
      if (cancelled) return;
      reportAnimLoadStatus("error", "Failed to load clip samples. Check Terminal logs.");
    });
    return () => {
      cancelled = true;
    };
  }, [animTelemetryServiceId, clipRefs, loadLiveClipData, reportAnimLoadStatus, selectedClipPath]);

  React.useEffect(() => {
    if (!selectedWorkloadName) return;
    const runtimeAnimsetPath = readFieldValue(`${selectedWorkloadName}.inputs.animset_path`);
    if (typeof runtimeAnimsetPath === "string" && runtimeAnimsetPath.length > 0) {
      setAnimsetPath(runtimeAnimsetPath);
    }
    const runtimeChannelsetPath = readFieldValue(`${selectedWorkloadName}.config.channelset_path`);
    if (typeof runtimeChannelsetPath === "string" && runtimeChannelsetPath.length > 0) {
      setChannelsetPath(runtimeChannelsetPath);
    }
  }, [readFieldValue, selectedWorkloadName]);

  const channelNames = Object.keys(clipData.channels);
  const visibleChannels = channelNames.filter((n) => channelVisible[n] !== false);
  const allChannelsVisible = channelNames.length > 0 && visibleChannels.length === channelNames.length;
  const armedChannels = channelNames.filter((n) => recordArmByChannel[n] === true);
  const allChannelsArmed = channelNames.length > 0 && armedChannels.length === channelNames.length;
  const hasClipSamples = React.useMemo(
    () => Object.values(clipData.channels).some((samples) => (samples?.length ?? 0) > 0),
    [clipData.channels]
  );
  const durationSec = Math.max(DEFAULT_EMPTY_CLIP_DURATION_SEC, clipData.durationSec);
  const playheadSampleStepSec = React.useMemo(
    () =>
      clipData.liveSampleRateHz > 0
        ? Math.max(0.001, 1 / clipData.liveSampleRateHz)
        : 0.01,
    [clipData.liveSampleRateHz]
  );
  const {
    applyActiveClipPath,
    beginDrawStroke,
    beginPlayheadDragFromClientX,
    beginRangeOffset,
    beginRangeSelection,
    bottomRulerRef,
    firstLaneSvgRef,
    fitLaneRangeForChannel,
    handleLaneHoverChange,
    handleLaneSelect,
    handleSmoothBrushPreviewChange,
    handleWarpBrushPreviewChange,
    hoveredChannel,
    laneRange,
    localScrubTimeSec,
    notePlayheadRendered,
    playheadOverlayMetrics,
    playheadRenderHz,
    playheadSec,
    playheadViewportInsetsPx,
    playheadViewportRef,
    selectedChannel,
    setHoveredChannel,
    setLaneRangeForChannel,
    setLocalScrubTimeSec,
    setSelectedChannel,
    timelineRef,
    timelineViewportRangeNorm,
    topRulerRef,
    onViewportRangeNormChange,
    syncClipChannels,
  } = useAnimTimelineController({
    activeClipIndexRaw,
    activeTool,
    beginDrawStrokeSession,
    cancelDrawStrokeSession,
    channelNames,
    clipDataRef,
    clipRefs,
    clearDrawFlushTimer,
    commitDrawStrokeSession,
    drawWriteStateRef,
    durationSec,
    ensureAnimControlSuppressed,
    flushPendingClipDataRender,
    heldSuppressedAnimControlFieldsRef,
    initialPersistedState,
    lineSnapEnd,
    lineSnapStart,
    playheadSampleStepSec,
    queueDrawStrokeRange,
    queueRenderClipData: scheduleClipDataRender,
    rangeFalloffCurve,
    rangeFalloffSec,
    rangeSizeSec,
    runtimePlayheadSec,
    selectedClipPath,
    selectedTimeRange,
    selectedWorkloadName,
    setAnimControlConnectionState,
    setSelectedClipPath,
    setSelectedTimeRange,
    smoothApplyRateHz,
    smoothBrushPreview,
    smoothFalloffCurve,
    smoothFalloffSec,
    smoothRangeSec,
    smoothStrength,
    visibleChannels,
    warpBrushPreview,
    warpLockEndpoints,
    warpMode,
    warpTimeStrength,
    warpValueStrength,
    writeAnimControlFieldRaw,
    setSmoothBrushPreview,
    setWarpBrushPreview,
  });
  React.useEffect(() => {
    syncClipChannelsRef.current = syncClipChannels;
  }, [syncClipChannels]);
  const [telemetryReceiveHz, setTelemetryReceiveHz] = React.useState(0);
  const playbackState = typeof playbackStateRaw === "number" ? playbackStateRaw : null;
  const isLoopResetActive = Boolean(isLoopResetActiveRaw);
  const loopResetProgressNorm =
    typeof loopResetProgressRaw === "number"
      ? Math.min(1, Math.max(0, loopResetProgressRaw))
      : 0;
  const loopResetSlugRangeNorm = (() => {
    if (!isLoopResetActive) return { left: 1, right: 1 };
    if (loopResetProgressNorm <= 0.5) {
      const widthNorm = loopResetProgressNorm / 0.5;
      return { left: 1 - widthNorm, right: 1 };
    }
    const collapse = (loopResetProgressNorm - 0.5) / 0.5;
    return { left: 0, right: 1 - collapse };
  })();
  const normalizedSelectedTimeRange = React.useMemo(
    () => normalizeTimeRange(durationSec, selectedTimeRange),
    [durationSec, selectedTimeRange]
  );
  const normalizedSelectionFalloff = React.useMemo(
    () => Math.min(1, Math.max(0, rangeFalloffSec)),
    [rangeFalloffSec]
  );
  const rulerMarks = React.useMemo(
    () => [0, 0.2, 0.4, 0.6, 0.8, 1].map((norm) => ({ norm, label: `${(durationSec * norm).toFixed(1)}s` })),
    [durationSec]
  );
  const animsetOptions = React.useMemo(
    () => {
      const ordered = [...animsetOptionsFromEngine];
      if (animsetPath && !ordered.includes(animsetPath)) {
        ordered.push(animsetPath);
      }
      if (DEFAULT_ANIMSET && !ordered.includes(DEFAULT_ANIMSET)) {
        ordered.push(DEFAULT_ANIMSET);
      }
      return ordered;
    },
    [animsetOptionsFromEngine, animsetPath]
  );
  const overlayWidth = playheadOverlayMetrics.width;
  const { seekPlayheadToTimeSec } = useQueuedPlayheadSeek({
    durationSec,
    setAnimControlConnectionState,
    setLocalScrubTimeSec,
    writeAnimControlFieldRaw,
  });

  React.useEffect(() => {
    if (playbackState === null) return;
    setIsPlaying(isAnimPlaybackActive(playbackState));
  }, [playbackState]);

  React.useEffect(() => {
    if (!telemetryBaseUrl) {
      setTelemetryReceiveHz(0);
      return;
    }
    const update = () => {
      setTelemetryReceiveHz(
        telemetryService.getIngressRateHz(telemetryBaseUrl, CADENCE_WINDOW_MS)
      );
    };
    update();
    const intervalId = window.setInterval(update, 250);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [telemetryBaseUrl, telemetryService]);

  const cadenceHudText = React.useMemo(
    () => [
      `anim telemetry recv: ${telemetryReceiveHz.toFixed(1)} Hz`,
      `studio requested: ${ANIM_TELEMETRY_SAMPLE_RATE_HZ.toFixed(1)} Hz`,
      `playhead rendered: ${playheadRenderHz.toFixed(1)} Hz`,
    ].join("\n"),
    [playheadRenderHz, telemetryReceiveHz]
  );

  React.useEffect(() => {
    if (!selectedWorkloadName) return;
    const loopValue = readFieldValue(`${selectedWorkloadName}.inputs.anim_controls.loop`);
    if (typeof loopValue === "boolean") {
      setLoopEnabled(loopValue);
    }
  }, [readFieldValue, selectedWorkloadName]);

  const applyAnimsetPath = React.useCallback(
    (nextPath: string) => {
      if (!nextPath) return;
      setAnimsetPath(nextPath);
      if (!telemetryBaseUrl || !telemetryModel?.schemaSessionId) return;
      const resolved = resolveAnimWritableField("inputs.animset_path");
      if (!resolved) return;
      void telemetryService.setWorkloadInputFieldsData(telemetryBaseUrl, {
        engine_session_id: telemetryModel.schemaSessionId,
        writes: [{ field_handle: resolved.field.writable_input_handle, field_path: resolved.fieldPath, value: nextPath }],
      });
    },
    [resolveAnimWritableField, telemetryBaseUrl, telemetryModel, telemetryService]
  );
  const selectedClipIndex = React.useMemo(
    () => clipRefs.findIndex((clip) => clip.animclipPath === selectedClipPath),
    [clipRefs, selectedClipPath]
  );
  const selectedClipRef = selectedClipIndex >= 0 ? clipRefs[selectedClipIndex] : null;
  const {
    handleCommitDurationSec,
    handleCommitLoopResetDurationSec,
    handleCreateAnimset,
    handleCreateClip,
    handleDeleteAnimset,
    handleDeleteClip,
    handleDuplicateAnimset,
    handleDuplicateClip,
    handleRenameAnimset,
    handleRenameClip,
    handleSave,
    saveButtonUi,
  } = useAnimAuthoringActions({
    animsetPath,
    clipDirty: clipData.dirty,
    clipDataRef,
    durationSec,
    selectedClipIndex,
    selectedClipRef,
    applyAnimsetPath,
    applyActiveClipPath,
    loadLiveClipData,
    performAnimAuthoringAction,
    performAnimSave,
    reloadAnimsetClipRefs,
    reportAnimLoadStatus,
  });

  useAnimEditorPersistence(panelStorageKey, {
    selectedSourceId,
    selectedClipPath,
    activeTool,
    selectedTimeRange,
    lineSnapStart,
    lineSnapEnd,
    rangeFalloffSec,
    rangeFalloffCurve,
    warpMode,
    warpTimeStrength,
    warpValueStrength,
    warpLockEndpoints,
    smoothFalloffSec,
    smoothFalloffCurve,
    smoothStrength,
    smoothApplyRateHz,
    smoothRangeSec,
    channelVisible,
    channelRecordArm: recordArmByChannel,
    channelColor,
    selectedChannel,
    laneRange,
    timelineViewportRangeNorm,
  });

  return (
    <div className={styles.root} data-testid="animation-editor-panel">
      <div className={styles.mainGrid}>
        <aside className={styles.animationInspector}>
          <AnimationTargetPanel
            animLoadStatus={animLoadStatus}
            animsetOptions={animsetOptions}
            animsetPath={animsetPath}
            applyAnimsetPath={applyAnimsetPath}
            channelsetId={channelsetId}
            channelsetPath={channelsetPath}
            clipRefs={clipRefs}
            compatibleSources={compatibleSources.map((source) => ({ id: source.id, label: source.label }))}
            onCreateAnimset={handleCreateAnimset}
            onCreateClip={handleCreateClip}
            onDeleteAnimset={handleDeleteAnimset}
            onDeleteClip={handleDeleteClip}
            onDuplicateAnimset={handleDuplicateAnimset}
            onDuplicateClip={handleDuplicateClip}
            onReloadClipRefs={reloadAnimsetClipRefs}
            onRenameAnimset={handleRenameAnimset}
            onRenameClip={handleRenameClip}
            onSave={handleSave}
            saveButtonUi={saveButtonUi}
            selectedClipPath={selectedClipPath}
            selectedSourceId={selectedSourceId}
            setSelectedSourceId={setSelectedSourceId}
            applyActiveClipPath={applyActiveClipPath}
          />
          <AnimationChannelsPanel
            allChannelsArmed={allChannelsArmed}
            allChannelsVisible={allChannelsVisible}
            channelColor={channelColor}
            channelNames={channelNames}
            channelVisible={channelVisible}
            hoveredChannel={hoveredChannel}
            recordArmByChannel={recordArmByChannel}
            selectedChannel={selectedChannel}
            setChannelColor={setChannelColor}
            setChannelVisible={setChannelVisible}
            setHoveredChannel={setHoveredChannel}
            setRecordArmByChannel={setRecordArmByChannel}
            setSelectedChannel={setSelectedChannel}
          />
        </aside>

        <AnimationTimelineViewport
          timelineRef={timelineRef}
          topRulerRef={topRulerRef}
          bottomRulerRef={bottomRulerRef}
          playheadViewportRef={playheadViewportRef}
          firstLaneSvgRef={firstLaneSvgRef}
          visibleChannels={visibleChannels}
          clipDataChannels={clipData.channels}
          durationSec={durationSec}
          laneRange={laneRange}
          defaultLaneRangeForChannel={defaultLaneRangeForChannel}
          channelColor={channelColor}
          hoveredChannel={hoveredChannel}
          selectedChannel={selectedChannel}
          activeTool={activeTool}
          selectedTimeRange={selectedTimeRange}
          rangeFalloffSec={rangeFalloffSec}
          smoothBrushPreview={smoothBrushPreview}
          warpBrushPreview={warpBrushPreview}
          warpRangeSec={rangeSizeSec}
          warpFalloffFraction={rangeFalloffSec}
          smoothRangeSec={smoothRangeSec}
          smoothFalloffSec={smoothFalloffSec}
          handleLaneHoverChange={handleLaneHoverChange}
          handleLaneSelect={handleLaneSelect}
          setLaneRangeForChannel={setLaneRangeForChannel}
          fitLaneRangeForChannel={fitLaneRangeForChannel}
          beginDrawStroke={beginDrawStroke}
          beginRangeOffset={beginRangeOffset}
          handleSmoothBrushPreviewChange={handleSmoothBrushPreviewChange}
          handleWarpBrushPreviewChange={handleWarpBrushPreviewChange}
          playheadViewportInsetsPx={playheadViewportInsetsPx}
          overlayWidth={overlayWidth}
          playheadOverlayMetrics={playheadOverlayMetrics}
          beginRangeSelection={beginRangeSelection}
          normalizedSelectedTimeRange={activeTool === "Range" ? normalizedSelectedTimeRange : null}
          normalizedSelectionFalloff={activeTool === "Range" ? normalizedSelectionFalloff : 0}
          isLoopResetActive={isLoopResetActive}
          loopResetSlugRangeNorm={loopResetSlugRangeNorm}
          rulerMarks={rulerMarks}
          playheadTimeSec={playheadSec}
          beginPlayheadDragFromClientX={beginPlayheadDragFromClientX}
          viewportRangeNorm={timelineViewportRangeNorm}
          onViewportRangeNormChange={onViewportRangeNormChange}
          cadenceHudText={cadenceHudText}
          onPlayheadRendered={notePlayheadRendered}
        />

        <AnimationToolBar
          tools={animationTools}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        settingsContext={toolSettingsContext}
        durationSec={durationSec}
        rangeFalloffFractionStep={RANGE_FALLOFF_FRACTION_STEP}
        rangeFalloffStepSec={rangeFalloffStepSec}
        smoothRangeStepSec={smoothRangeStepSec}
          rangeSizeSec={rangeSizeSec}
          setSelectedTimeRangeDurationSec={setSelectedTimeRangeDurationSec}
          setRangeFalloffSec={setRangeFalloffSec}
          setSmoothFalloffSec={setSmoothFalloffSec}
          setSmoothRangeSec={setSmoothRangeSec}
          setSmoothStrength={setSmoothStrength}
          setLineSnapStart={setLineSnapStart}
          setLineSnapEnd={setLineSnapEnd}
        />
      </div>
      <TransportBar
        isPlaying={isPlaying}
        loopEnabled={loopEnabled}
        loopResetDurationSec={clipData.loopResetDurationSec}
        durationSec={durationSec}
        playheadSec={playheadSec}
        playheadSampleStepSec={playheadSampleStepSec}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={setLoopEnabled}
        seekPlayheadToTimeSec={seekPlayheadToTimeSec}
        onCommitDurationSec={handleCommitDurationSec}
        onCommitLoopResetDurationSec={handleCommitLoopResetDurationSec}
      />
    </div>
  );
}
