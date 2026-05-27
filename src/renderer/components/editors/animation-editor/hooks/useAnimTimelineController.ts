import React from "react";

import { normalizedFromClientX } from "../playhead-math";
import { beginRangeSelectionBehavior } from "../tools/range/range-behavior";
import { handleSmoothBrushPreviewBehavior } from "../tools/smooth/smooth-behavior";
import { handleLaneHoverBehavior, handleLaneSelectBehavior } from "../tools/pencil/pencil-behavior";
import {
  runBeginDrawStrokeBehavior,
  runBeginRangeOffsetBehavior,
} from "../tools/pointer-edit-behaviors";
import { usePlayheadScrubSession } from "./usePlayheadScrubSession";
import { closestSamplePointToClientPoint, defaultLaneRangeForChannel } from "../anim-editor-lane-utils";
import type { ClipData, ClipRef, LaneRange, TimeSelectionRange } from "../anim-editor-shared";
import type { Point } from "../anim-sample-editing";
import type { AnimationToolId, WarpMode } from "../tools/types";
import type { PersistedAnimEditorState } from "./useAnimEditorPersistence";

const LANE_VIEWBOX_HEIGHT = 40;
const LANE_CURVE_DRAW_HEIGHT = 34;
const CADENCE_WINDOW_MS = 4000;

type DrawWriteState = {
  clipIndex: number;
  channel: string;
  queuedStartSampleIndex: number | null;
  queuedEndSampleIndex: number | null;
  inFlight: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
  acceptedClipRevision: string;
};

type UseAnimTimelineControllerArgs = {
  activeClipIndexRaw: unknown;
  activeTool: AnimationToolId | null;
  channelNames: string[];
  clipDataRef: React.RefObject<ClipData>;
  clipRefs: ClipRef[];
  beginDrawStrokeSession: (clipIndex: number, channel: string) => void;
  cancelDrawStrokeSession: () => Promise<void>;
  clearDrawFlushTimer: () => void;
  drawWriteStateRef: React.MutableRefObject<DrawWriteState>;
  durationSec: number;
  ensureAnimControlSuppressed: (fieldName: string) => Promise<boolean>;
  commitDrawStrokeSession: () => Promise<void>;
  flushPendingClipDataRender: () => void;
  heldSuppressedAnimControlFieldsRef: React.MutableRefObject<Set<string>>;
  initialPersistedState: PersistedAnimEditorState | null;
  lineSnapEnd: boolean;
  lineSnapStart: boolean;
  playheadSampleStepSec: number;
  queueDrawStrokeRange: (
    clipIndex: number,
    channel: string,
    startSampleIndex: number,
    endSampleIndex: number
  ) => void;
  queueRenderClipData: (nextClipData: ClipData) => void;
  rangeFalloffCurve: number;
  rangeFalloffSec: number;
  rangeSizeSec: number;
  runtimePlayheadSec: number | null;
  selectedClipPath: string;
  selectedTimeRange: TimeSelectionRange | null;
  selectedWorkloadName: string;
  setAnimControlConnectionState: (fieldName: string, enabled: boolean) => Promise<boolean>;
  setSelectedClipPath: React.Dispatch<React.SetStateAction<string>>;
  setSelectedTimeRange: React.Dispatch<React.SetStateAction<TimeSelectionRange | null>>;
  smoothApplyRateHz: number;
  smoothBrushPreview: { channel: string; centerSec: number } | null;
  smoothFalloffCurve: number;
  smoothFalloffSec: number;
  smoothRangeSec: number;
  smoothStrength: number;
  visibleChannels: string[];
  warpBrushPreview: { channel: string; centerSec: number } | null;
  warpLockEndpoints: boolean;
  warpMode: WarpMode;
  warpTimeStrength: number;
  warpValueStrength: number;
  writeAnimControlFieldRaw: (fieldName: string, value: unknown) => Promise<boolean>;
  setSmoothBrushPreview: React.Dispatch<React.SetStateAction<{ channel: string; centerSec: number } | null>>;
  setWarpBrushPreview: React.Dispatch<React.SetStateAction<{ channel: string; centerSec: number } | null>>;
};

