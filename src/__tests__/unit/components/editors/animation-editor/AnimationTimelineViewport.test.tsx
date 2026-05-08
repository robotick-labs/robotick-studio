import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AnimationTimelineViewport,
  buildDisplaySampleIndices,
  mapTimeSecToViewportX,
} from "../../../../../renderer/components/editors/animation-editor/AnimationTimelineViewport";

describe("AnimationTimelineViewport helpers", () => {
  it("maps time seconds to viewport x with clamping", () => {
    expect(mapTimeSecToViewportX(0, 2, 400)).toBe(0);
    expect(mapTimeSecToViewportX(1, 2, 400)).toBe(200);
    expect(mapTimeSecToViewportX(2, 2, 400)).toBe(400);
    expect(mapTimeSecToViewportX(3, 2, 400)).toBe(400);
    expect(mapTimeSecToViewportX(-1, 2, 400)).toBe(0);
  });

  it("builds bounded display sample indices", () => {
    const indices = buildDisplaySampleIndices(10000, 1200);
    expect(indices.length).toBe(1200);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(9999);
  });
});

describe("AnimationTimelineViewport imperative playhead", () => {
  function makeProps(playheadTimeSec: number) {
    return {
      timelineRef: { current: null } as React.RefObject<HTMLDivElement | null>,
      topRulerRef: { current: null } as React.RefObject<HTMLDivElement | null>,
      bottomRulerRef: { current: null } as React.RefObject<HTMLDivElement | null>,
      playheadViewportRef: { current: null } as React.RefObject<HTMLDivElement | null>,
      firstLaneSvgRef: { current: null } as React.RefObject<SVGSVGElement | null>,
      visibleChannels: [] as string[],
      clipDataChannels: {} as Record<string, Float32Array>,
      durationSec: 2,
      laneRange: {} as Record<string, { min: number; max: number }>,
      defaultLaneRangeForChannel: () => ({ min: -1, max: 1 }),
      channelColor: {} as Record<string, string>,
      hoveredChannel: null as string | null,
      selectedChannel: null as string | null,
      activeTool: null as "Pencil" | "Line" | "Range" | "Smooth" | null,
      selectedTimeRange: null as { startSec: number; endSec: number } | null,
      rangeFalloffSec: 0,
      smoothBrushPreview: null as { channel: string; centerSec: number } | null,
      smoothRangeSec: 0.4,
      smoothFalloffSec: 0.2,
      handleLaneHoverChange: vi.fn(),
      handleLaneSelect: vi.fn(),
      setLaneRangeForChannel: vi.fn(),
      fitLaneRangeForChannel: vi.fn(),
      beginDrawStroke: vi.fn(),
      beginRangeOffset: vi.fn(),
      handleSmoothBrushPreviewChange: vi.fn(),
      playheadViewportInsetsPx: { left: 0, right: 0 },
      overlayWidth: 400,
      playheadOverlayMetrics: {
        width: 400,
        height: 100,
        topRulerHeight: 24,
        bottomRulerTop: 76,
        bottomRulerHeight: 24,
        topBlobCenterY: 18,
        bottomBlobCenterY: 82,
      },
      beginRangeSelection: vi.fn(),
      normalizedSelectedTimeRange: null as { startNorm: number; endNorm: number } | null,
      normalizedSelectionFalloff: 0,
      isLoopResetActive: false,
      loopResetSlugRangeNorm: { left: 1, right: 1 },
      rulerMarks: [
        { norm: 0, label: "0.0s" },
        { norm: 0.5, label: "1.0s" },
        { norm: 1, label: "2.0s" },
      ],
      playheadTimeSec,
      beginPlayheadDragFromClientX: vi.fn(),
    };
  }

  it("updates playhead x imperatively when time changes", () => {
    const { rerender } = render(<AnimationTimelineViewport {...makeProps(0.5)} />);

    const line = screen.getByTestId("timeline-playhead-line");
    expect(line).toHaveAttribute("x1", "100.00");
    expect(line).toHaveAttribute("x2", "100.00");

    rerender(<AnimationTimelineViewport {...makeProps(1.5)} />);
    expect(line).toHaveAttribute("x1", "300.00");
    expect(line).toHaveAttribute("x2", "300.00");
  });
});
