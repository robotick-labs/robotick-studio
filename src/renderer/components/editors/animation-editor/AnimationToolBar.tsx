import React from "react";
import { ToolHost } from "./tools/ToolHost";
import type { AnimationToolDefinition, AnimationToolId, AnimationToolSettingsContext } from "./tools/types";

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

type Props = {
  tools: AnimationToolDefinition[];
  activeTool: AnimationToolId | null;
  setActiveTool: React.Dispatch<React.SetStateAction<AnimationToolId | null>>;
  settingsContext: AnimationToolSettingsContext;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
  durationSec: number;
  rangeFalloffFractionStep: number;
  rangeFalloffStepSec: number;
  smoothRangeStepSec: number;
  rangeSizeSec: number;
  setSelectedTimeRangeDurationSec: (nextDurationSec: number) => void;
  setRangeFalloffSec: React.Dispatch<React.SetStateAction<number>>;
  setSmoothFalloffSec: React.Dispatch<React.SetStateAction<number>>;
  setSmoothRangeSec: React.Dispatch<React.SetStateAction<number>>;
  setSmoothStrength: React.Dispatch<React.SetStateAction<number>>;
  setLineSnapStart: React.Dispatch<React.SetStateAction<boolean>>;
  setLineSnapEnd: React.Dispatch<React.SetStateAction<boolean>>;
};

export function AnimationToolBar({
  tools,
  activeTool,
  setActiveTool,
  settingsContext,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  durationSec,
  rangeFalloffFractionStep,
  rangeFalloffStepSec,
  smoothRangeStepSec,
  rangeSizeSec,
  setSelectedTimeRangeDurationSec,
  setRangeFalloffSec,
  setSmoothFalloffSec,
  setSmoothRangeSec,
  setSmoothStrength,
  setLineSnapStart,
  setLineSnapEnd,
}: Props) {
  React.useEffect(() => {
    if (activeTool !== "Range" && activeTool !== "Warp" && activeTool !== "Smooth") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        event.preventDefault();
        const direction = event.code === "BracketRight" ? 1 : -1;
        if (event.shiftKey) {
          if (activeTool === "Range" || activeTool === "Warp") {
            setRangeFalloffSec((current) =>
              Math.min(1, Math.max(0, current + direction * rangeFalloffFractionStep))
            );
          } else {
            setSmoothFalloffSec((current) => Math.min(durationSec, Math.max(0, current + direction * rangeFalloffStepSec)));
          }
          return;
        }
        if (activeTool === "Range" || activeTool === "Warp") {
          setSelectedTimeRangeDurationSec(rangeSizeSec + direction * smoothRangeStepSec);
        } else {
          setSmoothRangeSec((current) => Math.min(durationSec, Math.max(0.01, current + direction * smoothRangeStepSec)));
        }
        return;
      }
      if (activeTool === "Smooth" && (event.key === "-" || event.key === "_" || event.key === "=" || event.key === "+")) {
        event.preventDefault();
        const direction = event.key === "-" || event.key === "_" ? -1 : 1;
        setSmoothStrength((current) => Math.min(1, Math.max(0, current + direction * 0.02)));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeTool,
    durationSec,
    rangeFalloffFractionStep,
    rangeFalloffStepSec,
    rangeSizeSec,
    setRangeFalloffSec,
    setSelectedTimeRangeDurationSec,
    setSmoothFalloffSec,
    setSmoothRangeSec,
    setSmoothStrength,
    smoothRangeStepSec,
  ]);

  React.useEffect(() => {
    if (activeTool !== "Line") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.code === "BracketLeft") {
        event.preventDefault();
        setLineSnapStart((current) => !current);
        return;
      }
      if (event.code === "BracketRight") {
        event.preventDefault();
        setLineSnapEnd((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTool, setLineSnapEnd, setLineSnapStart]);

  return (
    <ToolHost
      tools={tools}
      activeTool={activeTool}
      onToggleTool={(toolId) => setActiveTool((current) => (current === toolId ? null : toolId))}
      settingsContext={settingsContext}
      canUndo={canUndo}
      canRedo={canRedo}
      onUndo={onUndo}
      onRedo={onRedo}
    />
  );
}