export function useAnimTimelineController({
  activeClipIndexRaw,
  activeTool,
  channelNames,
  beginDrawStrokeSession,
  cancelDrawStrokeSession,
  clipDataRef,
  clipRefs,
  clearDrawFlushTimer,
  drawWriteStateRef,
  durationSec,
  ensureAnimControlSuppressed,
  commitDrawStrokeSession,
  flushPendingClipDataRender,
  heldSuppressedAnimControlFieldsRef,
  initialPersistedState,
  lineSnapEnd,
  lineSnapStart,
  playheadSampleStepSec,
  queueDrawStrokeRange,
  queueRenderClipData,
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
}: UseAnimTimelineControllerArgs) {
  const [hoveredChannel, setHoveredChannel] = React.useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = React.useState<string | null>(
    () => initialPersistedState?.selectedChannel ?? null
  );
  const [laneRange, setLaneRange] = React.useState<Record<string, LaneRange>>(
    () => initialPersistedState?.laneRange ?? {}
  );
  const timelineRef = React.useRef<HTMLDivElement | null>(null);
  const topRulerRef = React.useRef<HTMLDivElement | null>(null);
  const bottomRulerRef = React.useRef<HTMLDivElement | null>(null);
  const playheadViewportRef = React.useRef<HTMLDivElement | null>(null);
  const firstLaneSvgRef = React.useRef<SVGSVGElement | null>(null);
  const [playheadViewportInsetsPx, setPlayheadViewportInsetsPx] = React.useState({ left: 77, right: 14 });
  const [playheadOverlayMetrics, setPlayheadOverlayMetrics] = React.useState({
    width: 1000,
    height: 100,
    topRulerHeight: 24,
    bottomRulerTop: 76,
    bottomRulerHeight: 24,
    topBlobCenterY: 18,
    bottomBlobCenterY: 82,
  });
  const [timelineViewportRangeNorm, setTimelineViewportRangeNorm] = React.useState(() =>
    initialPersistedState?.timelineViewportRangeNorm ?? { startNorm: 0, endNorm: 1 }
  );
  const [localScrubTimeSec, setLocalScrubTimeSec] = React.useState<number | null>(null);
  const [pendingScrubAdoptSec, setPendingScrubAdoptSec] = React.useState<number | null>(null);
  const [pendingActiveClipIndex, setPendingActiveClipIndex] = React.useState<number | null>(null);
  const rangeOffsetStateRef = React.useRef<{
    active: boolean;
    clipIndex: number;
    channel: string;
    mode: "Range" | "Warp" | "Smooth" | null;
    coreRange: { startSampleIndex: number; endSampleIndex: number } | null;
    writeRange: { startSampleIndex: number; endSampleIndex: number } | null;
    baseSamples: Float32Array | null;
    baseDirty: boolean;
    startClientX: number;
    startClientY: number;
    laneWidthPx: number;
    laneHeightPx: number;
    visibleDurationSec: number;
    laneValueSpan: number;
  }>({
    active: false,
    clipIndex: -1,
    channel: "",
    mode: null,
    coreRange: null,
    writeRange: null,
    baseSamples: null,
    baseDirty: false,
    startClientX: 0,
    startClientY: 0,
    laneWidthPx: 1,
    laneHeightPx: 1,
    visibleDurationSec: 1,
    laneValueSpan: 1,
  });
  const linePreviewStateRef = React.useRef<{
    active: boolean;
    clipIndex: number;
    channel: string;
    baseSamples: Float32Array | null;
    baseDirty: boolean;
    startPoint: Point | null;
    touchedRange: { startSampleIndex: number; endSampleIndex: number } | null;
  }>({
    active: false,
    clipIndex: -1,
    channel: "",
    baseSamples: null,
    baseDirty: false,
    startPoint: null,
    touchedRange: null,
  });
  const playheadRenderCadenceSamplesRef = React.useRef<number[]>([]);
  const [playheadRenderHz, setPlayheadRenderHz] = React.useState(0);

  const { beginScrubSession, queueScrubTimeOverride, endScrubSession } = usePlayheadScrubSession({
    setAnimControlConnectionState,
    writeAnimControlFieldRaw,
    localScrubTimeSec,
    setPendingScrubAdoptSec,
    setLocalScrubTimeSec,
    heldSuppressedAnimControlFieldsRef,
  });

  const playheadSec = localScrubTimeSec ?? runtimePlayheadSec ?? 0;

  const syncClipChannels = React.useCallback((nextClipData: ClipData) => {
    const names = Object.keys(nextClipData.channels);
    setLaneRange(() => {
      const next: Record<string, LaneRange> = {};
      names.forEach((name) => {
        next[name] = defaultLaneRangeForChannel(name, nextClipData.channels[name] ?? []);
      });
      return next;
    });
    setSelectedChannel((prev) => (prev && names.includes(prev) ? prev : names[0] ?? null));
  }, []);

  React.useEffect(
    () => () => {
      clearDrawFlushTimer();
    },
    [clearDrawFlushTimer]
  );

  React.useEffect(() => {
    if (pendingScrubAdoptSec === null || runtimePlayheadSec === null) return;
    const adoptToleranceSec = Math.max(0.0005, Math.min(0.005, playheadSampleStepSec * 0.25));
    if (Math.abs(runtimePlayheadSec - pendingScrubAdoptSec) <= adoptToleranceSec) {
      setPendingScrubAdoptSec(null);
      setLocalScrubTimeSec(null);
    }
  }, [pendingScrubAdoptSec, playheadSampleStepSec, runtimePlayheadSec]);

  React.useEffect(() => {
    if (!selectedWorkloadName || clipRefs.length === 0) return;
    if (typeof activeClipIndexRaw !== "number") return;
    const idx = Math.floor(activeClipIndexRaw);
    if (pendingActiveClipIndex !== null) {
      if (idx === pendingActiveClipIndex) {
        setPendingActiveClipIndex(null);
      } else {
        return;
      }
    }
    if (idx < 0 || idx >= clipRefs.length) return;
    const matched = clipRefs[idx];
    if (matched.animclipPath !== selectedClipPath) {
      setSelectedClipPath(matched.animclipPath);
    }
  }, [activeClipIndexRaw, clipRefs, pendingActiveClipIndex, selectedClipPath, selectedWorkloadName, setSelectedClipPath]);

  React.useLayoutEffect(() => {
    const timeline = timelineRef.current;
    const viewport = playheadViewportRef.current;
    const topRuler = topRulerRef.current;
    const bottomRuler = bottomRulerRef.current;
    if (!timeline || !viewport) return;

    const measure = () => {
      const timelineRect = timeline.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (timelineRect.height < 80 || viewportRect.width < 80 || viewportRect.height < 80) {
        return;
      }
      const laneSvg = firstLaneSvgRef.current;
      if (laneSvg) {
        const laneRect = laneSvg.getBoundingClientRect();
        if (laneRect.width >= 40) {
          const left = Math.max(0, laneRect.left - timelineRect.left);
          const right = Math.max(0, timelineRect.right - laneRect.right);
          setPlayheadViewportInsetsPx({ left, right });
        }
      }
      const overlayWidth = Math.max(1, viewportRect.width);
      const overlayHeight = Math.max(1, viewportRect.height);
      const topRulerRect = topRuler?.getBoundingClientRect();
      const bottomRulerRect = bottomRuler?.getBoundingClientRect();
      const topRulerHeight = Math.max(1, topRulerRect?.height ?? 24);
      const bottomRulerTop = Math.max(0, bottomRulerRect ? bottomRulerRect.top - viewportRect.top : overlayHeight - 24);
      const bottomRulerHeight = Math.max(1, bottomRulerRect?.height ?? 24);
      const topBlobCenterY = topRulerRect ? Math.max(6, topRulerRect.height - 8) : 18;
      const bottomBlobCenterY = bottomRulerRect
        ? Math.max(6, bottomRulerRect.top - viewportRect.top + 8)
        : Math.max(12, overlayHeight - 18);
      setPlayheadOverlayMetrics({
        width: overlayWidth,
        height: overlayHeight,
        topRulerHeight,
        bottomRulerTop,
        bottomRulerHeight,
        topBlobCenterY,
        bottomBlobCenterY,
      });
    };

    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(timeline);
    observer.observe(viewport);
    if (topRuler) observer.observe(topRuler);
    if (bottomRuler) observer.observe(bottomRuler);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [channelNames.join("|"), visibleChannels.join("|")]);

  const notePlayheadRendered = React.useCallback(() => {
    const nowMs = performance.now();
    const next = [...playheadRenderCadenceSamplesRef.current, nowMs].filter(
      (tsMs) => nowMs - tsMs <= CADENCE_WINDOW_MS
    );
    playheadRenderCadenceSamplesRef.current = next;
    if (next.length < 2) {
      setPlayheadRenderHz(0);
      return;
    }
    const spanMs = Math.max(1, next[next.length - 1] - next[0]);
    setPlayheadRenderHz(((next.length - 1) * 1000) / spanMs);
  }, []);

  const applyActiveClipPath = React.useCallback(
    (nextPath: string) => {
      setSelectedClipPath(nextPath);
      const selectedIndex = clipRefs.findIndex((clip) => clip.animclipPath === nextPath);
      if (selectedIndex >= 0) {
        setPendingActiveClipIndex(selectedIndex);
        setTimeout(() => {
          setPendingActiveClipIndex((current) => (current === selectedIndex ? null : current));
        }, 1200);
        void (async () => {
          await ensureAnimControlSuppressed("active_clip_index");
          await writeAnimControlFieldRaw("active_clip_index", selectedIndex);
        })();
      }
    },
    [clipRefs, ensureAnimControlSuppressed, setSelectedClipPath, writeAnimControlFieldRaw]
  );

  function seekFromClientX(clientX: number): number | undefined {
    const element = playheadViewportRef.current;
    if (!element) return undefined;
    const rect = element.getBoundingClientRect();
    const ratio = normalizedFromClientX(clientX, rect.left, rect.width);
    setLocalScrubTimeSec(ratio * durationSec);
    return ratio;
  }

  const beginPlayheadDragFromClientX = React.useCallback(
    (clientX: number) => {
      const startRatio = seekFromClientX(clientX);
      void beginScrubSession();
      const startTimeSec =
        (startRatio ??
          (durationSec > 0
            ? Math.min(1, Math.max(0, playheadSec / durationSec))
            : 0)) * durationSec;
      queueScrubTimeOverride(startTimeSec);
      const onMove = (moveEvent: PointerEvent) => {
        const ratio = seekFromClientX(moveEvent.clientX);
        if (ratio === undefined) return;
        queueScrubTimeOverride(ratio * durationSec);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        void endScrubSession();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [beginScrubSession, durationSec, endScrubSession, playheadSec, queueScrubTimeOverride]
  );

  const beginRangeSelection = React.useCallback(
    (event: React.PointerEvent<Element>) => {
      if (event.button !== 0) {
        return;
      }
      beginRangeSelectionBehavior({
        activeTool,
        durationSec,
        viewportRangeNorm: timelineViewportRangeNorm,
        viewportElement: playheadViewportRef.current,
        event,
        mutations: {
          setSelectedTimeRange,
        },
      });
    },
    [activeTool, durationSec, setSelectedTimeRange, timelineViewportRangeNorm]
  );

  const pointerToDrawPoint = React.useCallback(
    (svg: SVGSVGElement, clientX: number, clientY: number, minV: number, maxV: number): Point | null => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const xNorm = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const viewboxY = ((clientY - rect.top) / rect.height) * LANE_VIEWBOX_HEIGHT;
      const clampedCurveY = Math.min(LANE_CURVE_DRAW_HEIGHT, Math.max(0, viewboxY));
      const yNorm = clampedCurveY / LANE_CURVE_DRAW_HEIGHT;
      const span = Math.max(1e-6, maxV - minV);
      return {
        t: xNorm * durationSec,
        v: maxV - yNorm * span,
      };
    },
    [durationSec]
  );

  const beginRangeOffset = React.useCallback(
    (
      event: React.PointerEvent<SVGElement>,
      channel: string,
      channelSamples: Float32Array,
      minV: number,
      maxV: number
    ) => {
      if (event.button !== 0) {
        return;
      }
      runBeginRangeOffsetBehavior({
        event,
        activeTool,
        channel,
        channelSamples,
        minV,
        maxV,
        selectedTimeRange,
        clipRefs,
        selectedClipPath,
        durationSec,
        viewportRangeNorm: timelineViewportRangeNorm,
        rangeFalloffSec,
        rangeFalloffCurve,
        warpMode,
        warpTimeStrength,
        warpValueStrength,
        warpLockEndpoints,
        clipDataRef,
        rangeOffsetStateRef,
        drawWriteStateRef,
        beginDrawStrokeSession,
        scheduleClipDataRender: queueRenderClipData,
        queueDrawStrokeRange,
        clearDrawFlushTimer,
        flushPendingClipDataRender,
        commitDrawStrokeSession,
        cancelDrawStrokeSession,
      });
    },
    [
      activeTool,
      clearDrawFlushTimer,
      clipDataRef,
      beginDrawStrokeSession,
      clipRefs,
      drawWriteStateRef,
      durationSec,
      cancelDrawStrokeSession,
      commitDrawStrokeSession,
      flushPendingClipDataRender,
      queueDrawStrokeRange,
      queueRenderClipData,
      rangeFalloffCurve,
      rangeFalloffSec,
      selectedClipPath,
      selectedTimeRange,
      timelineViewportRangeNorm,
      warpLockEndpoints,
      warpMode,
      warpTimeStrength,
      warpValueStrength,
    ]
  );

  const beginDrawStroke = React.useCallback(
    (
      event: React.PointerEvent<SVGSVGElement>,
      channel: string,
      channelSamples: Float32Array,
      minV: number,
      maxV: number
    ) => {
      if (event.button !== 0) {
        return;
      }
      runBeginDrawStrokeBehavior({
        event,
        activeTool,
        channel,
        channelSamples,
        minV,
        maxV,
        clipRefs,
        selectedClipPath,
        durationSec,
        lineSnapStart,
        lineSnapEnd,
        smoothRangeSec,
        rangeSizeSec,
        rangeFalloffSec,
        rangeFalloffCurve,
        warpMode,
        warpTimeStrength,
        warpValueStrength,
        warpLockEndpoints,
        smoothStrength,
        smoothApplyRateHz,
        smoothFalloffSec,
        smoothFalloffCurve,
        clipDataRef,
        linePreviewStateRef,
        drawWriteStateRef,
        beginDrawStrokeSession,
        scheduleClipDataRender: queueRenderClipData,
        queueDrawStrokeRange,
        clearDrawFlushTimer,
        flushPendingClipDataRender,
        commitDrawStrokeSession,
        cancelDrawStrokeSession,
        setSelectedChannel,
        setSmoothBrushPreview,
        setWarpBrushPreview,
        pointerToDrawPoint,
        closestSamplePointToClientPoint,
      });
    },
    [
      activeTool,
      clearDrawFlushTimer,
      clipDataRef,
      beginDrawStrokeSession,
      clipRefs,
      drawWriteStateRef,
      durationSec,
      cancelDrawStrokeSession,
      flushPendingClipDataRender,
      commitDrawStrokeSession,
      lineSnapEnd,
      lineSnapStart,
      pointerToDrawPoint,
      queueDrawStrokeRange,
      queueRenderClipData,
      rangeFalloffCurve,
      rangeFalloffSec,
      rangeSizeSec,
      selectedClipPath,
      smoothApplyRateHz,
      smoothFalloffCurve,
      smoothFalloffSec,
      smoothRangeSec,
      smoothStrength,
      warpLockEndpoints,
      warpMode,
      warpTimeStrength,
      warpValueStrength,
    ]
  );

  const setLaneRangeForChannel = React.useCallback((channel: string, nextRange: LaneRange) => {
    setLaneRange((prev) => ({ ...prev, [channel]: nextRange }));
  }, []);

  const fitLaneRangeForChannel = React.useCallback((channel: string) => {
    const samples = clipDataRef.current.channels[channel] ?? new Float32Array(0);
    setLaneRange((prev) => ({ ...prev, [channel]: defaultLaneRangeForChannel(channel, samples) }));
  }, [clipDataRef]);

  const handleLaneHoverChange = React.useCallback((channel: string, hovered: boolean) => {
    handleLaneHoverBehavior(channel, hovered, {
      setHoveredChannel,
    });
  }, []);

  const handleLaneSelect = React.useCallback((channel: string) => {
    handleLaneSelectBehavior(channel, {
      setSelectedChannel,
    });
  }, []);

  const handleSmoothBrushPreviewChange = React.useCallback(
    (channel: string, timeSec: number | null) => {
      handleSmoothBrushPreviewBehavior({
        activeTool,
        channel,
        timeSec,
        durationSec,
        mutations: {
          setSmoothBrushPreview,
        },
      });
    },
    [activeTool, durationSec, setSmoothBrushPreview]
  );

  const handleWarpBrushPreviewChange = React.useCallback(
    (channel: string, timeSec: number | null) => {
      if (activeTool !== "Warp") return;
      if (timeSec === null) {
        setWarpBrushPreview(null);
        return;
      }
      setWarpBrushPreview({
        channel,
        centerSec: Math.min(durationSec, Math.max(0, timeSec)),
      });
    },
    [activeTool, durationSec, setWarpBrushPreview]
  );

  React.useEffect(() => {
    if (activeTool !== "Warp") return;
    if (warpBrushPreview) return;
    const previewChannel =
      (selectedChannel && channelNames.includes(selectedChannel) ? selectedChannel : null) ??
      visibleChannels[0] ??
      null;
    if (!previewChannel) return;
    setWarpBrushPreview({
      channel: previewChannel,
      centerSec: Math.min(durationSec, Math.max(0, playheadSec)),
    });
  }, [activeTool, channelNames, durationSec, playheadSec, selectedChannel, setWarpBrushPreview, visibleChannels, warpBrushPreview]);

  return {
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
    onViewportRangeNormChange: setTimelineViewportRangeNorm,
    syncClipChannels,
  };
}
