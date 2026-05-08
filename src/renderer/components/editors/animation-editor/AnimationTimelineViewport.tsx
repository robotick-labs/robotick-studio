import React from "react";
import { sampleIndexRangeFromTimes } from "./anim-sample-editing";
import styles from "./AnimationEditorPage.module.css";

const LANE_VIEWBOX_WIDTH = 1000;
const LANE_CURVE_DRAW_HEIGHT = 34;

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
    event: React.PointerEvent<SVGCircleElement>,
    channel: string,
    channelSamples: Float32Array,
    minV: number,
    maxV: number
  ) => void;
  onSmoothBrushPreviewChange: (channel: string, timeSec: number | null) => void;
  firstLaneSvgRef: React.RefObject<SVGSVGElement | null>;
};

function curvePath(samples: ArrayLike<number>, durationSec: number, width: number, height: number, minV: number, maxV: number) {
  const sampleCount = samples.length ?? 0;
  if (!sampleCount || durationSec <= 0) return "";
  const span = Math.max(1e-6, maxV - minV);
  let d = "";
  const lastIndex = Math.max(1, sampleCount - 1);
  for (let i = 0; i < sampleCount; i += 1) {
    const x = (i / lastIndex) * width;
    const value = Number(samples[i] ?? 0);
    const y = height - ((value - minV) / span) * height;
    d += `${i === 0 ? "M" : " L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

function areaPath(samples: ArrayLike<number>, durationSec: number, width: number, height: number, minV: number, maxV: number) {
  const sampleCount = samples.length ?? 0;
  if (!sampleCount || durationSec <= 0) return "";
  const span = Math.max(1e-6, maxV - minV);
  let d = "";
  const lastIndex = Math.max(1, sampleCount - 1);
  for (let i = 0; i < sampleCount; i += 1) {
    const x = (i / lastIndex) * width;
    const value = Number(samples[i] ?? 0);
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

function computeSampleRangeMean(samples: ArrayLike<number>, startSampleIndex: number, endSampleIndex: number): number {
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
}: LaneRowProps) {
  const minV = range.min;
  const maxV = range.max;
  const [draftMax, setDraftMax] = React.useState(() => formatAxisValue(maxV));
  const [draftMin, setDraftMin] = React.useState(() => formatAxisValue(minV));

  React.useEffect(() => setDraftMax(formatAxisValue(maxV)), [maxV]);
  React.useEffect(() => setDraftMin(formatAxisValue(minV)), [minV]);

  const areaD = React.useMemo(() => areaPath(samples, durationSec, 1000, 34, minV, maxV), [samples, durationSec, minV, maxV]);
  const curveD = React.useMemo(() => curvePath(samples, durationSec, 1000, 34, minV, maxV), [samples, durationSec, minV, maxV]);
  const normalizedTimeRange = React.useMemo(() => normalizeTimeRange(durationSec, selectedTimeRange), [durationSec, selectedTimeRange]);
  const selectedSampleRange = React.useMemo(
    () =>
      normalizedTimeRange
        ? sampleIndexRangeFromTimes(
            samples.length,
            durationSec,
            normalizedTimeRange.startNorm * durationSec,
            normalizedTimeRange.endNorm * durationSec
          )
        : null,
    [durationSec, normalizedTimeRange, samples.length]
  );

  const rangeOverlay = React.useMemo(() => {
    if (!selectedSampleRange || !normalizedTimeRange) return null;
    const meanValue = computeSampleRangeMean(samples, selectedSampleRange.startSampleIndex, selectedSampleRange.endSampleIndex);
    const span = Math.max(1e-6, maxV - minV);
    const yNorm = (maxV - meanValue) / span;
    const centerNorm = (normalizedTimeRange.startNorm + normalizedTimeRange.endNorm) * 0.5;
    const falloffNorm = durationSec > 0 ? Math.min(1, Math.max(0, rangeFalloffSec / durationSec)) : 0;
    const falloffStartNorm = Math.max(0, normalizedTimeRange.startNorm - falloffNorm);
    const falloffEndNorm = Math.min(1, normalizedTimeRange.endNorm + falloffNorm);
    return {
      falloffLeftX: falloffStartNorm * LANE_VIEWBOX_WIDTH,
      falloffLeftWidth: Math.max(0, (normalizedTimeRange.startNorm - falloffStartNorm) * LANE_VIEWBOX_WIDTH),
      bandX: normalizedTimeRange.startNorm * LANE_VIEWBOX_WIDTH,
      bandWidth: Math.max(3, (normalizedTimeRange.endNorm - normalizedTimeRange.startNorm) * LANE_VIEWBOX_WIDTH),
      falloffRightX: normalizedTimeRange.endNorm * LANE_VIEWBOX_WIDTH,
      falloffRightWidth: Math.max(0, (falloffEndNorm - normalizedTimeRange.endNorm) * LANE_VIEWBOX_WIDTH),
      handleCx: centerNorm * LANE_VIEWBOX_WIDTH,
      handleCy: Math.min(LANE_CURVE_DRAW_HEIGHT, Math.max(0, yNorm * LANE_CURVE_DRAW_HEIGHT)),
    };
  }, [durationSec, maxV, minV, normalizedTimeRange, rangeFalloffSec, samples, selectedSampleRange]);

  const smoothOverlay = React.useMemo(() => {
    if (!smoothBrushPreview || durationSec <= 0) return null;
    const centerNorm = Math.min(1, Math.max(0, smoothBrushPreview.centerSec / durationSec));
    const halfCoreNorm = Math.min(0.5, Math.max(0, (smoothBrushPreview.coreRangeSec * 0.5) / durationSec));
    const falloffNorm = Math.min(1, Math.max(0, smoothBrushPreview.falloffSec / durationSec));
    const coreStartNorm = Math.max(0, centerNorm - halfCoreNorm);
    const coreEndNorm = Math.min(1, centerNorm + halfCoreNorm);
    const falloffStartNorm = Math.max(0, coreStartNorm - falloffNorm);
    const falloffEndNorm = Math.min(1, coreEndNorm + falloffNorm);
    return {
      falloffLeftX: falloffStartNorm * LANE_VIEWBOX_WIDTH,
      falloffLeftWidth: Math.max(0, (coreStartNorm - falloffStartNorm) * LANE_VIEWBOX_WIDTH),
      bandX: coreStartNorm * LANE_VIEWBOX_WIDTH,
      bandWidth: Math.max(3, (coreEndNorm - coreStartNorm) * LANE_VIEWBOX_WIDTH),
      falloffRightX: coreEndNorm * LANE_VIEWBOX_WIDTH,
      falloffRightWidth: Math.max(0, (falloffEndNorm - coreEndNorm) * LANE_VIEWBOX_WIDTH),
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
      className={[styles.laneRow, isHovered ? styles.laneRowHovered : "", isSelected ? styles.laneRowSelected : ""]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={() => onHoverChange(channel, true)}
      onMouseLeave={() => onHoverChange(channel, false)}
      onClick={() => onSelect(channel)}
    >
      <div className={styles.laneAxis}>
        <input className={styles.laneAxisInput} value={draftMax} onChange={(event) => setDraftMax(event.target.value)} onBlur={commitMax} title="Channel Y max" />
        <input className={styles.laneAxisInput} value={draftMin} onChange={(event) => setDraftMin(event.target.value)} onBlur={commitMin} title="Channel Y min" />
      </div>
      <div className={[styles.laneTrack, drawActive ? styles.laneTrackDrawActive : ""].filter(Boolean).join(" ")} data-lane-track="true">
        <div className={styles.laneChannelOverlay}>{channel}</div>
        <button className={styles.laneFitButton} type="button" title="Fit Y for this channel" onClick={() => onFitRange(channel)}>Fit Y</button>
        <svg
          ref={isFirstVisible ? firstLaneSvgRef : undefined}
          className={styles.laneSvg}
          viewBox="0 0 1000 40"
          preserveAspectRatio="none"
          aria-hidden="true"
          onPointerDown={(event) => onBeginDraw(event, channel, samples, minV, maxV)}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (rect.width <= 0) return;
            const timeSec = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * durationSec;
            onSmoothBrushPreviewChange(channel, timeSec);
          }}
          onPointerLeave={() => onSmoothBrushPreviewChange(channel, null)}
        >
          {smoothOverlay && smoothOverlay.falloffLeftWidth > 0 ? <rect x={smoothOverlay.falloffLeftX} y={0} width={smoothOverlay.falloffLeftWidth} height={LANE_CURVE_DRAW_HEIGHT} className={styles.smoothBrushFalloffBandLane} /> : null}
          {smoothOverlay ? <rect x={smoothOverlay.bandX} y={0} width={smoothOverlay.bandWidth} height={LANE_CURVE_DRAW_HEIGHT} className={styles.smoothBrushCoreBandLane} /> : null}
          {smoothOverlay && smoothOverlay.falloffRightWidth > 0 ? <rect x={smoothOverlay.falloffRightX} y={0} width={smoothOverlay.falloffRightWidth} height={LANE_CURVE_DRAW_HEIGHT} className={styles.smoothBrushFalloffBandLane} /> : null}
          {smoothOverlay ? <line x1={smoothOverlay.centerX} y1={0} x2={smoothOverlay.centerX} y2={LANE_CURVE_DRAW_HEIGHT} className={styles.smoothBrushCenterLineLane} /> : null}
          {rangeOverlay && rangeOverlay.falloffLeftWidth > 0 ? <rect x={rangeOverlay.falloffLeftX} y={0} width={rangeOverlay.falloffLeftWidth} height={LANE_CURVE_DRAW_HEIGHT} className={styles.rangeFalloffBandLane} /> : null}
          {rangeOverlay ? <rect x={rangeOverlay.bandX} y={0} width={rangeOverlay.bandWidth} height={LANE_CURVE_DRAW_HEIGHT} className={styles.rangeSelectionBandLane} /> : null}
          {rangeOverlay && rangeOverlay.falloffRightWidth > 0 ? <rect x={rangeOverlay.falloffRightX} y={0} width={rangeOverlay.falloffRightWidth} height={LANE_CURVE_DRAW_HEIGHT} className={styles.rangeFalloffBandLane} /> : null}
          <path d={areaD} className={styles.laneArea} style={{ fill: color }} />
          <path d={curveD} className={styles.laneCurve} style={{ stroke: color }} />
          {rangeOverlay ? <circle cx={rangeOverlay.handleCx} cy={rangeOverlay.handleCy} r={4.25} className={styles.rangeOffsetHandle} onPointerDown={(event) => onBeginRangeOffset(event, channel, samples, minV, maxV)} /> : null}
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
    event: React.PointerEvent<SVGCircleElement>,
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
  playheadX: number;
  beginPlayheadDragFromClientX: (clientX: number) => void;
};

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
    playheadX,
    beginPlayheadDragFromClientX,
  } = props;

  return (
    <main className={styles.timelineArea}>
      <section ref={timelineRef} className={styles.timelineCanvas} aria-label="Animation timeline">
        <div ref={topRulerRef} className={styles.timeRuler} />
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
                    ? { centerSec: smoothBrushPreview.centerSec, coreRangeSec: smoothRangeSec, falloffSec: smoothFalloffSec }
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
              />
            );
          })}
        </div>
        <div ref={bottomRulerRef} className={styles.timeRulerBottom} />
        <div ref={playheadViewportRef} className={styles.playheadViewport} style={{ left: `${playheadViewportInsetsPx.left}px`, right: `${playheadViewportInsetsPx.right}px` }}>
          <svg className={styles.playheadOverlaySvg} viewBox={`0 0 ${overlayWidth} ${playheadOverlayMetrics.height}`} preserveAspectRatio="none" aria-hidden="true">
            <rect x={0} y={0} width={overlayWidth} height={playheadOverlayMetrics.topRulerHeight} className={activeTool === "Range" ? styles.rulerHitRectActive : styles.rulerHitRect} onPointerDown={beginRangeSelection} />
            {normalizedSelectedTimeRange && normalizedSelectionFalloff > 0 && normalizedSelectedTimeRange.startNorm > 0 ? <rect x={Math.max(0, (normalizedSelectedTimeRange.startNorm - normalizedSelectionFalloff) * overlayWidth)} y={2} width={Math.max(0, Math.min(normalizedSelectedTimeRange.startNorm, normalizedSelectionFalloff) * overlayWidth)} height={Math.max(8, playheadOverlayMetrics.topRulerHeight - 4)} className={styles.rangeFalloffBandRuler} /> : null}
            {normalizedSelectedTimeRange && normalizedSelectionFalloff > 0 && normalizedSelectedTimeRange.endNorm < 1 ? <rect x={normalizedSelectedTimeRange.endNorm * overlayWidth} y={2} width={Math.max(0, Math.min(1 - normalizedSelectedTimeRange.endNorm, normalizedSelectionFalloff) * overlayWidth)} height={Math.max(8, playheadOverlayMetrics.topRulerHeight - 4)} className={styles.rangeFalloffBandRuler} /> : null}
            {normalizedSelectedTimeRange ? <rect x={normalizedSelectedTimeRange.startNorm * overlayWidth} y={2} width={Math.max(3, (normalizedSelectedTimeRange.endNorm - normalizedSelectedTimeRange.startNorm) * overlayWidth)} height={Math.max(8, playheadOverlayMetrics.topRulerHeight - 4)} className={styles.rangeSelectionBandRuler} /> : null}
            {isLoopResetActive ? <rect x={Math.max(0, Math.min(overlayWidth, loopResetSlugRangeNorm.left * overlayWidth))} y={2} width={Math.max(0, Math.min(overlayWidth, loopResetSlugRangeNorm.right * overlayWidth) - Math.max(0, Math.min(overlayWidth, loopResetSlugRangeNorm.left * overlayWidth)))} height={5} className={styles.loopResetSlugSvg} /> : null}
            {rulerMarks.map((mark, index) => <text key={`top-${index}`} x={mark.norm * overlayWidth} y={Math.max(12, playheadOverlayMetrics.topRulerHeight - 9)} className={styles.rulerMarkSvg} textAnchor={index === 0 ? "start" : index === rulerMarks.length - 1 ? "end" : "middle"}>{mark.label}</text>)}
            {rulerMarks.map((mark, index) => <text key={`bottom-${index}`} x={mark.norm * overlayWidth} y={Math.max(playheadOverlayMetrics.bottomRulerTop + 12, playheadOverlayMetrics.bottomRulerTop + playheadOverlayMetrics.bottomRulerHeight - 9)} className={styles.rulerMarkSvg} textAnchor={index === 0 ? "start" : index === rulerMarks.length - 1 ? "end" : "middle"}>{mark.label}</text>)}
            <line x1={playheadX} x2={playheadX} y1={playheadOverlayMetrics.topBlobCenterY} y2={playheadOverlayMetrics.bottomBlobCenterY} className={`${styles.playheadLineSvg} ${activeTool !== null ? styles.playheadLineMutedSvg : ""}`} />
            <rect x={playheadX - 5} y={playheadOverlayMetrics.topBlobCenterY - 6} width={10} height={12} rx={4} ry={4} className={styles.rulerEndBlobSvg} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); beginPlayheadDragFromClientX(event.clientX); }} />
            <rect x={playheadX - 5} y={playheadOverlayMetrics.bottomBlobCenterY - 6} width={10} height={12} rx={4} ry={4} className={styles.rulerEndBlobSvg} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); beginPlayheadDragFromClientX(event.clientX); }} />
            {activeTool === null ? <rect x={playheadX - 9} y={playheadOverlayMetrics.topBlobCenterY} width={18} height={Math.max(0, playheadOverlayMetrics.bottomBlobCenterY - playheadOverlayMetrics.topBlobCenterY)} className={styles.playheadGrabSvg} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); beginPlayheadDragFromClientX(event.clientX); }} /> : null}
          </svg>
        </div>
      </section>
    </main>
  );
}
