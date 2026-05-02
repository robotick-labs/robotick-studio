import { describe, expect, it } from "vitest";
import {
  buildSampledCurve,
  sampleCubicHermiteMonotone,
} from "../../../../../renderer/components/editors/animation-editor/anim-curve-sampling";

describe("anim-curve-sampling", () => {
  it("clamps to edge key values outside range", () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
    ];
    expect(sampleCubicHermiteMonotone(keys, -1)).toBe(0);
    expect(sampleCubicHermiteMonotone(keys, 2)).toBe(10);
  });

  it("matches linear segment when only two keys exist", () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
    ];
    expect(sampleCubicHermiteMonotone(keys, 0.25)).toBeCloseTo(2.5, 6);
    expect(sampleCubicHermiteMonotone(keys, 0.5)).toBeCloseTo(5.0, 6);
    expect(sampleCubicHermiteMonotone(keys, 0.75)).toBeCloseTo(7.5, 6);
  });

  it("produces cubic interior shape with auto tangents", () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
      { t: 2, v: 0 },
    ];

    // Expected from Hermite basis with engine-style auto tangents.
    expect(sampleCubicHermiteMonotone(keys, 0.5)).toBeCloseTo(0.625, 6);
    expect(sampleCubicHermiteMonotone(keys, 1.5)).toBeCloseTo(0.625, 6);
  });

  it("does not overshoot monotonic segments", () => {
    const keys = [
      { t: 0, v: 1.0 },
      { t: 1, v: 0.7 },
      { t: 2, v: 0.4 },
      { t: 3, v: 0.1 },
    ];
    const sampled = buildSampledCurve(keys, 3, 64);
    for (const point of sampled) {
      expect(point.v).toBeLessThanOrEqual(1.000001);
      expect(point.v).toBeGreaterThanOrEqual(0.099999);
    }
  });

  it("builds sampled curve across full requested duration", () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
      { t: 2, v: 0 },
    ];
    const sampled = buildSampledCurve(keys, 2, 5);
    expect(sampled).toHaveLength(5);
    expect(sampled[0].t).toBeCloseTo(0, 6);
    expect(sampled[4].t).toBeCloseTo(2, 6);
    expect(sampled[0].v).toBeCloseTo(0, 6);
    expect(sampled[4].v).toBeCloseTo(0, 6);
  });
});
