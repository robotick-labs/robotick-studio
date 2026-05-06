export type Point = { t: number; v: number };

export type SampleDelta = {
  startSampleIndex: number;
  values: number[];
};

export type SampleIndexRange = {
  startSampleIndex: number;
  endSampleIndex: number;
};

export function sampleIndexFromTime(durationSec: number, sampleCount: number, timeSec: number): number {
  if (sampleCount <= 1 || durationSec <= 0) return 0;
  const clamped = Math.min(durationSec, Math.max(0, timeSec));
  const lastIndex = sampleCount - 1;
  return Math.min(lastIndex, Math.max(0, Math.round((clamped / durationSec) * lastIndex)));
}

export function buildInterpolatedDrawDelta(
  sampleCount: number,
  durationSec: number,
  startPoint: Point,
  endPoint: Point
): SampleDelta | null {
  if (sampleCount <= 0) return null;
  const startIndex = sampleIndexFromTime(durationSec, sampleCount, startPoint.t);
  const endIndex = sampleIndexFromTime(durationSec, sampleCount, endPoint.t);
  const rangeStart = Math.min(startIndex, endIndex);
  const rangeEnd = Math.max(startIndex, endIndex);
  if (rangeStart === rangeEnd) {
    return {
      startSampleIndex: rangeStart,
      values: [endPoint.v],
    };
  }

  const values: number[] = [];
  for (let index = rangeStart; index <= rangeEnd; index += 1) {
    const alpha = (index - rangeStart) / (rangeEnd - rangeStart);
    const value =
      endIndex >= startIndex
        ? startPoint.v + (endPoint.v - startPoint.v) * alpha
        : endPoint.v + (startPoint.v - endPoint.v) * alpha;
    values.push(value);
  }

  return {
    startSampleIndex: rangeStart,
    values,
  };
}

export function sampleIndexRangeFromTimes(
  sampleCount: number,
  durationSec: number,
  startTimeSec: number,
  endTimeSec: number
): SampleIndexRange | null {
  if (sampleCount <= 0) return null;
  const startIndex = sampleIndexFromTime(durationSec, sampleCount, startTimeSec);
  const endIndex = sampleIndexFromTime(durationSec, sampleCount, endTimeSec);
  return {
    startSampleIndex: Math.min(startIndex, endIndex),
    endSampleIndex: Math.max(startIndex, endIndex),
  };
}

export function applySampleDeltaToBuffer(samples: ArrayLike<number>, delta: SampleDelta): Float32Array {
  if ((samples.length ?? 0) === 0 || delta.values.length === 0) {
    return samples instanceof Float32Array ? samples : Float32Array.from(samples);
  }
  const next = samples instanceof Float32Array ? samples.slice() : Float32Array.from(samples);
  const start = Math.max(0, delta.startSampleIndex);
  for (let i = 0; i < delta.values.length && start + i < next.length; i += 1) {
    next[start + i] = delta.values[i];
  }
  return next;
}

export function applyOffsetToSampleRange(
  samples: ArrayLike<number>,
  range: SampleIndexRange,
  offset: number
): Float32Array {
  const sampleCount = samples.length ?? 0;
  if (sampleCount === 0 || range.endSampleIndex < range.startSampleIndex || offset === 0) {
    return samples instanceof Float32Array ? samples : Float32Array.from(samples);
  }
  const next = samples instanceof Float32Array ? samples.slice() : Float32Array.from(samples);
  const start = Math.max(0, range.startSampleIndex);
  const end = Math.min(sampleCount - 1, range.endSampleIndex);
  for (let i = start; i <= end; i += 1) {
    next[i] = next[i] + offset;
  }
  return next;
}
