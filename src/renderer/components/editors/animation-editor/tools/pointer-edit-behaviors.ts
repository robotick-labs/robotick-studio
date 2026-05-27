import type React from "react";
import {
  applyWarpToSampleRangeWithFalloff,
  applyOffsetToSampleRangeWithFalloff,
  applySampleDeltaToBuffer,
  applySmoothBrushToSamples,
  buildInterpolatedDrawDelta,
  sampleIndexRangeFromTimes,
  type Point,
  type WarpMode,
} from "../anim-sample-editing";
import { computeCenteredRangeShape } from "./range/range-shape";

const SMOOTH_STRENGTH_APPLY_SCALE = 0.08;

type ClipRef = { name: string; animclipPath: string };
type ClipDataLike = {
  channels: Record<string, Float32Array>;
  durationSec: number;
  clipRevision: string;
  dirty: boolean;
  [key: string]: unknown;
};

type RangeOffsetState = {
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
};

type LinePreviewState = {
  active: boolean;
  clipIndex: number;
  channel: string;
  baseSamples: Float32Array | null;
  baseDirty: boolean;
  startPoint: Point | null;
  touchedRange: { startSampleIndex: number; endSampleIndex: number } | null;
};

type DrawWriteState = {
  clipIndex: number;
  channel: string;
  queuedStartSampleIndex: number | null;
  queuedEndSampleIndex: number | null;
  acceptedClipRevision: string;
  inFlight: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
};

export function runBeginRangeOffsetBehavior<
  TClipData extends ClipDataLike,
