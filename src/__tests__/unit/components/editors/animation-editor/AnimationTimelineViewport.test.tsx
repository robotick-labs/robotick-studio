import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AnimationTimelineViewport,
  buildDisplaySampleIndices,
  mapClientXToViewportTimeSec,
  mapTimeSecToViewportX,
} from "../../../../../renderer/components/editors/animation-editor/AnimationTimelineViewport";

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it("maps client x to time seconds within the visible viewport range", () => {
    expect(
      mapClientXToViewportTimeSec(300, 100, 400, 2, {
        startNorm: 0,
        endNorm: 1,
      })
    ).toBeCloseTo(1);
    expect(
      mapClientXToViewportTimeSec(300, 100, 400, 4, {
        startNorm: 0.25,
        endNorm: 0.75,
      })
    ).toBeCloseTo(2);
  });
});

describe("AnimationTimelineViewport imperative playhead", () => {
  function makeProps(
    playheadTimeSec: number,
    overrides: Partial<React.ComponentProps<typeof AnimationTimelineViewport>> = {}
  ) {
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
      activeTool: null as "Pencil" | "Line" | "Range" | "Warp" | "Smooth" | null,
      selectedTimeRange: null as { startSec: number; endSec: number } | null,
      rangeFalloffSec: 0,
      smoothBrushPreview: null as { channel: string; centerSec: number } | null,
      warpBrushPreview: null as { channel: string; centerSec: number } | null,
      warpRangeSec: 0.45,
      warpFalloffFraction: 0.12,
      smoothRangeSec: 0.4,
      smoothFalloffSec: 0.2,
      handleLaneHoverChange: vi.fn(),
      handleLaneSelect: vi.fn(),
      setLaneRangeForChannel: vi.fn(),
      fitLaneRangeForChannel: vi.fn(),
      beginDrawStroke: vi.fn(),
      beginRangeOffset: vi.fn(),
      handleSmoothBrushPreviewChange: vi.fn(),
      handleWarpBrushPreviewChange: vi.fn(),
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
      onPlayheadRendered: vi.fn(),
      beginPlayheadDragFromClientX: vi.fn(),
      viewportRangeNorm: { startNorm: 0, endNorm: 1 },
      onViewportRangeNormChange: vi.fn(),
      ...overrides,
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

  it("starts playhead scrubbing from the ruler when a non-range tool is active", () => {
    const beginPlayheadDragFromClientX = vi.fn();
    render(
      <AnimationTimelineViewport
        {...makeProps(0.5, {
          activeTool: "Pencil",
          beginPlayheadDragFromClientX,
        })}
      />
    );

    const overlay = screen.getByTestId("timeline-playhead-overlay").parentElement as HTMLDivElement;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 20,
      left: 100,
      top: 20,
      right: 500,
      bottom: 120,
      width: 400,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(screen.getByTestId("timeline-ruler-hit-area"), {
      button: 0,
      clientX: 300,
      clientY: 30,
    });

    expect(beginPlayheadDragFromClientX).toHaveBeenCalledWith(300);
  });

  it("preserves ruler range selection for the range tool", () => {
    const beginRangeSelection = vi.fn();
    const beginPlayheadDragFromClientX = vi.fn();
    render(
      <AnimationTimelineViewport
        {...makeProps(0.5, {
          activeTool: "Range",
          beginRangeSelection,
          beginPlayheadDragFromClientX,
        })}
      />
    );

    fireEvent.pointerDown(screen.getByTestId("timeline-ruler-hit-area"), {
      button: 0,
      clientX: 300,
      clientY: 30,
    });

    expect(beginRangeSelection).toHaveBeenCalled();
    expect(beginPlayheadDragFromClientX).not.toHaveBeenCalled();
  });

  it("starts playhead scrubbing from lane clicks when no tool is active", () => {
    const beginDrawStroke = vi.fn();
    const beginPlayheadDragFromClientX = vi.fn();
    const { container } = render(
      <AnimationTimelineViewport
        {...makeProps(0.5, {
          visibleChannels: ["jaw_open_norm"],
          clipDataChannels: {
            jaw_open_norm: new Float32Array([0, 0.25, 0.5, 0.75, 1]),
          },
          beginDrawStroke,
          beginPlayheadDragFromClientX,
        })}
      />
    );

    const overlay = screen.getByTestId("timeline-playhead-overlay").parentElement as HTMLDivElement;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 20,
      left: 100,
      top: 20,
      right: 500,
      bottom: 120,
      width: 400,
      height: 100,
      toJSON: () => ({}),
    });

    const laneSvg = container.querySelector("[data-timeline-lane-curve='true']");
    expect(laneSvg).not.toBeNull();

    fireEvent.pointerDown(laneSvg as Element, {
      button: 0,
      clientX: 200,
      clientY: 50,
    });

    expect(beginPlayheadDragFromClientX).toHaveBeenCalledWith(200);
    expect(beginDrawStroke).not.toHaveBeenCalled();
  });
});
