import type React from "react";
import { sampleIndexRangeFromTimes } from "../../anim-sample-editing";
import { normalizedFromClientX } from "../../playhead-math";
import type { AnimationDocumentMutations, TimeSelectionRange } from "../document";

export const rangeBehaviorId = "range-behavior-v2";

export function beginRangeSelectionBehavior(args: {
  activeTool: "Pencil" | "Line" | "Range" | "Smooth" | null;
  durationSec: number;
  viewportRangeNorm: { startNorm: number; endNorm: number };
  viewportElement: HTMLElement | null;
  event: React.PointerEvent<Element>;
  mutations: Pick<AnimationDocumentMutations, "setSelectedTimeRange">;
}) {
  const { activeTool, durationSec, viewportRangeNorm, viewportElement, event, mutations } = args;
  if (activeTool !== "Range") return;
  event.preventDefault();
  event.stopPropagation();
  const rect =
    viewportElement?.getBoundingClientRect() ??
    event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return;

  const timeFromClientX = (clientX: number) => {
    const viewportRatio = normalizedFromClientX(clientX, rect.left, rect.width);
    const viewportWidthNorm = Math.max(
      1e-6,
      viewportRangeNorm.endNorm - viewportRangeNorm.startNorm
    );
    const globalNorm = Math.min(
      1,
      Math.max(
        0,
        viewportRangeNorm.startNorm + viewportRatio * viewportWidthNorm
      )
    );
    return globalNorm * durationSec;
  };

  const startSec = timeFromClientX(event.clientX);
  mutations.setSelectedTimeRange({ startSec, endSec: startSec });

  const onMove = (moveEvent: PointerEvent) => {
    mutations.setSelectedTimeRange({
      startSec,
      endSec: timeFromClientX(moveEvent.clientX),
    });
  };
  const onUp = (upEvent: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const endSec = timeFromClientX(upEvent.clientX);
    mutations.setSelectedTimeRange({
      startSec: Math.min(startSec, endSec),
      endSec: Math.max(startSec, endSec),
    });
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

export function computeSelectedSampleRange(args: {
  selectedTimeRange: TimeSelectionRange | null;
  channelLength: number;
  durationSec: number;
}) {
  const { selectedTimeRange, channelLength, durationSec } = args;
  if (!selectedTimeRange) return null;
  return sampleIndexRangeFromTimes(
    channelLength,
    durationSec,
    selectedTimeRange.startSec,
    selectedTimeRange.endSec
  );
}