>(args: {
  event: React.PointerEvent<SVGElement>;
  activeTool: "Pencil" | "Line" | "Range" | "Warp" | "Smooth"  | null;
  channel: string;
  channelSamples: Float32Array;
  minV: number;
  maxV: number;
  selectedTimeRange: { startSec: number; endSec: number } | null;
  clipRefs: ClipRef[];
  selectedClipPath: string;
  durationSec: number;
  viewportRangeNorm: { startNorm: number; endNorm: number };
  rangeFalloffSec: number;
  rangeFalloffCurve: number;
  warpMode: WarpMode;
  warpTimeStrength: number;
  warpValueStrength: number;
  warpLockEndpoints: boolean;
  clipDataRef: React.MutableRefObject<TClipData>;
  rangeOffsetStateRef: React.MutableRefObject<RangeOffsetState>;
  drawWriteStateRef: React.MutableRefObject<DrawWriteState>;
  beginDrawStrokeSession: (clipIndex: number, channel: string) => void;
  scheduleClipDataRender: (next: TClipData) => void;
  queueDrawStrokeRange: (
    clipIndex: number,
    channel: string,
    startSampleIndex: number,
    endSampleIndex: number,
  ) => void;
  clearDrawFlushTimer: () => void;
  flushPendingClipDataRender: () => void;
  commitDrawStrokeSession: () => Promise<void>;
  cancelDrawStrokeSession: () => Promise<void>;
}) {
  const {
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
    viewportRangeNorm,
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
    scheduleClipDataRender,
    queueDrawStrokeRange,
    clearDrawFlushTimer,
    flushPendingClipDataRender,
    commitDrawStrokeSession,
    cancelDrawStrokeSession,
  } = args;

  if ((activeTool !== "Range" && activeTool !== "Warp") || !selectedTimeRange) return;
  event.preventDefault();
  event.stopPropagation();
  const selectedClip =
    clipRefs.find((clip) => clip.animclipPath === selectedClipPath) ?? null;
  const clipIndex = selectedClip
    ? clipRefs.findIndex(
        (clip) => clip.animclipPath === selectedClip.animclipPath,
      )
    : -1;
  if (clipIndex < 0) return;
  const totalRangeShape = computeCenteredRangeShape(
    selectedTimeRange.startSec,
    selectedTimeRange.endSec,
    rangeFalloffSec
  );
  const coreSampleRange = sampleIndexRangeFromTimes(
    channelSamples.length,
    durationSec,
    totalRangeShape.coreStart,
    totalRangeShape.coreEnd,
  );
  if (!coreSampleRange) return;
  const falloffSec = totalRangeShape.falloffPerSide;
  const falloffSampleCount =
    channelSamples.length > 1 && durationSec > 0
      ? Math.max(
          0,
          Math.round((falloffSec / durationSec) * (channelSamples.length - 1)),
        )
      : 0;

  const laneTrack =
    (event.currentTarget.closest(
      "[data-lane-track='true']",
    ) as HTMLElement | null) ??
    event.currentTarget.ownerSVGElement?.parentElement;
  const laneRect = laneTrack?.getBoundingClientRect();
  const laneWidthPx = Math.max(1, laneRect?.width ?? 1);
  const laneHeightPx = Math.max(1, laneRect?.height ?? 1);
  const visibleDurationSec =
    durationSec * Math.max(1e-6, viewportRangeNorm.endNorm - viewportRangeNorm.startNorm);
  const laneValueSpan = Math.max(1e-6, maxV - minV);

  beginDrawStrokeSession(clipIndex, channel);
  rangeOffsetStateRef.current = {
    active: true,
    clipIndex,
    channel,
    mode: activeTool,
    coreRange: coreSampleRange,
    writeRange: coreSampleRange,
    baseSamples: (
      clipDataRef.current.channels[channel] ?? channelSamples
    ).slice(),
    baseDirty: clipDataRef.current.dirty,
    startClientX: event.clientX,
    startClientY: event.clientY,
    laneWidthPx,
    laneHeightPx,
    visibleDurationSec,
    laneValueSpan,
  };

  const applyPreview = (clientX: number, clientY: number) => {
    const state = rangeOffsetStateRef.current;
    if (!state.active || !state.baseSamples || !state.coreRange) return;
    const verticalOffset =
      -((clientY - state.startClientY) / state.laneHeightPx) * state.laneValueSpan;
    const result =
      state.mode === "Warp"
        ? applyWarpToSampleRangeWithFalloff(
            state.baseSamples,
            durationSec,
            state.coreRange,
            ((clientX - state.startClientX) / state.laneWidthPx) * state.visibleDurationSec,
            verticalOffset,
            falloffSampleCount,
            warpMode,
            warpTimeStrength,
            warpValueStrength,
            rangeFalloffCurve,
            warpLockEndpoints
          )
        : applyOffsetToSampleRangeWithFalloff(
            state.baseSamples,
            state.coreRange,
            verticalOffset,
            falloffSampleCount,
            rangeFalloffCurve
          );
    state.writeRange = result.writeRange;
    scheduleClipDataRender({
      ...clipDataRef.current,
      dirty: true,
      channels: {
        ...clipDataRef.current.channels,
        [channel]: result.samples,
      },
    });
    queueDrawStrokeRange(
      clipIndex,
      channel,
      result.writeRange.startSampleIndex,
      result.writeRange.endSampleIndex,
      );
  };

  const finishRangeOffset = (applyEdit: boolean) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKeyDown);
    const state = rangeOffsetStateRef.current;
    rangeOffsetStateRef.current = {
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
    };
    if (!state.baseSamples || !state.coreRange || !state.writeRange) return;

    if (!applyEdit) {
      clearDrawFlushTimer();
      drawWriteStateRef.current.queuedStartSampleIndex = null;
      drawWriteStateRef.current.queuedEndSampleIndex = null;
      scheduleClipDataRender({
        ...clipDataRef.current,
        dirty: state.baseDirty,
        channels: {
          ...clipDataRef.current.channels,
          [channel]: state.baseSamples,
        },
      });
      flushPendingClipDataRender();
      void cancelDrawStrokeSession();
      return;
    }

    flushPendingClipDataRender();
    void commitDrawStrokeSession();
  };

  const onMove = (moveEvent: PointerEvent) => {
    applyPreview(moveEvent.clientX, moveEvent.clientY);
  };
  const onUp = () => finishRangeOffset(true);
  const onKeyDown = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      finishRangeOffset(false);
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKeyDown);
}

