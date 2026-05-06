import { describe, expect, it } from "vitest";

import {
  applySampleDeltaToBuffer,
  applyOffsetToSampleRange,
  buildInterpolatedDrawDelta,
  sampleIndexRangeFromTimes,
  sampleIndexFromTime,
} from "../../../../../renderer/components/editors/animation-editor/anim-sample-editing";

describe("anim-sample-editing", () => {
  it("maps time to stable sample indices", () => {
    expect(sampleIndexFromTime(1, 11, 0)).toBe(0);
    expect(sampleIndexFromTime(1, 11, 0.5)).toBe(5);
    expect(sampleIndexFromTime(1, 11, 1)).toBe(10);
  });

  it("builds interpolated deltas across all intervening samples", () => {
    const delta = buildInterpolatedDrawDelta(11, 1, { t: 0.2, v: 0.2 }, { t: 0.5, v: 0.8 });
    expect(delta).not.toBeNull();
    expect(delta?.startSampleIndex).toBe(2);
    expect(delta?.values).toHaveLength(4);
    expect(delta?.values[0]).toBeCloseTo(0.2);
    expect(delta?.values[1]).toBeCloseTo(0.4);
    expect(delta?.values[2]).toBeCloseTo(0.6);
    expect(delta?.values[3]).toBeCloseTo(0.8);
  });

  it("applies sample deltas directly to the local sample buffer", () => {
    const samples = new Float32Array([0, 0, 0, 0, 0]);
    const next = applySampleDeltaToBuffer(samples, { startSampleIndex: 1, values: [0.25, 0.5, 0.75] });
    expect(Array.from(next)).toEqual([0, 0.25, 0.5, 0.75, 0]);
  });

  it("builds stable sample index ranges from time ranges", () => {
    expect(sampleIndexRangeFromTimes(11, 1, 0.7, 0.2)).toEqual({
      startSampleIndex: 2,
      endSampleIndex: 7,
    });
  });

  it("offsets all samples in a selected range", () => {
    const samples = new Float32Array([0, 1, 2, 3, 4]);
    const next = applyOffsetToSampleRange(samples, { startSampleIndex: 1, endSampleIndex: 3 }, -0.5);
    expect(Array.from(next)).toEqual([0, 0.5, 1.5, 2.5, 4]);
  });
});
