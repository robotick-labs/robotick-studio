import { describe, expect, it } from "vitest";

import { summarizeCadence } from "../../../../renderer/components/viewer/streaming-image/streaming-image-metrics";

describe("streaming-image cadence metrics", () => {
  it("returns zeros when there are no samples", () => {
    expect(summarizeCadence([])).toEqual({
      sampleCount: 0,
      averageMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
    });
  });

  it("computes average and nearest-rank percentiles", () => {
    const summary = summarizeCadence([16, 17, 18, 33, 40]);
    expect(summary.sampleCount).toBe(5);
    expect(summary.averageMs).toBeCloseTo(24.8, 6);
    expect(summary.p50Ms).toBe(18);
    expect(summary.p95Ms).toBe(40);
    expect(summary.maxMs).toBe(40);
  });

  it("ignores negative and non-finite values", () => {
    const summary = summarizeCadence([16, -1, Number.NaN, Number.POSITIVE_INFINITY, 20]);
    expect(summary.sampleCount).toBe(2);
    expect(summary.averageMs).toBe(18);
    expect(summary.p50Ms).toBe(16);
    expect(summary.p95Ms).toBe(20);
    expect(summary.maxMs).toBe(20);
  });
});