export function runBeginDrawStrokeBehavior<
  TClipData extends ClipDataLike,
>(args: {
  event: React.PointerEvent<SVGSVGElement>;
  activeTool: "Pencil" | "Line" | "Range" | "Warp" | "Smooth"  | null;
  channel: string;
  channelSamples: Float32Array;
  minV: number;
  maxV: number;
  clipRefs: ClipRef[];
  selectedClipPath: string;
  durationSec: number;
  lineSnapStart: boolean;
  lineSnapEnd: boolean;
  rangeSizeSec: number;
  rangeFalloffSec: number;
  rangeFalloffCurve: number;
  warpMode: WarpMode;
  warpTimeStrength: number;
  warpValueStrength: number;
  warpLockEndpoints: boolean;
  smoothRangeSec: number;
  smoothStrength: number;
  smoothApplyRateHz: number;
  smoothFalloffSec: number;
  smoothFalloffCurve: number;
  clipDataRef: React.MutableRefObject<TClipData>;
  linePreviewStateRef: React.MutableRefObject<LinePreviewState>;
  drawWriteStateRef: React.MutableRefObject<DrawWriteState>;
  beginDrawStrokeSession: (clipIndex: number, channel: string) => void;
  scheduleClipDataRender: (next: TClipData) => void;
  queueDrawStrokeRange: (
    clipIndex: number,
    channel: string,
    startSampleIndex: number,
    endSampleIndex: number,
  ) => void;
  clearDrawFlushTimer: () => void;
  flushPendingClipDataRender: () => void;
  commitDrawStrokeSession: () => Promise<void>;
  cancelDrawStrokeSession: () => Promise<void>;
  setSelectedChannel: (channel: string) => void;
  setSmoothBrushPreview: (
    next: { channel: string; centerSec: number } | null,
  ) => void;
  setWarpBrushPreview: (
    next: { channel: string; centerSec: number } | null,
  ) => void;
  pointerToDrawPoint: (
    svg: SVGSVGElement,
    clientX: number,
    clientY: number,
    minV: number,
    maxV: number,
  ) => Point | null;
  closestSamplePointToClientPoint: (
    samples: ArrayLike<number>,
    durationSec: number,
    minV: number,
    maxV: number,
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
  ) => Point;
}) {
  const {
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
    rangeSizeSec,
    rangeFalloffSec,
    rangeFalloffCurve,
    warpMode,
    warpTimeStrength,
    warpValueStrength,
    warpLockEndpoints,
    smoothRangeSec,
    smoothStrength,
    smoothApplyRateHz,
    smoothFalloffSec,
    smoothFalloffCurve,
    clipDataRef,
    linePreviewStateRef,
    drawWriteStateRef,
    beginDrawStrokeSession,
    scheduleClipDataRender,
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
  } = args;

  if (
    activeTool !== "Pencil" &&
    activeTool !== "Line" &&
    activeTool !== "Warp" &&
    activeTool !== "Smooth"
  ) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const selectedClip =
    clipRefs.find((clip) => clip.animclipPath === selectedClipPath) ?? null;
  const clipIndex = selectedClip
    ? clipRefs.findIndex(
        (clip) => clip.animclipPath === selectedClip.animclipPath,
      )
    : -1;
  const svg = event.currentTarget;
  setSelectedChannel(channel);
  beginDrawStrokeSession(clipIndex, channel);

  const startPoint = pointerToDrawPoint(
    svg,
    event.clientX,
    event.clientY,
    minV,
    maxV,
  );
  if (!startPoint) return;

  if (activeTool === "Warp") {
    const baseSamples = (
      clipDataRef.current.channels[channel] ?? channelSamples
    ).slice();
    const baseDirty = clipDataRef.current.dirty;
    const totalRangeShape = computeCenteredRangeShape(
      Math.max(0, startPoint.t - rangeSizeSec * 0.5),
      Math.min(durationSec, startPoint.t + rangeSizeSec * 0.5),
      rangeFalloffSec
    );
    const coreSampleRange = sampleIndexRangeFromTimes(
      baseSamples.length,
      durationSec,
      totalRangeShape.coreStart,
      totalRangeShape.coreEnd
    );
    if (!coreSampleRange) return;
    const falloffSampleCount =
      baseSamples.length > 1 && durationSec > 0
        ? Math.max(
            0,
            Math.round((totalRangeShape.falloffPerSide / durationSec) * (baseSamples.length - 1))
          )
        : 0;
    let touchedRange: {
      startSampleIndex: number;
      endSampleIndex: number;
    } | null = null;
    setWarpBrushPreview({ channel, centerSec: startPoint.t });

    const applyWarpPreview = (point: Point) => {
      setWarpBrushPreview({ channel, centerSec: point.t });
      const result = applyWarpToSampleRangeWithFalloff(
        baseSamples,
        durationSec,
        coreSampleRange,
        point.t - startPoint.t,
        point.v - startPoint.v,
        falloffSampleCount,
        warpMode,
        warpTimeStrength,
        warpValueStrength,
        rangeFalloffCurve,
        warpLockEndpoints
      );
      touchedRange = touchedRange
        ? {
            startSampleIndex: Math.min(touchedRange.startSampleIndex, result.writeRange.startSampleIndex),
            endSampleIndex: Math.max(touchedRange.endSampleIndex, result.writeRange.endSampleIndex),
          }
        : result.writeRange;
      scheduleClipDataRender({
        ...clipDataRef.current,
        dirty: true,
        channels: {
          ...clipDataRef.current.channels,
          [channel]: result.samples,
        },
      });
      queueDrawStrokeRange(
        clipIndex,
        channel,
        result.writeRange.startSampleIndex,
        result.writeRange.endSampleIndex
      );
    };

    applyWarpPreview(startPoint);

    const finishWarpSession = (applyEdit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      if (!applyEdit) {
        setWarpBrushPreview(null);
      }
      clearDrawFlushTimer();
      flushPendingClipDataRender();

      if (!applyEdit) {
        drawWriteStateRef.current.queuedStartSampleIndex = null;
        drawWriteStateRef.current.queuedEndSampleIndex = null;
        scheduleClipDataRender({
          ...clipDataRef.current,
          dirty: baseDirty,
          channels: {
            ...clipDataRef.current.channels,
            [channel]: baseSamples,
          },
        });
        if (touchedRange) {
          void cancelDrawStrokeSession();
        } else {
          void cancelDrawStrokeSession();
        }
        return;
      }

      if (touchedRange) {
        flushPendingClipDataRender();
        void commitDrawStrokeSession();
      }
    };

    const onMove = (moveEvent: PointerEvent) => {
      const point = pointerToDrawPoint(
        svg,
        moveEvent.clientX,
        moveEvent.clientY,
        minV,
        maxV,
      );
      if (!point) return;
      applyWarpPreview(point);
    };
    const onUp = () => finishWarpSession(true);
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      finishWarpSession(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKeyDown);
    return;
  }

  if (activeTool === "Smooth") {
    const baseSamples = (
      clipDataRef.current.channels[channel] ?? channelSamples
    ).slice();
    const baseDirty = clipDataRef.current.dirty;
    let touchedRange: {
      startSampleIndex: number;
      endSampleIndex: number;
    } | null = null;
    setSmoothBrushPreview({ channel, centerSec: startPoint.t });
    const commitBrushPoint = (point: Point) => {
      const currentClip = clipDataRef.current;
      const current = currentClip.channels[channel] ?? channelSamples;
      const brushRangeSec = Math.min(
        durationSec,
        Math.max(0.01, smoothRangeSec),
      );
      const effectiveSmoothStrength =
        smoothStrength * SMOOTH_STRENGTH_APPLY_SCALE;
      setSmoothBrushPreview({ channel, centerSec: point.t });
      const result = applySmoothBrushToSamples(
              current,
              durationSec,
              point.t,
              brushRangeSec,
              effectiveSmoothStrength,
              smoothFalloffSec,
              smoothFalloffCurve,
            );
      if (result.writeRange.endSampleIndex < result.writeRange.startSampleIndex)
        return;
      touchedRange = touchedRange
        ? {
            startSampleIndex: Math.min(
              touchedRange.startSampleIndex,
              result.writeRange.startSampleIndex,
            ),
            endSampleIndex: Math.max(
              touchedRange.endSampleIndex,
              result.writeRange.endSampleIndex,
            ),
          }
        : result.writeRange;
      scheduleClipDataRender({
        ...currentClip,
        dirty: true,
        channels: {
          ...currentClip.channels,
          [channel]: result.samples,
        },
      });
      queueDrawStrokeRange(
        clipIndex,
        channel,
        result.writeRange.startSampleIndex,
        result.writeRange.endSampleIndex,
      );
    };
    let latestPoint: Point = startPoint;
    const intervalMs = Math.max(
      4,
      Math.round(1000 / Math.max(5, smoothApplyRateHz)),
    );
    const timerId = window.setInterval(() => {
      commitBrushPoint(latestPoint);
    }, intervalMs);
    commitBrushPoint(startPoint);

    const onMove = (moveEvent: PointerEvent) => {
      const point = pointerToDrawPoint(
        svg,
        moveEvent.clientX,
        moveEvent.clientY,
        minV,
        maxV,
      );
      if (!point) return;
      latestPoint = point;
      setSmoothBrushPreview({ channel, centerSec: point.t });
    };
    const onUp = () => {
      clearInterval(timerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      setSmoothBrushPreview(null);
      clearDrawFlushTimer();
      flushPendingClipDataRender();
      void commitDrawStrokeSession();
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      clearInterval(timerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      setSmoothBrushPreview(null);
      clearDrawFlushTimer();
      drawWriteStateRef.current.queuedStartSampleIndex = null;
      drawWriteStateRef.current.queuedEndSampleIndex = null;
      scheduleClipDataRender({
        ...clipDataRef.current,
        dirty: baseDirty,
        channels: {
          ...clipDataRef.current.channels,
          [channel]: baseSamples,
        },
      });
      flushPendingClipDataRender();
      void cancelDrawStrokeSession();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKeyDown);
    return;
  }

  if (activeTool === "Line") {
    const baseSamples = (
      clipDataRef.current.channels[channel] ?? channelSamples
    ).slice();
    const anchoredStartPoint = lineSnapStart
      ? closestSamplePointToClientPoint(
          baseSamples,
          durationSec,
          minV,
          maxV,
          event.clientX,
          event.clientY,
          svg,
        )
      : startPoint;
    linePreviewStateRef.current = {
      active: true,
      clipIndex,
      channel,
      baseSamples,
      baseDirty: clipDataRef.current.dirty,
      startPoint: anchoredStartPoint,
      touchedRange: null,
    };

    const applyLinePreview = (
      point: Point,
      clientX: number,
      clientY: number,
    ) => {
      const lineState = linePreviewStateRef.current;
      const currentBase = lineState.baseSamples ?? baseSamples;
      const nextPoint = lineSnapEnd
        ? closestSamplePointToClientPoint(
            currentBase,
            durationSec,
            minV,
            maxV,
            clientX,
            clientY,
            svg,
          )
        : point;
      const delta = buildInterpolatedDrawDelta(
        currentBase.length,
        durationSec,
        anchoredStartPoint,
        nextPoint,
      );
      if (!delta) return;
      const nextChannel = applySampleDeltaToBuffer(currentBase, delta);
      const rangeStart = delta.startSampleIndex;
      const rangeEnd = delta.startSampleIndex + delta.values.length - 1;
      lineState.touchedRange = lineState.touchedRange
        ? {
            startSampleIndex: Math.min(
              lineState.touchedRange.startSampleIndex,
              rangeStart,
            ),
            endSampleIndex: Math.max(
              lineState.touchedRange.endSampleIndex,
              rangeEnd,
            ),
          }
        : {
            startSampleIndex: rangeStart,
            endSampleIndex: rangeEnd,
          };
      scheduleClipDataRender({
        ...clipDataRef.current,
        dirty: true,
        channels: {
          ...clipDataRef.current.channels,
          [channel]: nextChannel,
        },
      });
      queueDrawStrokeRange(clipIndex, channel, rangeStart, rangeEnd);
    };

    applyLinePreview(anchoredStartPoint, event.clientX, event.clientY);

    const finishLineSession = (applyEdit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      clearDrawFlushTimer();
      flushPendingClipDataRender();

      const lineState = linePreviewStateRef.current;
      const base = lineState.baseSamples;
      const baseDirty = lineState.baseDirty;
      const touchedRange = lineState.touchedRange;
      linePreviewStateRef.current = {
        active: false,
        clipIndex: -1,
        channel: "",
        baseSamples: null,
        baseDirty: false,
        startPoint: null,
        touchedRange: null,
      };

      if (!applyEdit) {
        if (base) {
          clearDrawFlushTimer();
          drawWriteStateRef.current.queuedStartSampleIndex = null;
          drawWriteStateRef.current.queuedEndSampleIndex = null;
          scheduleClipDataRender({
            ...clipDataRef.current,
            dirty: baseDirty,
            channels: {
              ...clipDataRef.current.channels,
              [channel]: base,
            },
          });
          if (touchedRange) {
            flushPendingClipDataRender();
            void cancelDrawStrokeSession();
          } else {
            void cancelDrawStrokeSession();
          }
        }
        return;
      }
      if (touchedRange) {
        flushPendingClipDataRender();
        void commitDrawStrokeSession();
      }
    };

    const onMove = (moveEvent: PointerEvent) => {
      const point = pointerToDrawPoint(
        svg,
        moveEvent.clientX,
        moveEvent.clientY,
        minV,
        maxV,
      );
      if (!point) return;
      applyLinePreview(point, moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = () => finishLineSession(true);
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        finishLineSession(false);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKeyDown);
    return;
  }

  let previousPoint: Point | null = null;
  const previewPoint = (point: Point) => {
    const currentClip = clipDataRef.current;
    const current = currentClip.channels[channel] ?? channelSamples;
    const delta = buildInterpolatedDrawDelta(
      current.length,
      durationSec,
      previousPoint ?? point,
      point,
    );
    if (!delta) return;
    const nextChannel = applySampleDeltaToBuffer(current, delta);
    const nextClip = {
      ...currentClip,
      dirty: true,
      channels: {
        ...currentClip.channels,
        [channel]: nextChannel,
      },
    };
    scheduleClipDataRender(nextClip);
    queueDrawStrokeRange(
      clipIndex,
      channel,
      delta.startSampleIndex,
      delta.startSampleIndex + delta.values.length - 1,
    );
    previousPoint = point;
  };

  previewPoint(startPoint);

  const onMove = (moveEvent: PointerEvent) => {
    const point = pointerToDrawPoint(
      svg,
      moveEvent.clientX,
      moveEvent.clientY,
      minV,
      maxV,
    );
    if (!point) return;
    previewPoint(point);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    clearDrawFlushTimer();
    flushPendingClipDataRender();
    void commitDrawStrokeSession();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
