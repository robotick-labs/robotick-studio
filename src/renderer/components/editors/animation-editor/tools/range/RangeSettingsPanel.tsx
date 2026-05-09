import React from "react";
import type { AnimationToolSettingsContext } from "../types";
import { ToolSettingNumberControl } from "../ToolSettingNumberControl";

export function RangeSettingsPanel(context: AnimationToolSettingsContext) {
  const {
    rangeMidpointDraft,
    rangeMidpointSec,
    setRangeMidpointDraft,
    setSelectedTimeRangeMidpointSec,
    smoothRangeStepSec,
    rangeSizeDraft,
    rangeSizeSec,
    setRangeSizeDraft,
    setSelectedTimeRangeDurationSec,
    rangeFalloffDraft,
    rangeFalloffSec,
    setRangeFalloffDraft,
    setRangeFalloffSec,
    rangeFalloffStepSec,
    durationSec,
    rangeFalloffCurveDraft,
    rangeFalloffCurve,
    setRangeFalloffCurveDraft,
    setRangeFalloffCurve,
  } = context;

  return (
    <>
      <ToolSettingNumberControl
        label="Time"
        value={rangeMidpointDraft}
        numericValue={rangeMidpointSec}
        title="Selected range midpoint in seconds"
        onChange={setRangeMidpointDraft}
        onCommit={() => {
          const parsed = Number(rangeMidpointDraft);
          if (!Number.isFinite(parsed)) {
            setRangeMidpointDraft(rangeMidpointSec.toFixed(3));
            return;
          }
          setSelectedTimeRangeMidpointSec(parsed);
        }}
        onReset={() => setRangeMidpointDraft(rangeMidpointSec.toFixed(3))}
        onDelta={(delta) => setSelectedTimeRangeMidpointSec(rangeMidpointSec + delta)}
        onScrubValue={(next) => setSelectedTimeRangeMidpointSec(next)}
        stepSize={smoothRangeStepSec}
      />
      <ToolSettingNumberControl
        label="Size"
        value={rangeSizeDraft}
        numericValue={rangeSizeSec}
        title="Selected total range width in seconds ([ / ])"
        onChange={setRangeSizeDraft}
        onCommit={() => {
          const parsed = Number(rangeSizeDraft);
          if (!Number.isFinite(parsed)) {
            setRangeSizeDraft(rangeSizeSec.toFixed(3));
            return;
          }
          setSelectedTimeRangeDurationSec(parsed);
        }}
        onReset={() => setRangeSizeDraft(rangeSizeSec.toFixed(3))}
        onDelta={(delta) => setSelectedTimeRangeDurationSec(rangeSizeSec + delta)}
        onScrubValue={(next) => setSelectedTimeRangeDurationSec(next)}
        stepSize={smoothRangeStepSec}
      />
      <ToolSettingNumberControl
        label="Falloff"
        value={rangeFalloffDraft}
        numericValue={rangeFalloffSec}
        title="Fraction of each half-range used for falloff, from 0.0 core-only to 1.0 nearly all falloff (Shift + [ / ])"
        onChange={setRangeFalloffDraft}
        onCommit={() => {
          const parsed = Number(rangeFalloffDraft);
          if (!Number.isFinite(parsed)) {
            setRangeFalloffDraft(rangeFalloffSec.toFixed(2));
            return;
          }
          setRangeFalloffSec(Math.min(1, Math.max(0, parsed)));
        }}
        onReset={() => setRangeFalloffDraft(rangeFalloffSec.toFixed(2))}
        onDelta={(delta) =>
          setRangeFalloffSec((current) =>
            Math.min(1, Math.max(0, current + delta))
          )
        }
        onScrubValue={(next) =>
          setRangeFalloffSec(Math.min(1, Math.max(0, next)))
        }
        stepSize={0.05}
      />
      <ToolSettingNumberControl
        label="Falloff Curve"
        value={rangeFalloffCurveDraft}
        numericValue={rangeFalloffCurve}
        title="Falloff curve from 0.0 linear to 1.0 fully eased"
        onChange={setRangeFalloffCurveDraft}
        onCommit={() => {
          const parsed = Number(rangeFalloffCurveDraft);
          if (!Number.isFinite(parsed)) {
            setRangeFalloffCurveDraft(rangeFalloffCurve.toFixed(2));
            return;
          }
          setRangeFalloffCurve(Math.min(1, Math.max(0, parsed)));
        }}
        onReset={() => setRangeFalloffCurveDraft(rangeFalloffCurve.toFixed(2))}
        onDelta={(delta) =>
          setRangeFalloffCurve((current) => Math.min(1, Math.max(0, current + delta)))
        }
        onScrubValue={(next) => setRangeFalloffCurve(Math.min(1, Math.max(0, next)))}
        stepSize={0.05}
      />
    </>
  );
}
