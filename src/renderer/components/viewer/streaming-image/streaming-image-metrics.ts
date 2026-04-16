export interface CadenceStats {
  sampleCount: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

function percentileNearestRank(sorted: number[], percentile: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(1, percentile));
  const rank = Math.ceil(clamped * sorted.length);
  const index = Math.max(0, Math.min(sorted.length - 1, rank - 1));
  return sorted[index] ?? 0;
}

export function summarizeCadence(intervalsMs: number[]): CadenceStats {
  const clean = intervalsMs
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (clean.length === 0) {
    return {
      sampleCount: 0,
      averageMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
    };
  }

  const total = clean.reduce((sum, value) => sum + value, 0);
  return {
    sampleCount: clean.length,
    averageMs: total / clean.length,
    p50Ms: percentileNearestRank(clean, 0.5),
    p95Ms: percentileNearestRank(clean, 0.95),
    maxMs: clean[clean.length - 1] ?? 0,
  };
}
