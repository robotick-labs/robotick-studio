import React from "react";
import { sampleIndexRangeFromTimes } from "./anim-sample-editing";
import styles from "./AnimationEditorPage.module.css";
import { computeCenteredRangeShape } from "./tools/range/range-shape";

const LANE_VIEWBOX_WIDTH = 1000;
const LANE_CURVE_DRAW_HEIGHT = 34;
const MAX_DISPLAY_POINTS = 1200;
const RMB_TIMELINE_PAN_DRAG_THRESHOLD_PX = 4;

type LaneRange = { min: number; max: number };
type TimeSelectionRange = { startSec: number; endSec: number };

type LaneRowProps = {
  channel: string;
  samples: Float32Array;
  durationSec: number;
  range: LaneRange;
  color: string;
  isHovered: boolean;
  isSelected: boolean;
  drawActive: boolean;
  selectedTimeRange: TimeSelectionRange | null;
  rangeFalloffSec: number;
  smoothBrushPreview: { centerSec: number; coreRangeSec: number; falloffSec: number } | null;
  isFirstVisible: boolean;
  onHoverChange: (channel: string, hovered: boolean) => void;
  onSelect: (channel: string) => void;
  onRangeChange: (channel: string, next: LaneRange) => void;
  onFitRange: (channel: string) => void;
  onBeginDraw: (
    event: React.PointerEvent<SVGSVGElement>,
    channel: string,
    channelSamples: Float32Array,
    minV: number,
    maxV: number
  ) => void;
  onBeginRangeOffset: (
    event: React.PointerEvent<SVGElement>,
    channel: string,
    channelSamples: Float32Array,
    minV: number,
    maxV: number
  ) => void;
  onSmoothBrushPreviewChange: (channel: string, timeSec: number | null) => void;
  firstLaneSvgRef: React.RefObject<SVGSVGElement | null>;
  viewportRangeNorm: { startNorm: number; endNorm: number };
};

export function mapTimeSecToViewportX(
  timeSec: number,
  durationSec: number,
  viewportWidth: number
): number {
  const safeDuration = durationSec > 0 ? durationSec : 1;
  const safeWidth = Math.max(0, viewportWidth);
  const clampedTime = Math.min(safeDuration, Math.max(0, timeSec));
  return (clampedTime / safeDuration) * safeWidth;
}

export function buildDisplaySampleIndices(
  sampleCount: number,
  maxPoints: number = MAX_DISPLAY_POINTS
): number[] {
  if (sampleCount <= 0) return [];
  if (sampleCount <= maxPoints) {
    return Array.from({ length: sampleCount }, (_, i) => i);
  }
  const step = (sampleCount - 1) / (maxPoints - 1);
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(Math.min(sampleCount - 1, Math.round(i * step)));
  }
  return out;
}

