import React from "react";

import {
  getFirstAvailableValue,
  setStorageValue,
} from "../../../../services/storage";
import type { AnimationToolId, WarpMode } from "../tools/types";
import type { LaneRange, TimeSelectionRange } from "../anim-editor-shared";

export type PersistedAnimEditorState = {
  selectedSourceId?: string;
  selectedClipPath?: string;
  activeTool?: AnimationToolId | null;
  selectedTimeRange?: TimeSelectionRange | null;
  lineSnapStart?: boolean;
  lineSnapEnd?: boolean;
  rangeFalloffSec?: number;
  rangeFalloffCurve?: number;
  warpMode?: WarpMode;
  warpTimeStrength?: number;
  warpValueStrength?: number;
  warpLockEndpoints?: boolean;
  smoothFalloffSec?: number;
  smoothFalloffCurve?: number;
  smoothStrength?: number;
  smoothApplyRateHz?: number;
  smoothRangeSec?: number;
  channelVisible?: Record<string, boolean>;
  channelRecordArm?: Record<string, boolean>;
  channelColor?: Record<string, string>;
  selectedChannel?: string | null;
  laneRange?: Record<string, LaneRange>;
  timelineViewportRangeNorm?: { startNorm: number; endNorm: number } | null;
};

export function resolveInitialPersistedAnimEditorState(
  panelStorageKey: string,
  legacyStorageKey: string
): PersistedAnimEditorState | null {
  const { value, key } = getFirstAvailableValue([panelStorageKey, legacyStorageKey]);
  if (value !== null && key && key !== panelStorageKey) {
    setStorageValue(panelStorageKey, value);
  }
  return parsePersistedAnimEditorState(value);
}

export function parsePersistedAnimEditorState(rawValue: string | null): PersistedAnimEditorState | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as PersistedAnimEditorState;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sanitizePersistedTimeRange(range: TimeSelectionRange | null | undefined): TimeSelectionRange | null {
  if (!range) return null;
  if (
    typeof range.startSec !== "number" ||
    typeof range.endSec !== "number" ||
    !Number.isFinite(range.startSec) ||
    !Number.isFinite(range.endSec)
  ) {
    return null;
  }
  const startSec = Math.max(0, Math.min(range.startSec, range.endSec));
  const endSec = Math.max(startSec, Math.max(range.startSec, range.endSec));
  return { startSec, endSec };
}

export function sanitizePersistedViewportRangeNorm(
  value: { startNorm: number; endNorm: number } | null | undefined
): { startNorm: number; endNorm: number } {
  const fallback = { startNorm: 0, endNorm: 1 };
  if (!value) return fallback;
  if (
    typeof value.startNorm !== "number" ||
    typeof value.endNorm !== "number" ||
    !Number.isFinite(value.startNorm) ||
    !Number.isFinite(value.endNorm)
  ) {
    return fallback;
  }
  const startNorm = Math.min(1, Math.max(0, value.startNorm));
  const endNorm = Math.min(1, Math.max(0, value.endNorm));
  const left = Math.min(startNorm, endNorm);
  const right = Math.max(startNorm, endNorm);
  if (right - left < 0.02) {
    return {
      startNorm: Math.max(0, right - 0.02),
      endNorm: Math.min(1, left + 0.02),
    };
  }
  return { startNorm: left, endNorm: right };
}

export function useAnimEditorPersistence(
  panelStorageKey: string,
  persistedState: PersistedAnimEditorState
) {
  const persistStateTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (persistStateTimeoutRef.current !== null) {
        clearTimeout(persistStateTimeoutRef.current);
        persistStateTimeoutRef.current = null;
      }
    },
    []
  );

  React.useEffect(() => {
    if (persistStateTimeoutRef.current !== null) {
      clearTimeout(persistStateTimeoutRef.current);
    }
    persistStateTimeoutRef.current = setTimeout(() => {
      persistStateTimeoutRef.current = null;
      setStorageValue(panelStorageKey, JSON.stringify(persistedState));
    }, 120);
  }, [panelStorageKey, persistedState]);
}
