export function clampRangeFalloffFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function computeCenteredRangeShape(
  start: number,
  end: number,
  falloffFraction: number
) {
  const normalizedStart = Math.min(start, end);
  const normalizedEnd = Math.max(start, end);
  const midpoint = (normalizedStart + normalizedEnd) * 0.5;
  const halfSpan = Math.max(0, (normalizedEnd - normalizedStart) * 0.5);
  const clampedFalloffFraction = clampRangeFalloffFraction(falloffFraction);
  const coreHalfSpan = halfSpan * (1 - clampedFalloffFraction);
  return {
    start: normalizedStart,
    end: normalizedEnd,
    midpoint,
    halfSpan,
    coreStart: midpoint - coreHalfSpan,
    coreEnd: midpoint + coreHalfSpan,
    falloffPerSide: halfSpan - coreHalfSpan,
    falloffFraction: clampedFalloffFraction,
  };
}
