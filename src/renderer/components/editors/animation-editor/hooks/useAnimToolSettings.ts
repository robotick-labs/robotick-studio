import React from "react";

import type { TimeSelectionRange } from "../anim-editor-shared";
import type { AnimationToolId, AnimationToolSettingsContext, WarpMode } from "../tools/types";
import type { PersistedAnimEditorState } from "./useAnimEditorPersistence";

const DEFAULT_RANGE_SIZE_SEC = 0.45;
const DEFAULT_RANGE_FALLOFF_SEC = 0.12;
const DEFAULT_FALLOFF_CURVE = 1;
const DEFAULT_WARP_MODE: WarpMode = "time+value";
const DEFAULT_WARP_TIME_STRENGTH = 1;
const DEFAULT_WARP_VALUE_STRENGTH = 1;
const DEFAULT_SMOOTH_FALLOFF_SEC = 0.18;
const DEFAULT_SMOOTH_STRENGTH = 0.65;
const DEFAULT_SMOOTH_APPLY_RATE_HZ = 60;
const DEFAULT_SMOOTH_RANGE_SEC = 0.45;

type UseAnimToolSettingsArgs = {
  durationSec: number;
  playheadSec: number;
  initialPersistedState: PersistedAnimEditorState | null;
};

export function useAnimToolSettings({
  durationSec,
  playheadSec,
  initialPersistedState,
}: UseAnimToolSettingsArgs) {
  const [activeTool, setActiveTool] = React.useState<AnimationToolId | null>(
    () => initialPersistedState?.activeTool ?? null
  );
  const [selectedTimeRange, setSelectedTimeRange] = React.useState<TimeSelectionRange | null>(
    () => initialPersistedState?.selectedTimeRange ?? null
  );
  const [lineSnapStart, setLineSnapStart] = React.useState(
    () => initialPersistedState?.lineSnapStart ?? true
  );
  const [lineSnapEnd, setLineSnapEnd] = React.useState(
    () => initialPersistedState?.lineSnapEnd ?? true
  );
  const [rangeFalloffSec, setRangeFalloffSec] = React.useState(
    () => initialPersistedState?.rangeFalloffSec ?? DEFAULT_RANGE_FALLOFF_SEC
  );
  const [rangeMidpointDraft, setRangeMidpointDraft] = React.useState("0.000");
  const [rangeSizeDraft, setRangeSizeDraft] = React.useState(() => DEFAULT_RANGE_SIZE_SEC.toFixed(3));
  const [rangeFalloffDraft, setRangeFalloffDraft] = React.useState(() => DEFAULT_RANGE_FALLOFF_SEC.toFixed(3));
  const [rangeFalloffCurve, setRangeFalloffCurve] = React.useState(
    () => initialPersistedState?.rangeFalloffCurve ?? DEFAULT_FALLOFF_CURVE
  );
  const [rangeFalloffCurveDraft, setRangeFalloffCurveDraft] = React.useState(() => DEFAULT_FALLOFF_CURVE.toFixed(2));
  const [warpMode, setWarpMode] = React.useState<WarpMode>(
    () => initialPersistedState?.warpMode ?? DEFAULT_WARP_MODE
  );
  const [warpTimeStrength, setWarpTimeStrength] = React.useState(
    () => initialPersistedState?.warpTimeStrength ?? DEFAULT_WARP_TIME_STRENGTH
  );
  const [warpTimeStrengthDraft, setWarpTimeStrengthDraft] = React.useState(
    () => DEFAULT_WARP_TIME_STRENGTH.toFixed(2)
  );
  const [warpValueStrength, setWarpValueStrength] = React.useState(
    () => initialPersistedState?.warpValueStrength ?? DEFAULT_WARP_VALUE_STRENGTH
  );
  const [warpValueStrengthDraft, setWarpValueStrengthDraft] = React.useState(
    () => DEFAULT_WARP_VALUE_STRENGTH.toFixed(2)
  );
  const [warpLockEndpoints, setWarpLockEndpoints] = React.useState(
    () => initialPersistedState?.warpLockEndpoints ?? true
  );
  const [smoothFalloffSec, setSmoothFalloffSec] = React.useState(
    () => initialPersistedState?.smoothFalloffSec ?? DEFAULT_SMOOTH_FALLOFF_SEC
  );
  const [smoothFalloffDraft, setSmoothFalloffDraft] = React.useState(() => DEFAULT_SMOOTH_FALLOFF_SEC.toFixed(3));
  const [smoothFalloffCurve, setSmoothFalloffCurve] = React.useState(
    () => initialPersistedState?.smoothFalloffCurve ?? DEFAULT_FALLOFF_CURVE
  );
  const [smoothFalloffCurveDraft, setSmoothFalloffCurveDraft] = React.useState(() => DEFAULT_FALLOFF_CURVE.toFixed(2));
  const [smoothStrength, setSmoothStrength] = React.useState(
    () => initialPersistedState?.smoothStrength ?? DEFAULT_SMOOTH_STRENGTH
  );
  const [smoothStrengthDraft, setSmoothStrengthDraft] = React.useState(() => DEFAULT_SMOOTH_STRENGTH.toFixed(2));
  const [smoothApplyRateHz, setSmoothApplyRateHz] = React.useState(
    () => initialPersistedState?.smoothApplyRateHz ?? DEFAULT_SMOOTH_APPLY_RATE_HZ
  );
  const [smoothApplyRateDraft, setSmoothApplyRateDraft] = React.useState(() => DEFAULT_SMOOTH_APPLY_RATE_HZ.toFixed(0));
  const [smoothRangeSec, setSmoothRangeSec] = React.useState(
    () => initialPersistedState?.smoothRangeSec ?? DEFAULT_SMOOTH_RANGE_SEC
  );
  const [smoothRangeDraft, setSmoothRangeDraft] = React.useState(() => DEFAULT_SMOOTH_RANGE_SEC.toFixed(3));
  const [smoothBrushPreview, setSmoothBrushPreview] = React.useState<{ channel: string; centerSec: number } | null>(null);
  const [warpBrushPreview, setWarpBrushPreview] = React.useState<{ channel: string; centerSec: number } | null>(null);

  const rangeFalloffStepSec = React.useMemo(
    () => Math.min(0.1, Math.max(0.005, durationSec * 0.005)),
    [durationSec]
  );
  const smoothRangeStepSec = React.useMemo(
    () => Math.min(0.08, Math.max(0.0025, durationSec * 0.0025)),
    [durationSec]
  );
  const rangeSizeSec = React.useMemo(
    () =>
      selectedTimeRange
        ? Math.max(0.01, Math.abs(selectedTimeRange.endSec - selectedTimeRange.startSec))
        : DEFAULT_RANGE_SIZE_SEC,
    [selectedTimeRange]
  );
  const rangeMidpointSec = React.useMemo(
    () =>
      selectedTimeRange
        ? (selectedTimeRange.startSec + selectedTimeRange.endSec) * 0.5
        : Math.min(durationSec, Math.max(0, playheadSec)),
    [durationSec, playheadSec, selectedTimeRange]
  );

  const setSelectedTimeRangeDurationSec = React.useCallback(
    (nextDurationSec: number) => {
      if (!(durationSec > 0)) return;
      const clampedDuration = Math.min(durationSec, Math.max(0.01, nextDurationSec));
      setSelectedTimeRange((current) => {
        const centerSec = current ? (current.startSec + current.endSec) * 0.5 : Math.min(durationSec, Math.max(0, playheadSec));
        let startSec = centerSec - clampedDuration * 0.5;
        let endSec = centerSec + clampedDuration * 0.5;
        if (startSec < 0) {
          endSec = Math.min(durationSec, endSec - startSec);
          startSec = 0;
        }
        if (endSec > durationSec) {
          const overshoot = endSec - durationSec;
          startSec = Math.max(0, startSec - overshoot);
          endSec = durationSec;
        }
        return { startSec, endSec };
      });
    },
    [durationSec, playheadSec]
  );

  const setSelectedTimeRangeMidpointSec = React.useCallback(
    (nextMidpointSec: number) => {
      if (!(durationSec > 0)) return;
      const clampedMidpointSec = Math.min(durationSec, Math.max(0, nextMidpointSec));
      const clampedDuration = Math.min(durationSec, Math.max(0.01, rangeSizeSec));
      let startSec = clampedMidpointSec - clampedDuration * 0.5;
      let endSec = clampedMidpointSec + clampedDuration * 0.5;
      if (startSec < 0) {
        endSec = Math.min(durationSec, endSec - startSec);
        startSec = 0;
      }
      if (endSec > durationSec) {
        const overshoot = endSec - durationSec;
        startSec = Math.max(0, startSec - overshoot);
        endSec = durationSec;
      }
      setSelectedTimeRange({ startSec, endSec });
    },
    [durationSec, rangeSizeSec]
  );

  React.useEffect(() => {
    setRangeSizeDraft(rangeSizeSec.toFixed(3));
  }, [rangeSizeSec]);
  React.useEffect(() => {
    setRangeMidpointDraft(rangeMidpointSec.toFixed(3));
  }, [rangeMidpointSec]);
  React.useEffect(() => {
    setRangeFalloffDraft(rangeFalloffSec.toFixed(2));
  }, [rangeFalloffSec]);
  React.useEffect(() => {
    setRangeFalloffCurveDraft(rangeFalloffCurve.toFixed(2));
  }, [rangeFalloffCurve]);
  React.useEffect(() => {
    setWarpTimeStrengthDraft(warpTimeStrength.toFixed(2));
  }, [warpTimeStrength]);
  React.useEffect(() => {
    setWarpValueStrengthDraft(warpValueStrength.toFixed(2));
  }, [warpValueStrength]);
  React.useEffect(() => {
    setSmoothFalloffDraft(smoothFalloffSec.toFixed(3));
  }, [smoothFalloffSec]);
  React.useEffect(() => {
    setSmoothFalloffCurveDraft(smoothFalloffCurve.toFixed(2));
  }, [smoothFalloffCurve]);
  React.useEffect(() => {
    setSmoothStrengthDraft(smoothStrength.toFixed(2));
  }, [smoothStrength]);
  React.useEffect(() => {
    setSmoothApplyRateDraft(smoothApplyRateHz.toFixed(0));
  }, [smoothApplyRateHz]);
  React.useEffect(() => {
    setSmoothRangeDraft(smoothRangeSec.toFixed(3));
  }, [smoothRangeSec]);
  React.useEffect(() => {
    if (activeTool === "Smooth") return;
    setSmoothBrushPreview(null);
  }, [activeTool]);
  React.useEffect(() => {
    if (activeTool === "Warp") return;
    setWarpBrushPreview(null);
  }, [activeTool]);

  const toolSettingsContext: AnimationToolSettingsContext = {
    durationSec,
    lineSnapStart,
    lineSnapEnd,
    setLineSnapStart,
    setLineSnapEnd,
    rangeMidpointSec,
    rangeMidpointDraft,
    setRangeMidpointDraft,
    setSelectedTimeRangeMidpointSec,
    rangeSizeSec,
    rangeSizeDraft,
    setRangeSizeDraft,
    setSelectedTimeRangeDurationSec,
    rangeFalloffSec,
    rangeFalloffDraft,
    setRangeFalloffDraft,
    setRangeFalloffSec,
    rangeFalloffCurve,
    rangeFalloffCurveDraft,
    setRangeFalloffCurveDraft,
    setRangeFalloffCurve,
    warpMode,
    setWarpMode,
    warpTimeStrength,
    warpTimeStrengthDraft,
    setWarpTimeStrengthDraft,
    setWarpTimeStrength,
    warpValueStrength,
    warpValueStrengthDraft,
    setWarpValueStrengthDraft,
    setWarpValueStrength,
    warpLockEndpoints,
    setWarpLockEndpoints,
    smoothRangeSec,
    smoothRangeDraft,
    setSmoothRangeDraft,
    setSmoothRangeSec,
    smoothFalloffSec,
    smoothFalloffDraft,
    setSmoothFalloffDraft,
    setSmoothFalloffSec,
    smoothFalloffCurve,
    smoothFalloffCurveDraft,
    setSmoothFalloffCurveDraft,
    setSmoothFalloffCurve,
    smoothStrength,
    smoothStrengthDraft,
    setSmoothStrengthDraft,
    setSmoothStrength,
    smoothApplyRateHz,
    smoothApplyRateDraft,
    setSmoothApplyRateDraft,
    setSmoothApplyRateHz,
    smoothRangeStepSec,
    rangeFalloffStepSec,
  };

  return {
    activeTool,
    lineSnapEnd,
    lineSnapStart,
    rangeFalloffCurve,
    rangeFalloffSec,
    rangeMidpointDraft,
    rangeMidpointSec,
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
  };
}
