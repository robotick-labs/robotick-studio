import React from "react";
import styles from "../../AnimationEditorPage.module.css";
import type { AnimationToolSettingsContext } from "../types";
import { ToolSettingNumberControl } from "../ToolSettingNumberControl";

export function WarpSettingsPanel(context: AnimationToolSettingsContext) {
  const {
    durationSec,
    rangeSizeDraft,
    rangeSizeSec,
    setRangeSizeDraft,
    setSelectedTimeRangeDurationSec,
    rangeFalloffDraft,
    rangeFalloffSec,
    setRangeFalloffDraft,
    setRangeFalloffSec,
    rangeFalloffCurveDraft,
    rangeFalloffCurve,
    setRangeFalloffCurveDraft,
    setRangeFalloffCurve,
    warpMode,
    setWarpMode,
    warpTimeStrengthDraft,
    warpTimeStrength,
    setWarpTimeStrengthDraft,
    setWarpTimeStrength,
    warpValueStrengthDraft,
    warpValueStrength,
    setWarpValueStrengthDraft,
    setWarpValueStrength,
    warpLockEndpoints,
    setWarpLockEndpoints,
    smoothRangeStepSec,
    rangeFalloffStepSec,
  } = context;

  return (
    <>
      <div className={styles.toolSettingHint}>
        Hover to position the warp brush, then drag directly on the lane to pull timing, values, or both.
      </div>
      <div className={styles.toolSettingRow}>
        <span>Mode</span>
        <select
          className={styles.toolSettingInput}
          value={warpMode}
          onChange={(event) => setWarpMode(event.target.value as typeof warpMode)}
          title="Choose whether warp affects time, values, or both"
        >
          <option value="time+value">Time + Value</option>
          <option value="time">Time Only</option>
          <option value="value">Value Only</option>
        </select>
      </div>
      <ToolSettingNumberControl
        label="Range"
        value={rangeSizeDraft}
        numericValue={rangeSizeSec}
        title="Warp region width in seconds ([ / ])"
        onChange={setRangeSizeDraft}
        onCommit={() => {
          const parsed = Number(rangeSizeDraft);
          if (!Number.isFinite(parsed)) {
            setRangeSizeDraft(rangeSizeSec.toFixed(3));
            return;
          }
          setSelectedTimeRangeDurationSec(Math.min(durationSec, Math.max(0.01, parsed)));
        }}
        onReset={() => setRangeSizeDraft(rangeSizeSec.toFixed(3))}
        onDelta={(delta) =>
          setSelectedTimeRangeDurationSec(rangeSizeSec + delta)
        }
        onScrubValue={(next) =>
          setSelectedTimeRangeDurationSec(Math.min(durationSec, Math.max(0.01, next)))
        }
        stepSize={smoothRangeStepSec}
      />
      <ToolSettingNumberControl
        label="Falloff Range"
        value={rangeFalloffDraft}
        numericValue={rangeFalloffSec}
        title="Warp falloff range in seconds (Shift + [ / ])"
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
      <ToolSettingNumberControl
        label="Time Strength"
        value={warpTimeStrengthDraft}
        numericValue={warpTimeStrength}
        title="How strongly drag motion retimes the selected region"
        onChange={setWarpTimeStrengthDraft}
        onCommit={() => {
          const parsed = Number(warpTimeStrengthDraft);
          if (!Number.isFinite(parsed)) {
            setWarpTimeStrengthDraft(warpTimeStrength.toFixed(2));
            return;
          }
          setWarpTimeStrength(Math.min(1, Math.max(0, parsed)));
        }}
        onReset={() => setWarpTimeStrengthDraft(warpTimeStrength.toFixed(2))}
        onDelta={(delta) =>
          setWarpTimeStrength((current) => Math.min(1, Math.max(0, current + delta)))
        }
        onScrubValue={(next) => setWarpTimeStrength(Math.min(1, Math.max(0, next)))}
        stepSize={0.02}
      />
      <ToolSettingNumberControl
        label="Value Strength"
        value={warpValueStrengthDraft}
        numericValue={warpValueStrength}
        title="How strongly drag motion offsets values in the selected region"
        onChange={setWarpValueStrengthDraft}
        onCommit={() => {
          const parsed = Number(warpValueStrengthDraft);
          if (!Number.isFinite(parsed)) {
            setWarpValueStrengthDraft(warpValueStrength.toFixed(2));
            return;
          }
          setWarpValueStrength(Math.min(1, Math.max(0, parsed)));
        }}
        onReset={() => setWarpValueStrengthDraft(warpValueStrength.toFixed(2))}
        onDelta={(delta) =>
          setWarpValueStrength((current) => Math.min(1, Math.max(0, current + delta)))
        }
        onScrubValue={(next) => setWarpValueStrength(Math.min(1, Math.max(0, next)))}
        stepSize={0.02}
      />
      <div className={styles.toolSettingRow}>
        <span>Lock Endpoints</span>
        <button
          type="button"
          className={`${styles.toolButton} ${warpLockEndpoints ? styles.toolButtonActive : ""}`}
          title="Keep the selected range endpoints anchored while warping"
          onClick={() => setWarpLockEndpoints((current) => !current)}
        >
          {warpLockEndpoints ? "On" : "Off"}
        </button>
      </div>
    </>
  );
}
