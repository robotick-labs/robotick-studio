import { describe, expect, it, vi } from "vitest";
import { beginRangeSelectionBehavior } from "../../../../../renderer/components/editors/animation-editor/tools/range/range-behavior";
import { normalizeTimeRangeToViewport } from "../../../../../renderer/components/editors/animation-editor/AnimationTimelineViewport";
import { computeCenteredRangeShape } from "../../../../../renderer/components/editors/animation-editor/tools/range/range-shape";

describe("range-behavior", () => {
  it("maps viewport-space pointer positions into absolute clip time", () => {
    const setSelectedTimeRange = vi.fn();
    const removePointerMove = vi.spyOn(window, "removeEventListener");
    const removePointerUp = vi.spyOn(window, "removeEventListener");
    const addPointerMove = vi
      .spyOn(window, "addEventListener")
      .mockImplementation(() => {});

    const viewportElement = {
      getBoundingClientRect: () =>
        ({
          left: 100,
          width: 400,
        }) as DOMRect,
    } as HTMLElement;

    beginRangeSelectionBehavior({
      activeTool: "Range",
      durationSec: 10,
      viewportRangeNorm: { startNorm: 0.25, endNorm: 0.75 },
      viewportElement,
      event: {
        clientX: 300,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: viewportElement,
      } as unknown as React.PointerEvent<Element>,
      mutations: {
        setSelectedTimeRange,
      },
    });

    expect(setSelectedTimeRange).toHaveBeenCalledWith({
      startSec: 5,
      endSec: 5,
    });

    const moveHandler = addPointerMove.mock.calls.find(
      ([type]) => type === "pointermove"
    )?.[1] as ((event: PointerEvent) => void) | undefined;
    const upHandler = addPointerMove.mock.calls.find(
      ([type]) => type === "pointerup"
    )?.[1] as ((event: PointerEvent) => void) | undefined;

    expect(moveHandler).toBeTypeOf("function");
    expect(upHandler).toBeTypeOf("function");

    moveHandler?.({ clientX: 500 } as PointerEvent);
    expect(setSelectedTimeRange).toHaveBeenLastCalledWith({
      startSec: 5,
      endSec: 7.5,
    });

    upHandler?.({ clientX: 500 } as PointerEvent);
    expect(setSelectedTimeRange).toHaveBeenLastCalledWith({
      startSec: 5,
      endSec: 7.5,
    });

    expect(removePointerMove).toHaveBeenCalledWith("pointermove", moveHandler);
    expect(removePointerUp).toHaveBeenCalledWith("pointerup", upHandler);

    addPointerMove.mockRestore();
    removePointerMove.mockRestore();
    removePointerUp.mockRestore();
  });

  it("normalizes a global time range into viewport-relative coordinates", () => {
    const normalized = normalizeTimeRangeToViewport(
      { startNorm: 0.4, endNorm: 0.6 },
      { startNorm: 0.25, endNorm: 0.75 }
    );
    expect(normalized?.startNorm).toBeCloseTo(0.3, 6);
    expect(normalized?.endNorm).toBeCloseTo(0.7, 6);
  });

  it("treats selection size as total width and falloff as a half-range fraction", () => {
    const shape = computeCenteredRangeShape(2, 6, 0.25);
    expect(shape.midpoint).toBe(4);
    expect(shape.halfSpan).toBe(2);
    expect(shape.coreStart).toBe(2.5);
    expect(shape.coreEnd).toBe(5.5);
    expect(shape.falloffPerSide).toBe(0.5);
  });
});
