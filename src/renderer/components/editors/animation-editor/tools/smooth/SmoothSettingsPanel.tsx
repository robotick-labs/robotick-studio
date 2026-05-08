import React from "react";
import type { AnimationToolSettingsContext } from "../types";
import { ToolSettingNumberControl } from "../ToolSettingNumberControl";

export function SmoothSettingsPanel(context: AnimationToolSettingsContext) {
  const {
    durationSec,
    smoothRangeDraft,
    smoothRangeSec,
    setSmoothRangeDraft,
    setSmoothRangeSec,
    smoothRangeStepSec,
    smoothFalloffDraft,
    smoothFalloffSec,
    setSmoothFalloffDraft,
    setSmoothFalloffSec,
    rangeFalloffStepSec,
    smoothFalloffCurveDraft,
    smoothFalloffCurve,
    setSmoothFalloffCurveDraft,
    setSmoothFalloffCurve,
    smoothStrengthDraft,
    smoothStrength,
    setSmoothStrengthDraft,
    setSmoothStrength,
    smoothApplyRateDraft,
    smoothApplyRateHz,
    setSmoothApplyRateDraft,
    setSmoothApplyRateHz,
  } = context;

  return (
    <>
      <ToolSettingNumberControl
        label="Size"
        value={smoothRangeDraft}
        numericValue={smoothRangeSec}
        title="Smooth brush width in seconds ([ / ])"
        onChange={setSmoothRangeDraft}
        onCommit={() => {
          const parsed = Number(smoothRangeDraft);
          if (!Number.isFinite(parsed)) {
            setSmoothRangeDraft(smoothRangeSec.toFixed(3));
            return;
          }
          setSmoothRangeSec(Math.min(durationSec, Math.max(0.01, parsed)));
        }}
        onReset={() => setSmoothRangeDraft(smoothRangeSec.toFixed(3))}
        onDelta={(delta) =>
          setSmoothRangeSec((current) =>
            Math.min(durationSec, Math.max(0.01, current + delta))
          )
        }
        onScrubValue={(next) =>
          setSmoothRangeSec(Math.min(durationSec, Math.max(0.01, next)))
        }
        stepSize={smoothRangeStepSec}
      />
      <ToolSettingNumberControl
        label="Falloff Range"
        value={smoothFalloffDraft}
        numericValue={smoothFalloffSec}
        title="Falloff range in seconds (Shift + [ / ])"
        onChange={setSmoothFalloffDraft}
        onCommit={() => {
          const parsed = Number(smoothFalloffDraft);
          if (!Number.isFinite(parsed)) {
            setSmoothFalloffDraft(smoothFalloffSec.toFixed(3));
            return;
          }
          setSmoothFalloffSec(Math.min(durationSec, Math.max(0, parsed)));
        }}
        onReset={() => setSmoothFalloffDraft(smoothFalloffSec.toFixed(3))}
        onDelta={(delta) =>
          setSmoothFalloffSec((current) =>
            Math.min(durationSec, Math.max(0, current + delta))
          )
        }
        onScrubValue={(next) =>
          setSmoothFalloffSec(Math.min(durationSec, Math.max(0, next)))
        }
        stepSize={rangeFalloffStepSec}
      />
      <ToolSettingNumberControl
        label="Falloff Curve"
        value={smoothFalloffCurveDraft}
        numericValue={smoothFalloffCurve}
        title="Falloff curve from 0.0 linear to 1.0 fully eased"
        onChange={setSmoothFalloffCurveDraft}
        onCommit={() => {
          const parsed = Number(smoothFalloffCurveDraft);
          if (!Number.isFinite(parsed)) {
            setSmoothFalloffCurveDraft(smoothFalloffCurve.toFixed(2));
            return;
          }
          setSmoothFalloffCurve(Math.min(1, Math.max(0, parsed)));
        }}
        onReset={() => setSmoothFalloffCurveDraft(smoothFalloffCurve.toFixed(2))}
        onDelta={(delta) =>
          setSmoothFalloffCurve((current) => Math.min(1, Math.max(0, current + delta)))
        }
        onScrubValue={(next) => setSmoothFalloffCurve(Math.min(1, Math.max(0, next)))}
        stepSize={0.05}
      />
      <ToolSettingNumberControl
        label="Strength"
        value={smoothStrengthDraft}
        numericValue={smoothStrength}
        title="Base smoothing strength (+ / -)"
        onChange={setSmoothStrengthDraft}
        onCommit={() => {
          const parsed = Number(smoothStrengthDraft);
          if (!Number.isFinite(parsed)) {
            setSmoothStrengthDraft(smoothStrength.toFixed(2));
            return;
          }
          setSmoothStrength(Math.min(1, Math.max(0, parsed)));
        }}
        onReset={() => setSmoothStrengthDraft(smoothStrength.toFixed(2))}
        onDelta={(delta) =>
          setSmoothStrength((current) => Math.min(1, Math.max(0, current + delta)))
        }
        onScrubValue={(next) => setSmoothStrength(Math.min(1, Math.max(0, next)))}
        stepSize={0.02}
      />
      <ToolSettingNumberControl
        label="Apply Rate (Hz)"
        value={smoothApplyRateDraft}
        numericValue={smoothApplyRateHz}
        title="How often smooth brush applies while pointer is down"
        onChange={setSmoothApplyRateDraft}
        onCommit={() => {
          const parsed = Number(smoothApplyRateDraft);
          if (!Number.isFinite(parsed)) {
            setSmoothApplyRateDraft(smoothApplyRateHz.toFixed(0));
            return;
          }
          setSmoothApplyRateHz(Math.min(240, Math.max(5, parsed)));
        }}
        onReset={() => setSmoothApplyRateDraft(smoothApplyRateHz.toFixed(0))}
        onDelta={(delta) =>
          setSmoothApplyRateHz((current) => Math.min(240, Math.max(5, current + delta)))
        }
        onScrubValue={(next) => setSmoothApplyRateHz(Math.min(240, Math.max(5, next)))}
        stepSize={1}
      />
    </>
  );
}