function curvePath(
  samples: ArrayLike<number>,
  durationSec: number,
  width: number,
  height: number,
  minV: number,
  maxV: number,
  viewportRangeNorm: { startNorm: number; endNorm: number }
) {
  const sampleCount = samples.length ?? 0;
  if (!sampleCount || durationSec <= 0) return "";
  const span = Math.max(1e-6, maxV - minV);
  const startSampleIndex = Math.max(0, Math.min(sampleCount - 1, Math.floor(viewportRangeNorm.startNorm * (sampleCount - 1))));
  const endSampleIndex = Math.max(startSampleIndex, Math.min(sampleCount - 1, Math.ceil(viewportRangeNorm.endNorm * (sampleCount - 1))));
  const visibleSampleCount = endSampleIndex - startSampleIndex + 1;
  const indices = buildDisplaySampleIndices(visibleSampleCount).map((i) => startSampleIndex + i);
  let d = "";
  const last = Math.max(1, endSampleIndex - startSampleIndex);
  for (let i = 0; i < indices.length; i += 1) {
    const sourceIndex = indices[i];
    const x = ((sourceIndex - startSampleIndex) / last) * width;
    const value = Number(samples[sourceIndex] ?? 0);
    const y = height - ((value - minV) / span) * height;
    d += `${i === 0 ? "M" : " L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

function areaPath(
  samples: ArrayLike<number>,
  durationSec: number,
  width: number,
  height: number,
  minV: number,
  maxV: number,
  viewportRangeNorm: { startNorm: number; endNorm: number }
) {
  const sampleCount = samples.length ?? 0;
  if (!sampleCount || durationSec <= 0) return "";
  const span = Math.max(1e-6, maxV - minV);
  const startSampleIndex = Math.max(0, Math.min(sampleCount - 1, Math.floor(viewportRangeNorm.startNorm * (sampleCount - 1))));
  const endSampleIndex = Math.max(startSampleIndex, Math.min(sampleCount - 1, Math.ceil(viewportRangeNorm.endNorm * (sampleCount - 1))));
  const visibleSampleCount = endSampleIndex - startSampleIndex + 1;
  const indices = buildDisplaySampleIndices(visibleSampleCount).map((i) => startSampleIndex + i);
  let d = "";
  const last = Math.max(1, endSampleIndex - startSampleIndex);
  for (let i = 0; i < indices.length; i += 1) {
    const sourceIndex = indices[i];
    const x = ((sourceIndex - startSampleIndex) / last) * width;
    const value = Number(samples[sourceIndex] ?? 0);
    const y = height - ((value - minV) / span) * height;
    d += `${i === 0 ? "M" : " L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  d += ` L ${width.toFixed(2)} ${height.toFixed(2)} L 0.00 ${height.toFixed(2)} Z`;
  return d;
}

function formatAxisValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function normalizeTimeRange(durationSec: number, range: TimeSelectionRange | null) {
  if (!range || durationSec <= 0) return null;
  const startNorm = Math.min(1, Math.max(0, range.startSec / durationSec));
  const endNorm = Math.min(1, Math.max(0, range.endSec / durationSec));
  return {
    startNorm: Math.min(startNorm, endNorm),
    endNorm: Math.max(startNorm, endNorm),
  };
}

export function mapGlobalNormToViewportNorm(
  globalNorm: number,
  viewportRangeNorm: { startNorm: number; endNorm: number }
): number {
  const viewportWidthNorm = Math.max(
    1e-6,
    viewportRangeNorm.endNorm - viewportRangeNorm.startNorm
  );
  return (globalNorm - viewportRangeNorm.startNorm) / viewportWidthNorm;
}

export function normalizeTimeRangeToViewport(
  range: { startNorm: number; endNorm: number } | null,
  viewportRangeNorm: { startNorm: number; endNorm: number }
) {
  if (!range) return null;
  const startNorm = mapGlobalNormToViewportNorm(range.startNorm, viewportRangeNorm);
  const endNorm = mapGlobalNormToViewportNorm(range.endNorm, viewportRangeNorm);
  return {
    startNorm: Math.min(1, Math.max(0, Math.min(startNorm, endNorm))),
    endNorm: Math.min(1, Math.max(0, Math.max(startNorm, endNorm))),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function computeSampleRangeMean(
  samples: ArrayLike<number>,
  startSampleIndex: number,
  endSampleIndex: number
): number {
  const sampleCount = samples.length ?? 0;
  if (sampleCount <= 0 || endSampleIndex < startSampleIndex) return 0;
  const start = Math.max(0, startSampleIndex);
  const end = Math.min(sampleCount - 1, endSampleIndex);
  let sum = 0;
  let count = 0;
  for (let i = start; i <= end; i += 1) {
    sum += Number(samples[i] ?? 0);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

const LaneRow = React.memo(function LaneRow({
  channel,
  samples,
  durationSec,
  range,
  color,
  isHovered,
  isSelected,
  drawActive,
  selectedTimeRange,
  rangeFalloffSec,
  smoothBrushPreview,
  isFirstVisible,
  onHoverChange,
  onSelect,
  onRangeChange,
  onFitRange,
  onBeginDraw,
  onBeginRangeOffset,
  onSmoothBrushPreviewChange,
  firstLaneSvgRef,
  viewportRangeNorm,
}: LaneRowProps) {
  const minV = range.min;
  const maxV = range.max;
  const [draftMax, setDraftMax] = React.useState(() => formatAxisValue(maxV));
  const [draftMin, setDraftMin] = React.useState(() => formatAxisValue(minV));
  const handleOverlayRef = React.useRef<SVGSVGElement | null>(null);
  const [handleOverlaySize, setHandleOverlaySize] = React.useState({
    width: 1,
    height: 1,
  });

  React.useEffect(() => setDraftMax(formatAxisValue(maxV)), [maxV]);
  React.useEffect(() => setDraftMin(formatAxisValue(minV)), [minV]);
  React.useLayoutEffect(() => {
    const overlay = handleOverlayRef.current;
    if (!overlay) return;
    const measure = () => {
      const rect = overlay.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setHandleOverlaySize({
        width: rect.width,
        height: rect.height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(overlay);
    return () => observer.disconnect();
  }, []);

  const areaD = React.useMemo(
    () => areaPath(samples, durationSec, 1000, 34, minV, maxV, viewportRangeNorm),
    [samples, durationSec, minV, maxV, viewportRangeNorm]
  );
  const curveD = React.useMemo(
    () => curvePath(samples, durationSec, 1000, 34, minV, maxV, viewportRangeNorm),
    [samples, durationSec, minV, maxV, viewportRangeNorm]
  );
  const normalizedTimeRange = React.useMemo(
    () => normalizeTimeRange(durationSec, selectedTimeRange),
    [durationSec, selectedTimeRange]
  );
  const viewportNormalizedTimeRange = React.useMemo(
    () => normalizeTimeRangeToViewport(normalizedTimeRange, viewportRangeNorm),
    [normalizedTimeRange, viewportRangeNorm]
  );
  const totalTimeRangeShape = React.useMemo(
    () =>
      normalizedTimeRange
        ? computeCenteredRangeShape(
            normalizedTimeRange.startNorm * durationSec,
            normalizedTimeRange.endNorm * durationSec,
            rangeFalloffSec
          )
        : null,
    [durationSec, normalizedTimeRange, rangeFalloffSec]
  );
  const selectedSampleRange = React.useMemo(
    () =>
      totalTimeRangeShape
        ? sampleIndexRangeFromTimes(
            samples.length,
            durationSec,
            totalTimeRangeShape.coreStart,
            totalTimeRangeShape.coreEnd
          )
        : null,
    [durationSec, samples.length, totalTimeRangeShape]
  );

  const rangeOverlay = React.useMemo(() => {
    if (!selectedSampleRange || !normalizedTimeRange || !viewportNormalizedTimeRange) return null;
    const totalShape = computeCenteredRangeShape(
      viewportNormalizedTimeRange.startNorm,
      viewportNormalizedTimeRange.endNorm,
      rangeFalloffSec
    );
    const meanValue = computeSampleRangeMean(
      samples,
      selectedSampleRange.startSampleIndex,
      selectedSampleRange.endSampleIndex
    );
    const span = Math.max(1e-6, maxV - minV);
    const yNorm = (maxV - meanValue) / span;
    return {
      falloffLeftX: totalShape.start * LANE_VIEWBOX_WIDTH,
      falloffLeftWidth: Math.max(
        0,
        (totalShape.coreStart - totalShape.start) * LANE_VIEWBOX_WIDTH
      ),
      bandX: totalShape.coreStart * LANE_VIEWBOX_WIDTH,
      bandWidth: Math.max(
        3,
        (totalShape.coreEnd - totalShape.coreStart) * LANE_VIEWBOX_WIDTH
      ),
      falloffRightX: totalShape.coreEnd * LANE_VIEWBOX_WIDTH,
      falloffRightWidth: Math.max(
        0,
        (totalShape.end - totalShape.coreEnd) * LANE_VIEWBOX_WIDTH
      ),
      handleCx: totalShape.midpoint * LANE_VIEWBOX_WIDTH,
      handleCy: Math.min(
        LANE_CURVE_DRAW_HEIGHT,
        Math.max(0, yNorm * LANE_CURVE_DRAW_HEIGHT)
      ),
    };
  }, [
    durationSec,
    maxV,
    minV,
    normalizedTimeRange,
    rangeFalloffSec,
    samples,
    selectedSampleRange,
    viewportNormalizedTimeRange,
  ]);
  const rangeHandleOverlay = React.useMemo(() => {
    if (!rangeOverlay) return null;
    return {
      cx: clamp01(rangeOverlay.handleCx / LANE_VIEWBOX_WIDTH) * handleOverlaySize.width,
      cy: clamp01(rangeOverlay.handleCy / LANE_CURVE_DRAW_HEIGHT) * handleOverlaySize.height,
    };
  }, [handleOverlaySize.height, handleOverlaySize.width, rangeOverlay]);

  const smoothOverlay = React.useMemo(() => {
    if (!smoothBrushPreview || durationSec <= 0) return null;
    const centerNorm = Math.min(
      1,
      Math.max(0, smoothBrushPreview.centerSec / durationSec)
    );
    const halfCoreNorm = Math.min(
      0.5,
      Math.max(0, (smoothBrushPreview.coreRangeSec * 0.5) / durationSec)
    );
    const falloffNorm = Math.min(
      1,
      Math.max(0, smoothBrushPreview.falloffSec / durationSec)
    );
    const coreStartNorm = Math.max(0, centerNorm - halfCoreNorm);
    const coreEndNorm = Math.min(1, centerNorm + halfCoreNorm);
    const falloffStartNorm = Math.max(0, coreStartNorm - falloffNorm);
    const falloffEndNorm = Math.min(1, coreEndNorm + falloffNorm);
    return {
      falloffLeftX: falloffStartNorm * LANE_VIEWBOX_WIDTH,
      falloffLeftWidth: Math.max(
        0,
        (coreStartNorm - falloffStartNorm) * LANE_VIEWBOX_WIDTH
      ),
      bandX: coreStartNorm * LANE_VIEWBOX_WIDTH,
      bandWidth: Math.max(
        3,
        (coreEndNorm - coreStartNorm) * LANE_VIEWBOX_WIDTH
      ),
      falloffRightX: coreEndNorm * LANE_VIEWBOX_WIDTH,
      falloffRightWidth: Math.max(
        0,
        (falloffEndNorm - coreEndNorm) * LANE_VIEWBOX_WIDTH
      ),
      centerX: centerNorm * LANE_VIEWBOX_WIDTH,
    };
  }, [durationSec, smoothBrushPreview]);

  const commitMax = React.useCallback(() => {
    const value = Number(draftMax);
    if (!Number.isFinite(value) || value <= minV) {
      setDraftMax(formatAxisValue(maxV));
      return;
    }
    onRangeChange(channel, { min: minV, max: value });
  }, [channel, draftMax, maxV, minV, onRangeChange]);

  const commitMin = React.useCallback(() => {
    const value = Number(draftMin);
    if (!Number.isFinite(value) || value >= maxV) {
      setDraftMin(formatAxisValue(minV));
      return;
    }
    onRangeChange(channel, { min: value, max: maxV });
  }, [channel, draftMin, maxV, minV, onRangeChange]);

  return (
    <div
      className={[
        styles.laneRow,
        isHovered ? styles.laneRowHovered : "",
        isSelected ? styles.laneRowSelected : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={() => onHoverChange(channel, true)}
      onMouseLeave={() => onHoverChange(channel, false)}
      onClick={() => onSelect(channel)}
    >
      <div className={styles.laneAxis}>
        <input
          className={styles.laneAxisInput}
          value={draftMax}
          onChange={(event) => setDraftMax(event.target.value)}
          onBlur={commitMax}
          title="Channel Y max"
        />
        <input
          className={styles.laneAxisInput}
          value={draftMin}
          onChange={(event) => setDraftMin(event.target.value)}
          onBlur={commitMin}
          title="Channel Y min"
        />
      </div>
      <div
        className={[styles.laneTrack, drawActive ? styles.laneTrackDrawActive : ""]
          .filter(Boolean)
          .join(" ")}
        data-lane-track="true"
      >
        <div className={styles.laneChannelOverlay}>{channel}</div>
        <button
          className={styles.laneFitButton}
          type="button"
          title="Fit Y for this channel"
          onClick={() => onFitRange(channel)}
        >
          Fit Y
        </button>
        <svg
          ref={isFirstVisible ? firstLaneSvgRef : undefined}
          className={styles.laneSvg}
          viewBox="0 0 1000 40"
          preserveAspectRatio="none"
          aria-hidden="true"
          onPointerDown={(event) => onBeginDraw(event, channel, samples, minV, maxV)}
          onPointerMove={(event) => {
            if ((event.buttons & 2) !== 0) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (rect.width <= 0) return;
            const timeSec =
              Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) *
              durationSec;
            onSmoothBrushPreviewChange(channel, timeSec);
          }}
          onPointerLeave={() => onSmoothBrushPreviewChange(channel, null)}
        >
          {smoothOverlay && smoothOverlay.falloffLeftWidth > 0 ? (
            <rect
              x={smoothOverlay.falloffLeftX}
              y={0}
              width={smoothOverlay.falloffLeftWidth}
              height={LANE_CURVE_DRAW_HEIGHT}
              className={styles.smoothBrushFalloffBandLane}
            />
          ) : null}
          {smoothOverlay ? (
            <rect
              x={smoothOverlay.bandX}
              y={0}
              width={smoothOverlay.bandWidth}
              height={LANE_CURVE_DRAW_HEIGHT}
              className={styles.smoothBrushCoreBandLane}
            />
          ) : null}
          {smoothOverlay && smoothOverlay.falloffRightWidth > 0 ? (
            <rect
              x={smoothOverlay.falloffRightX}
              y={0}
              width={smoothOverlay.falloffRightWidth}
              height={LANE_CURVE_DRAW_HEIGHT}
              className={styles.smoothBrushFalloffBandLane}
            />
          ) : null}
          {smoothOverlay ? (
            <line
              x1={smoothOverlay.centerX}
              y1={0}
              x2={smoothOverlay.centerX}
              y2={LANE_CURVE_DRAW_HEIGHT}
              className={styles.smoothBrushCenterLineLane}
            />
          ) : null}
          {rangeOverlay && rangeOverlay.falloffLeftWidth > 0 ? (
            <rect
              x={rangeOverlay.falloffLeftX}
              y={0}
              width={rangeOverlay.falloffLeftWidth}
              height={LANE_CURVE_DRAW_HEIGHT}
              className={styles.rangeFalloffBandLane}
            />
          ) : null}
          {rangeOverlay ? (
            <rect
              x={rangeOverlay.bandX}
              y={0}
              width={rangeOverlay.bandWidth}
              height={LANE_CURVE_DRAW_HEIGHT}
              className={styles.rangeSelectionBandLane}
            />
          ) : null}
          {rangeOverlay && rangeOverlay.falloffRightWidth > 0 ? (
            <rect
              x={rangeOverlay.falloffRightX}
              y={0}
              width={rangeOverlay.falloffRightWidth}
              height={LANE_CURVE_DRAW_HEIGHT}
              className={styles.rangeFalloffBandLane}
            />
          ) : null}
          <path d={areaD} className={styles.laneArea} style={{ fill: color }} />
          <path d={curveD} className={styles.laneCurve} style={{ stroke: color }} />
        </svg>
        <svg
          ref={handleOverlayRef}
          className={styles.laneHandleOverlaySvg}
          viewBox={`0 0 ${Math.max(1, handleOverlaySize.width)} ${Math.max(1, handleOverlaySize.height)}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {rangeHandleOverlay ? (
            <g
              className={styles.rangeOffsetHandle}
              transform={`translate(${rangeHandleOverlay.cx.toFixed(2)} ${rangeHandleOverlay.cy.toFixed(2)})`}
              onPointerDown={(event) => onBeginRangeOffset(event, channel, samples, minV, maxV)}
            >
              <rect
                x={-7}
                y={-15}
                width={14}
                height={30}
                rx={7}
                ry={7}
                className={styles.rangeOffsetHandleBody}
              />
              <path
                d="M 0 -10.5 L 3.5 -7 M 0 -10.5 L -3.5 -7 M 0 -10.5 L 0 10.5 M 0 10.5 L 3.5 7 M 0 10.5 L -3.5 7"
                className={styles.rangeOffsetHandleGlyph}
              />
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
});

type AnimationTimelineViewportProps = {
  timelineRef: React.RefObject<HTMLDivElement | null>;
  topRulerRef: React.RefObject<HTMLDivElement | null>;
  bottomRulerRef: React.RefObject<HTMLDivElement | null>;
  playheadViewportRef: React.RefObject<HTMLDivElement | null>;
  firstLaneSvgRef: React.RefObject<SVGSVGElement | null>;
  visibleChannels: string[];
  clipDataChannels: Record<string, Float32Array>;
  durationSec: number;
  laneRange: Record<string, LaneRange>;
  defaultLaneRangeForChannel: (channel: string, samples: ArrayLike<number>) => LaneRange;
  channelColor: Record<string, string>;
  hoveredChannel: string | null;
  selectedChannel: string | null;
  activeTool: "Pencil" | "Line" | "Range" | "Smooth" | null;
  selectedTimeRange: TimeSelectionRange | null;
  rangeFalloffSec: number;
  smoothBrushPreview: { channel: string; centerSec: number } | null;
  smoothRangeSec: number;
  smoothFalloffSec: number;
  handleLaneHoverChange: (channel: string, hovered: boolean) => void;
  handleLaneSelect: (channel: string) => void;
  setLaneRangeForChannel: (channel: string, nextRange: LaneRange) => void;
  fitLaneRangeForChannel: (channel: string) => void;
  beginDrawStroke: (
    event: React.PointerEvent<SVGSVGElement>,
    channel: string,
    channelSamples: Float32Array,
    minV: number,
    maxV: number
  ) => void;
  beginRangeOffset: (
    event: React.PointerEvent<SVGElement>,
    channel: string,
    channelSamples: Float32Array,
    minV: number,
    maxV: number
  ) => void;
  handleSmoothBrushPreviewChange: (channel: string, timeSec: number | null) => void;
  playheadViewportInsetsPx: { left: number; right: number };
  overlayWidth: number;
  playheadOverlayMetrics: {
    width: number;
    height: number;
    topRulerHeight: number;
    bottomRulerTop: number;
    bottomRulerHeight: number;
    topBlobCenterY: number;
    bottomBlobCenterY: number;
  };
  beginRangeSelection: (event: React.PointerEvent<Element>) => void;
  normalizedSelectedTimeRange: { startNorm: number; endNorm: number } | null;
  normalizedSelectionFalloff: number;
  isLoopResetActive: boolean;
  loopResetSlugRangeNorm: { left: number; right: number };
  rulerMarks: { norm: number; label: string }[];
  playheadTimeSec: number;
  beginPlayheadDragFromClientX: (clientX: number) => void;
  viewportRangeNorm: { startNorm: number; endNorm: number };
  onViewportRangeNormChange: (next: { startNorm: number; endNorm: number }) => void;
};

type LaneListProps = {
  firstLaneSvgRef: React.RefObject<SVGSVGElement | null>;
  visibleChannels: string[];
  clipDataChannels: Record<string, Float32Array>;
  durationSec: number;
  laneRange: Record<string, LaneRange>;
  defaultLaneRangeForChannel: (channel: string, samples: ArrayLike<number>) => LaneRange;
  channelColor: Record<string, string>;
  hoveredChannel: string | null;
  selectedChannel: string | null;
  activeTool: "Pencil" | "Line" | "Range" | "Smooth" | null;
  selectedTimeRange: TimeSelectionRange | null;
  rangeFalloffSec: number;
  smoothBrushPreview: { channel: string; centerSec: number } | null;
  smoothRangeSec: number;
  smoothFalloffSec: number;
  handleLaneHoverChange: (channel: string, hovered: boolean) => void;
  handleLaneSelect: (channel: string) => void;
  setLaneRangeForChannel: (channel: string, nextRange: LaneRange) => void;
  fitLaneRangeForChannel: (channel: string) => void;
  beginDrawStroke: (
    event: React.PointerEvent<SVGSVGElement>,
    channel: string,
    channelSamples: Float32Array,
    minV: number,
    maxV: number
  ) => void;
  beginRangeOffset: (
    event: React.PointerEvent<SVGElement>,
    channel: string,
    channelSamples: Float32Array,
    minV: number,
    maxV: number
  ) => void;
  handleSmoothBrushPreviewChange: (channel: string, timeSec: number | null) => void;
  viewportRangeNorm: { startNorm: number; endNorm: number };
};

const LaneList = React.memo(function LaneList({
  firstLaneSvgRef,
  visibleChannels,
  clipDataChannels,
  durationSec,
  laneRange,
  defaultLaneRangeForChannel,
  channelColor,
  hoveredChannel,
  selectedChannel,
  activeTool,
  selectedTimeRange,
  rangeFalloffSec,
  smoothBrushPreview,
  smoothRangeSec,
  smoothFalloffSec,
  handleLaneHoverChange,
  handleLaneSelect,
  setLaneRangeForChannel,
  fitLaneRangeForChannel,
  beginDrawStroke,
  beginRangeOffset,
  handleSmoothBrushPreviewChange,
  viewportRangeNorm,
}: LaneListProps) {
  return (
    <div className={styles.lanes}>
      {visibleChannels.map((channel) => {
        const samples = clipDataChannels[channel] ?? new Float32Array(0);
        return (
          <LaneRow
            key={channel}
            channel={channel}
            samples={samples}
            durationSec={durationSec}
            range={laneRange[channel] ?? defaultLaneRangeForChannel(channel, samples)}
            color={channelColor[channel] ?? "#77ceff"}
            isHovered={hoveredChannel === channel}
            isSelected={selectedChannel === channel}
            drawActive={activeTool !== null}
            selectedTimeRange={activeTool === "Range" ? selectedTimeRange : null}
            rangeFalloffSec={activeTool === "Range" ? rangeFalloffSec : 0}
            smoothBrushPreview={
              activeTool === "Smooth" && smoothBrushPreview?.channel === channel
                ? {
                    centerSec: smoothBrushPreview.centerSec,
                    coreRangeSec: smoothRangeSec,
                    falloffSec: smoothFalloffSec,
                  }
                : null
            }
            isFirstVisible={visibleChannels[0] === channel}
            onHoverChange={handleLaneHoverChange}
            onSelect={handleLaneSelect}
            onRangeChange={setLaneRangeForChannel}
            onFitRange={fitLaneRangeForChannel}
            onBeginDraw={beginDrawStroke}
            onBeginRangeOffset={beginRangeOffset}
            onSmoothBrushPreviewChange={handleSmoothBrushPreviewChange}
            firstLaneSvgRef={firstLaneSvgRef}
            viewportRangeNorm={viewportRangeNorm}
          />
        );
      })}
    </div>
  );
});

type PlayheadOverlayProps = {
  playheadViewportRef: React.RefObject<HTMLDivElement | null>;
  playheadViewportInsetsPx: { left: number; right: number };
  overlayWidth: number;
  playheadOverlayMetrics: {
    width: number;
    height: number;
    topRulerHeight: number;
    bottomRulerTop: number;
    bottomRulerHeight: number;
    topBlobCenterY: number;
    bottomBlobCenterY: number;
  };
  beginRangeSelection: (event: React.PointerEvent<Element>) => void;
  normalizedSelectedTimeRange: { startNorm: number; endNorm: number } | null;
  normalizedSelectionFalloff: number;
  isLoopResetActive: boolean;
  loopResetSlugRangeNorm: { left: number; right: number };
  rulerMarks: { norm: number; label: string }[];
  durationSec: number;
  activeTool: "Pencil" | "Line" | "Range" | "Smooth" | null;
  playheadTimeSec: number;
  beginPlayheadDragFromClientX: (clientX: number) => void;
  viewportRangeNorm: { startNorm: number; endNorm: number };
};

const PlayheadOverlay = React.memo(function PlayheadOverlay({
  playheadViewportRef,
  playheadViewportInsetsPx,
  overlayWidth,
  playheadOverlayMetrics,
  beginRangeSelection,
  normalizedSelectedTimeRange,
  normalizedSelectionFalloff,
  isLoopResetActive,
  loopResetSlugRangeNorm,
  rulerMarks,
  durationSec,
  activeTool,
  playheadTimeSec,
  beginPlayheadDragFromClientX,
  viewportRangeNorm,
}: PlayheadOverlayProps) {
  const lineRef = React.useRef<SVGLineElement | null>(null);
  const topBlobRef = React.useRef<SVGRectElement | null>(null);
  const bottomBlobRef = React.useRef<SVGRectElement | null>(null);
  const grabRef = React.useRef<SVGRectElement | null>(null);
  const viewportWidthNorm = Math.max(1e-3, viewportRangeNorm.endNorm - viewportRangeNorm.startNorm);
  const toViewportNormUnclamped = React.useCallback(
    (globalNorm: number) =>
      mapGlobalNormToViewportNorm(globalNorm, viewportRangeNorm),
    [viewportRangeNorm]
  );
  const viewportSelectedTimeRange = React.useMemo(
    () =>
      normalizeTimeRangeToViewport(
        normalizedSelectedTimeRange,
        viewportRangeNorm
      ),
    [normalizedSelectedTimeRange, viewportRangeNorm]
  );
  React.useLayoutEffect(() => {
    const playheadNorm = durationSec > 0 ? Math.min(1, Math.max(0, playheadTimeSec / durationSec)) : 0;
    const x = toViewportNormUnclamped(playheadNorm) * overlayWidth;
    if (lineRef.current) {
      lineRef.current.setAttribute("x1", x.toFixed(2));
      lineRef.current.setAttribute("x2", x.toFixed(2));
    }
    if (topBlobRef.current) {
      topBlobRef.current.setAttribute("x", (x - 5).toFixed(2));
    }
    if (bottomBlobRef.current) {
      bottomBlobRef.current.setAttribute("x", (x - 5).toFixed(2));
    }
    if (grabRef.current) {
      grabRef.current.setAttribute("x", (x - 9).toFixed(2));
    }
  }, [durationSec, overlayWidth, playheadTimeSec, toViewportNormUnclamped]);
  return (
    <div
      ref={playheadViewportRef}
      className={styles.playheadViewport}
      style={{
        left: `${playheadViewportInsetsPx.left}px`,
        right: `${playheadViewportInsetsPx.right}px`,
      }}
    >
      <svg className={styles.playheadOverlaySvg} viewBox={`0 0 ${overlayWidth} ${playheadOverlayMetrics.height}`} preserveAspectRatio="none" aria-hidden="true">
        <rect x={0} y={0} width={overlayWidth} height={playheadOverlayMetrics.topRulerHeight} className={activeTool === "Range" ? styles.rulerHitRectActive : styles.rulerHitRect} onPointerDown={beginRangeSelection} />
        {viewportSelectedTimeRange ? (() => {
          const totalShape = computeCenteredRangeShape(
            viewportSelectedTimeRange.startNorm,
            viewportSelectedTimeRange.endNorm,
            normalizedSelectionFalloff
          );
          return (
            <>
              {totalShape.coreStart > totalShape.start ? (
                <rect
                  x={totalShape.start * overlayWidth}
                  y={2}
                  width={Math.max(0, (totalShape.coreStart - totalShape.start) * overlayWidth)}
                  height={Math.max(8, playheadOverlayMetrics.topRulerHeight - 4)}
                  className={styles.rangeFalloffBandRuler}
                />
              ) : null}
              <rect
                x={totalShape.coreStart * overlayWidth}
                y={2}
                width={Math.max(3, (totalShape.coreEnd - totalShape.coreStart) * overlayWidth)}
                height={Math.max(8, playheadOverlayMetrics.topRulerHeight - 4)}
                className={styles.rangeSelectionBandRuler}
              />
              {totalShape.end > totalShape.coreEnd ? (
                <rect
                  x={totalShape.coreEnd * overlayWidth}
                  y={2}
                  width={Math.max(0, (totalShape.end - totalShape.coreEnd) * overlayWidth)}
                  height={Math.max(8, playheadOverlayMetrics.topRulerHeight - 4)}
                  className={styles.rangeFalloffBandRuler}
                />
              ) : null}
            </>
          );
        })() : null}
        {isLoopResetActive ? (
          <rect x={Math.max(0, Math.min(overlayWidth, loopResetSlugRangeNorm.left * overlayWidth))} y={2} width={Math.max(0, Math.min(overlayWidth, loopResetSlugRangeNorm.right * overlayWidth) - Math.max(0, Math.min(overlayWidth, loopResetSlugRangeNorm.left * overlayWidth)))} height={5} className={styles.loopResetSlugSvg} />
        ) : null}
        {rulerMarks.map((mark, index) => (
          <text key={`top-${index}`} x={mark.norm * overlayWidth} y={Math.max(12, playheadOverlayMetrics.topRulerHeight - 9)} className={styles.rulerMarkSvg} textAnchor={index === 0 ? "start" : index === rulerMarks.length - 1 ? "end" : "middle"}>
            {`${(durationSec * (viewportRangeNorm.startNorm + mark.norm * viewportWidthNorm)).toFixed(1)}s`}
          </text>
        ))}
        {rulerMarks.map((mark, index) => (
          <text key={`bottom-${index}`} x={mark.norm * overlayWidth} y={Math.max(playheadOverlayMetrics.bottomRulerTop + 12, playheadOverlayMetrics.bottomRulerTop + playheadOverlayMetrics.bottomRulerHeight - 9)} className={styles.rulerMarkSvg} textAnchor={index === 0 ? "start" : index === rulerMarks.length - 1 ? "end" : "middle"}>
            {`${(durationSec * (viewportRangeNorm.startNorm + mark.norm * viewportWidthNorm)).toFixed(1)}s`}
          </text>
        ))}
        <line ref={lineRef} data-testid="timeline-playhead-line" x1={0} x2={0} y1={playheadOverlayMetrics.topBlobCenterY} y2={playheadOverlayMetrics.bottomBlobCenterY} className={`${styles.playheadLineSvg} ${activeTool !== null ? styles.playheadLineMutedSvg : ""}`} />
        <rect ref={topBlobRef} x={-5} y={playheadOverlayMetrics.topBlobCenterY - 6} width={10} height={12} rx={4} ry={4} className={styles.rulerEndBlobSvg} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); beginPlayheadDragFromClientX(event.clientX); }} />
        <rect ref={bottomBlobRef} x={-5} y={playheadOverlayMetrics.bottomBlobCenterY - 6} width={10} height={12} rx={4} ry={4} className={styles.rulerEndBlobSvg} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); beginPlayheadDragFromClientX(event.clientX); }} />
        {activeTool === null ? (
          <rect ref={grabRef} x={-9} y={playheadOverlayMetrics.topBlobCenterY} width={18} height={Math.max(0, playheadOverlayMetrics.bottomBlobCenterY - playheadOverlayMetrics.topBlobCenterY)} className={styles.playheadGrabSvg} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); beginPlayheadDragFromClientX(event.clientX); }} />
        ) : null}
      </svg>
    </div>
  );
});

export function AnimationTimelineViewport(props: AnimationTimelineViewportProps) {
  const {
    timelineRef,
    topRulerRef,
    bottomRulerRef,
    playheadViewportRef,
    firstLaneSvgRef,
    visibleChannels,
    clipDataChannels,
    durationSec,
    laneRange,
    defaultLaneRangeForChannel,
    channelColor,
    hoveredChannel,
    selectedChannel,
    activeTool,
    selectedTimeRange,
    rangeFalloffSec,
    smoothBrushPreview,
    smoothRangeSec,
    smoothFalloffSec,
    handleLaneHoverChange,
    handleLaneSelect,
    setLaneRangeForChannel,
    fitLaneRangeForChannel,
    beginDrawStroke,
    beginRangeOffset,
    handleSmoothBrushPreviewChange,
    playheadViewportInsetsPx,
    overlayWidth,
    playheadOverlayMetrics,
    beginRangeSelection,
    normalizedSelectedTimeRange,
    normalizedSelectionFalloff,
    isLoopResetActive,
    loopResetSlugRangeNorm,
    rulerMarks,
    playheadTimeSec,
    beginPlayheadDragFromClientX,
    viewportRangeNorm,
    onViewportRangeNormChange,
  } = props;

  const scrollbarTrackRef = React.useRef<HTMLDivElement | null>(null);
  const [isTimelinePanActive, setIsTimelinePanActive] = React.useState(false);
  const timelinePanListenersRef = React.useRef<{
    mousemove: (event: MouseEvent) => void;
    mouseup: (event: MouseEvent) => void;
    blur: () => void;
    contextmenu: (event: MouseEvent) => void;
  } | null>(null);
  const timelinePanStateRef = React.useRef<{
    startX: number;
    startStartNorm: number;
    startEndNorm: number;
    widthPx: number;
    isActive: boolean;
    previousBodyUserSelect: string;
    previousBodyCursor: string;
  } | null>(null);

  const detachTimelinePanListeners = React.useCallback(() => {
    const listeners = timelinePanListenersRef.current;
    if (!listeners) {
      return;
    }
    window.removeEventListener("mousemove", listeners.mousemove);
    window.removeEventListener("mouseup", listeners.mouseup);
    window.removeEventListener("blur", listeners.blur);
    window.removeEventListener("contextmenu", listeners.contextmenu);
    timelinePanListenersRef.current = null;
  }, []);

  const finishTimelinePan = React.useCallback(
    (updateState = true) => {
      detachTimelinePanListeners();
      const panState = timelinePanStateRef.current;
      if (panState?.isActive) {
        timelineRef.current?.removeAttribute("data-suppress-panel-rmb-menu");
        document.body.style.userSelect = panState.previousBodyUserSelect;
        document.body.style.cursor = panState.previousBodyCursor;
      }
      timelinePanStateRef.current = null;
      if (updateState) {
        setIsTimelinePanActive(false);
      }
    },
    [detachTimelinePanListeners]
  );

  React.useEffect(() => () => finishTimelinePan(false), [finishTimelinePan]);

  const beginTimelinePan = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 2) {
        return;
      }
      const timelineElement = timelineRef.current;
      if (!timelineElement) {
        return;
      }
      const rect = timelineElement.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      timelinePanStateRef.current = {
        startX: event.clientX,
        startStartNorm: viewportRangeNorm.startNorm,
        startEndNorm: viewportRangeNorm.endNorm,
        widthPx: rect.width,
        isActive: false,
        previousBodyUserSelect: document.body.style.userSelect,
        previousBodyCursor: document.body.style.cursor,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const panState = timelinePanStateRef.current;
        if (!panState) {
          return;
        }
        const dx = moveEvent.clientX - panState.startX;
        if (!panState.isActive) {
          if (Math.abs(dx) < RMB_TIMELINE_PAN_DRAG_THRESHOLD_PX) {
            return;
          }
          panState.isActive = true;
          timelineRef.current?.setAttribute("data-suppress-panel-rmb-menu", "active");
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
          setIsTimelinePanActive(true);
        }
        moveEvent.preventDefault();
        const widthNorm = Math.max(0.02, panState.startEndNorm - panState.startStartNorm);
        const deltaNorm = (dx / Math.max(1, panState.widthPx)) * widthNorm;
        const nextStartNorm = Math.min(
          1 - widthNorm,
          Math.max(0, panState.startStartNorm - deltaNorm)
        );
        onViewportRangeNormChange({
          startNorm: nextStartNorm,
          endNorm: nextStartNorm + widthNorm,
        });
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        if (timelinePanStateRef.current?.isActive) {
          upEvent.preventDefault();
        }
        finishTimelinePan();
      };

      const handleWindowBlur = () => {
        finishTimelinePan();
      };

      const handleWindowContextMenu = (contextMenuEvent: MouseEvent) => {
        if (timelinePanStateRef.current?.isActive) {
          contextMenuEvent.preventDefault();
        }
      };

      timelinePanListenersRef.current = {
        mousemove: handleMouseMove,
        mouseup: handleMouseUp,
        blur: handleWindowBlur,
        contextmenu: handleWindowContextMenu,
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("blur", handleWindowBlur);
      window.addEventListener("contextmenu", handleWindowContextMenu);
    },
    [
      finishTimelinePan,
      onViewportRangeNormChange,
      timelineRef,
      viewportRangeNorm.endNorm,
      viewportRangeNorm.startNorm,
    ]
  );

  const beginScrollbarDrag = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const track = scrollbarTrackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pointerNorm = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const startLeft = viewportRangeNorm.startNorm;
      const startRight = viewportRangeNorm.endNorm;
      const widthNorm = Math.max(0.02, startRight - startLeft);
      const edgeThreshold = Math.min(0.03, widthNorm * 0.35);
      const mode: "pan" | "left" | "right" =
        Math.abs(pointerNorm - startLeft) <= edgeThreshold
          ? "left"
          : Math.abs(pointerNorm - startRight) <= edgeThreshold
            ? "right"
            : "pan";
      const startPointer = pointerNorm;
      const onMove = (moveEvent: PointerEvent) => {
        const moveNorm = Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width));
        const delta = moveNorm - startPointer;
        if (mode === "pan") {
          const nextLeft = Math.min(1 - widthNorm, Math.max(0, startLeft + delta));
          onViewportRangeNormChange({ startNorm: nextLeft, endNorm: nextLeft + widthNorm });
          return;
        }
        if (mode === "left") {
          const nextLeft = Math.min(startRight - 0.02, Math.max(0, startLeft + delta));
          onViewportRangeNormChange({ startNorm: nextLeft, endNorm: startRight });
          return;
        }
        const nextRight = Math.max(startLeft + 0.02, Math.min(1, startRight + delta));
        onViewportRangeNormChange({ startNorm: startLeft, endNorm: nextRight });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onViewportRangeNormChange, viewportRangeNorm.endNorm, viewportRangeNorm.startNorm]
  );

  return (
    <main className={styles.timelineArea}>
      <section
        ref={timelineRef}
        className={styles.timelineCanvas}
        aria-label="Animation timeline"
        onMouseDownCapture={beginTimelinePan}
        onContextMenu={(event) => {
          if (isTimelinePanActive) {
            event.preventDefault();
          }
        }}
      >
        <div ref={topRulerRef} className={styles.timeRuler} />
        <LaneList
          firstLaneSvgRef={firstLaneSvgRef}
          visibleChannels={visibleChannels}
          clipDataChannels={clipDataChannels}
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
          smoothRangeSec={smoothRangeSec}
          smoothFalloffSec={smoothFalloffSec}
          handleLaneHoverChange={handleLaneHoverChange}
          handleLaneSelect={handleLaneSelect}
          setLaneRangeForChannel={setLaneRangeForChannel}
          fitLaneRangeForChannel={fitLaneRangeForChannel}
          beginDrawStroke={beginDrawStroke}
          beginRangeOffset={beginRangeOffset}
          handleSmoothBrushPreviewChange={handleSmoothBrushPreviewChange}
          viewportRangeNorm={viewportRangeNorm}
        />
        <div ref={bottomRulerRef} className={styles.timeRulerBottom} />
        <div
          ref={scrollbarTrackRef}
          className={styles.timelineWindowScrollbar}
          onPointerDown={beginScrollbarDrag}
          title="Drag center to pan; drag left/right edges to zoom visible range."
        >
          <div
            className={styles.timelineWindowThumb}
            style={{
              left: `${viewportRangeNorm.startNorm * 100}%`,
              width: `${Math.max(2, (viewportRangeNorm.endNorm - viewportRangeNorm.startNorm) * 100)}%`,
            }}
          >
            <span className={styles.timelineWindowHandle} />
            <span className={styles.timelineWindowHandle} />
          </div>
        </div>
        <PlayheadOverlay
          playheadViewportRef={playheadViewportRef}
          playheadViewportInsetsPx={playheadViewportInsetsPx}
          overlayWidth={overlayWidth}
          playheadOverlayMetrics={playheadOverlayMetrics}
          beginRangeSelection={beginRangeSelection}
          normalizedSelectedTimeRange={normalizedSelectedTimeRange}
          normalizedSelectionFalloff={normalizedSelectionFalloff}
          isLoopResetActive={isLoopResetActive}
          loopResetSlugRangeNorm={loopResetSlugRangeNorm}
          rulerMarks={rulerMarks}
          durationSec={durationSec}
          activeTool={activeTool}
          playheadTimeSec={playheadTimeSec}
          beginPlayheadDragFromClientX={beginPlayheadDragFromClientX}
          viewportRangeNorm={viewportRangeNorm}
        />
      </section>
    </main>
  );
}
