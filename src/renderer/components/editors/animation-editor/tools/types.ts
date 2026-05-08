import React from "react";

export type AnimationToolId = "Pencil" | "Line" | "Range" | "Smooth";

export type AnimationToolSettingsContext = {
  durationSec: number;
  lineSnapStart: boolean;
  lineSnapEnd: boolean;
  setLineSnapStart: React.Dispatch<React.SetStateAction<boolean>>;
  setLineSnapEnd: React.Dispatch<React.SetStateAction<boolean>>;
  rangeSizeSec: number;
  rangeSizeDraft: string;
  setRangeSizeDraft: React.Dispatch<React.SetStateAction<string>>;
  setSelectedTimeRangeDurationSec: (nextDurationSec: number) => void;
  rangeFalloffSec: number;
  rangeFalloffDraft: string;
  setRangeFalloffDraft: React.Dispatch<React.SetStateAction<string>>;
  setRangeFalloffSec: React.Dispatch<React.SetStateAction<number>>;
  rangeFalloffCurve: number;
  rangeFalloffCurveDraft: string;
  setRangeFalloffCurveDraft: React.Dispatch<React.SetStateAction<string>>;
  setRangeFalloffCurve: React.Dispatch<React.SetStateAction<number>>;
  smoothRangeSec: number;
  smoothRangeDraft: string;
  setSmoothRangeDraft: React.Dispatch<React.SetStateAction<string>>;
  setSmoothRangeSec: React.Dispatch<React.SetStateAction<number>>;
  smoothFalloffSec: number;
  smoothFalloffDraft: string;
  setSmoothFalloffDraft: React.Dispatch<React.SetStateAction<string>>;
  setSmoothFalloffSec: React.Dispatch<React.SetStateAction<number>>;
  smoothFalloffCurve: number;
  smoothFalloffCurveDraft: string;
  setSmoothFalloffCurveDraft: React.Dispatch<React.SetStateAction<string>>;
  setSmoothFalloffCurve: React.Dispatch<React.SetStateAction<number>>;
  smoothStrength: number;
  smoothStrengthDraft: string;
  setSmoothStrengthDraft: React.Dispatch<React.SetStateAction<string>>;
  setSmoothStrength: React.Dispatch<React.SetStateAction<number>>;
  smoothApplyRateHz: number;
  smoothApplyRateDraft: string;
  setSmoothApplyRateDraft: React.Dispatch<React.SetStateAction<string>>;
  setSmoothApplyRateHz: React.Dispatch<React.SetStateAction<number>>;
  smoothRangeStepSec: number;
  rangeFalloffStepSec: number;
};

export type AnimationToolDefinition = {
  id: string;
  label: string;
  section: string;
  enabled: boolean;
  description: string;
  renderSettings?: (context: AnimationToolSettingsContext) => React.ReactNode;
};
