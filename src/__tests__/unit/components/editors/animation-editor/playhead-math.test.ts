import { describe, expect, it } from "vitest";
import { clamp01, normalizedFromClientX } from "../../../../../renderer/components/editors/animation-editor/playhead-math";

describe("playhead-math", () => {
  it("clamps normalized values to [0, 1]", () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(3)).toBe(1);
  });

  it("maps client x to normalized with clamping", () => {
    expect(normalizedFromClientX(50, 100, 400)).toBe(0);
    expect(normalizedFromClientX(100, 100, 400)).toBe(0);
    expect(normalizedFromClientX(300, 100, 400)).toBeCloseTo(0.5, 6);
    expect(normalizedFromClientX(500, 100, 400)).toBe(1);
    expect(normalizedFromClientX(650, 100, 400)).toBe(1);
  });

  it("uses safe width fallback for tiny/invalid widths", () => {
    expect(normalizedFromClientX(100, 100, 0)).toBe(0);
    expect(normalizedFromClientX(101, 100, 0)).toBe(1);
  });
});
