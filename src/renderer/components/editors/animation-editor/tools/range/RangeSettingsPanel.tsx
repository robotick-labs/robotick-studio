import React from "react";
import type { AnimationToolSettingsContext } from "../types";
import { ToolSettingNumberControl } from "../ToolSettingNumberControl";

export function RangeSettingsPanel(context: AnimationToolSettingsContext) {
  const {
    rangeSizeDraft,
    rangeSizeSec,
    setRangeSizeDraft,
    setSelectedTimeRangeDurationSec,
    smoothRangeStepSec,
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
        label="Size"
        value={rangeSizeDraft}
        numericValue={rangeSizeSec}
        title="Selected range width in seconds ([ / ])"
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
        label="Falloff Range"
        value={rangeFalloffDraft}
        numericValue={rangeFalloffSec}
        title="Falloff range in seconds (Shift + [ / ])"
        onChange={setRangeFalloffDraft}
        onCommit={() => {
          const parsed = Number(rangeFalloffDraft);
          if (!Number.isFinite(parsed)) {
            setRangeFalloffDraft(rangeFalloffSec.toFixed(3));
            return;
          }
          setRangeFalloffSec(Math.min(durationSec, Math.max(0, parsed)));
        }}
        onReset={() => setRangeFalloffDraft(rangeFalloffSec.toFixed(3))}
        onDelta={(delta) =>
          setRangeFalloffSec((current) =>
            Math.min(durationSec, Math.max(0, current + delta))
          )
        }
        onScrubValue={(next) =>
          setRangeFalloffSec(Math.min(durationSec, Math.max(0, next)))
        }
        stepSize={rangeFalloffStepSec}
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
