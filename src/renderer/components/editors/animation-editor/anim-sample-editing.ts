export type Point = { t: number; v: number };

export type SampleDelta = {
  startSampleIndex: number;
  values: number[];
};

export type SampleIndexRange = {
  startSampleIndex: number;
  endSampleIndex: number;
};

export type RangeOffsetWithFalloffResult = {
  samples: Float32Array;
  writeRange: SampleIndexRange;
};

export type SmoothRangeWithFalloffResult = {
  samples: Float32Array;
  writeRange: SampleIndexRange;
};

export type SmoothBrushResult = {
  samples: Float32Array;
  writeRange: SampleIndexRange;
};

export type WarpMode = "value" | "time" | "time+value";

export type WarpRangeWithFalloffResult = {
  samples: Float32Array;
  writeRange: SampleIndexRange;
};

function shapedFalloffWeight(t: number, falloffCurve: number): number {
  const clampedT = Math.min(1, Math.max(0, t));
  const clampedCurve = Math.min(1, Math.max(0, falloffCurve));
  const smoothstep = (value: number) => value * value * (3 - 2 * value);
  return clampedT + (smoothstep(clampedT) - clampedT) * clampedCurve;
}

function rangeWithFalloffBounds(
  sampleCount: number,
  coreRange: SampleIndexRange,
  falloffSampleCount: number
): { clampedCoreStart: number; clampedCoreEnd: number; writeRange: SampleIndexRange } {
  const clampedCoreStart = Math.max(0, coreRange.startSampleIndex);
  const clampedCoreEnd = Math.min(sampleCount - 1, coreRange.endSampleIndex);
  const clampedFalloffCount = Math.max(0, Math.floor(falloffSampleCount));
  return {
    clampedCoreStart,
    clampedCoreEnd,
    writeRange: {
      startSampleIndex: Math.max(0, clampedCoreStart - clampedFalloffCount),
      endSampleIndex: Math.min(sampleCount - 1, clampedCoreEnd + clampedFalloffCount),
    },
  };
}

function readInterpolatedSample(samples: ArrayLike<number>, samplePosition: number): number {
  const sampleCount = samples.length ?? 0;
  if (sampleCount <= 0) return 0;
  const clampedPosition = Math.min(sampleCount - 1, Math.max(0, samplePosition));
  const leftIndex = Math.floor(clampedPosition);
  const rightIndex = Math.min(sampleCount - 1, leftIndex + 1);
  const alpha = clampedPosition - leftIndex;
  const leftValue = Number(samples[leftIndex] ?? 0);
  const rightValue = Number(samples[rightIndex] ?? leftValue);
  return leftValue * (1 - alpha) + rightValue * alpha;
}

function computeRangeInfluenceWeight(
  sampleIndex: number,
  coreStart: number,
  coreEnd: number,
  writeRange: SampleIndexRange,
  falloffCurve: number
): number {
  const leftShoulderCount = coreStart - writeRange.startSampleIndex;
  const rightShoulderCount = writeRange.endSampleIndex - coreEnd;
  let weight = 1;
  if (sampleIndex < coreStart && leftShoulderCount > 0) {
    weight = shapedFalloffWeight(
      (sampleIndex - writeRange.startSampleIndex + 1) / (leftShoulderCount + 1),
      falloffCurve
    );
  } else if (sampleIndex > coreEnd && rightShoulderCount > 0) {
    weight = shapedFalloffWeight(
      (writeRange.endSampleIndex - sampleIndex + 1) / (rightShoulderCount + 1),
      falloffCurve
    );
  }
  return weight;
}

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

export function applyOffsetToSampleRangeWithFalloff(
  samples: ArrayLike<number>,
  coreRange: SampleIndexRange,
  offset: number,
  falloffSampleCount: number,
  falloffCurve = 1
): RangeOffsetWithFalloffResult {
  const sampleCount = samples.length ?? 0;
  const next = samples instanceof Float32Array ? samples.slice() : Float32Array.from(samples);
  const { clampedCoreStart, clampedCoreEnd, writeRange } = rangeWithFalloffBounds(
    sampleCount,
    coreRange,
    falloffSampleCount
  );

  if (
    sampleCount === 0 ||
    clampedCoreEnd < clampedCoreStart ||
    writeRange.endSampleIndex < writeRange.startSampleIndex ||
    offset === 0
  ) {
    return { samples: next, writeRange };
  }

  for (let i = writeRange.startSampleIndex; i <= writeRange.endSampleIndex; i += 1) {
    const weight = computeRangeInfluenceWeight(
      i,
      clampedCoreStart,
      clampedCoreEnd,
      writeRange,
      falloffCurve
    );
    next[i] = next[i] + offset * weight;
  }

  return { samples: next, writeRange };
}

export function applySmoothToSampleRangeWithFalloff(
  samples: ArrayLike<number>,
  coreRange: SampleIndexRange,
  strength: number,
  falloffSampleCount: number,
  falloffCurve = 1
): SmoothRangeWithFalloffResult {
  const sampleCount = samples.length ?? 0;
  const next = samples instanceof Float32Array ? samples.slice() : Float32Array.from(samples);
  const { clampedCoreStart, clampedCoreEnd, writeRange } = rangeWithFalloffBounds(
    sampleCount,
    coreRange,
    falloffSampleCount
  );
  const clampedStrength = Math.min(1, Math.max(0, strength));

  if (
    sampleCount === 0 ||
    clampedCoreEnd < clampedCoreStart ||
    writeRange.endSampleIndex < writeRange.startSampleIndex ||
    clampedStrength <= 1e-6
  ) {
    return { samples: next, writeRange };
  }

  const coreCount = clampedCoreEnd - clampedCoreStart + 1;
  const smoothingRadius = Math.max(1, Math.min(24, Math.round(coreCount * 0.08)));

  for (let i = writeRange.startSampleIndex; i <= writeRange.endSampleIndex; i += 1) {
    const influenceWeight = computeRangeInfluenceWeight(
      i,
      clampedCoreStart,
      clampedCoreEnd,
      writeRange,
      falloffCurve
    );

    let weightedSum = 0;
    let totalWeight = 0;
    const sampleStart = Math.max(0, i - smoothingRadius);
    const sampleEnd = Math.min(sampleCount - 1, i + smoothingRadius);
    for (let s = sampleStart; s <= sampleEnd; s += 1) {
      const kernelWeight = smoothingRadius + 1 - Math.abs(s - i);
      weightedSum += Number(samples[s] ?? 0) * kernelWeight;
      totalWeight += kernelWeight;
    }
    const smoothedValue = totalWeight > 0 ? weightedSum / totalWeight : Number(samples[i] ?? 0);
    const blend = clampedStrength * influenceWeight;
    next[i] = Number(samples[i] ?? 0) * (1 - blend) + smoothedValue * blend;
  }

  return { samples: next, writeRange };
}

export function applySmoothBrushToSamples(
  samples: ArrayLike<number>,
  durationSec: number,
  centerTimeSec: number,
  coreRangeSec: number,
  strength: number,
  falloffSec: number,
  falloffCurve = 1
): SmoothBrushResult {
  const sampleCount = samples.length ?? 0;
  const next = samples instanceof Float32Array ? samples.slice() : Float32Array.from(samples);
  if (sampleCount <= 0 || durationSec <= 0) {
    return {
      samples: next,
      writeRange: { startSampleIndex: 0, endSampleIndex: -1 },
    };
  }

  const lastIndex = sampleCount - 1;
  const centerIndex = sampleIndexFromTime(durationSec, sampleCount, centerTimeSec);
  const coreRadiusSamples = Math.max(
    0,
    Math.round((Math.max(0, coreRangeSec) * 0.5 / durationSec) * lastIndex)
  );
  const falloffRadiusSamples = Math.max(
    0,
    Math.round((Math.max(0, falloffSec) / durationSec) * lastIndex)
  );

  return applySmoothToSampleRangeWithFalloff(
    next,
    {
      startSampleIndex: Math.max(0, centerIndex - coreRadiusSamples),
      endSampleIndex: Math.min(lastIndex, centerIndex + coreRadiusSamples),
    },
    strength,
    falloffRadiusSamples,
    falloffCurve
  );
}

export function applyWarpToSampleRangeWithFalloff(
  samples: ArrayLike<number>,
  durationSec: number,
  coreRange: SampleIndexRange,
  timeOffsetSec: number,
  valueOffset: number,
  falloffSampleCount: number,
  mode: WarpMode,
  timeStrength = 1,
  valueStrength = 1,
  falloffCurve = 1,
  lockEndpoints = true
): WarpRangeWithFalloffResult {
  const sampleCount = samples.length ?? 0;
  const next = samples instanceof Float32Array ? samples.slice() : Float32Array.from(samples);
  const clampedCoreStart = Math.max(0, coreRange.startSampleIndex);
  const clampedCoreEnd = Math.min(sampleCount - 1, coreRange.endSampleIndex);

  if (
    sampleCount === 0 ||
    durationSec <= 0 ||
    clampedCoreEnd < clampedCoreStart
  ) {
    return {
      samples: next,
      writeRange: { startSampleIndex: 0, endSampleIndex: -1 },
    };
  }

  const usesTime = mode === "time" || mode === "time+value";
  const usesValue = mode === "value" || mode === "time+value";
  const sampleOffset =
    sampleCount > 1
      ? (timeOffsetSec / durationSec) * (sampleCount - 1) * Math.min(1, Math.max(0, timeStrength))
      : 0;
  const scaledValueOffset = valueOffset * Math.min(1, Math.max(0, valueStrength));

  if ((!usesTime || Math.abs(sampleOffset) <= 1e-6) && (!usesValue || Math.abs(scaledValueOffset) <= 1e-6)) {
    return {
      samples: next,
      writeRange: {
        startSampleIndex: clampedCoreStart,
        endSampleIndex: clampedCoreEnd,
      },
    };
  }

  const destinationCoreStart = clampedCoreStart + sampleOffset;
  const destinationCoreEnd = clampedCoreEnd + sampleOffset;
  const effectiveCoreStart = Math.min(clampedCoreStart, destinationCoreStart);
  const effectiveCoreEnd = Math.max(clampedCoreEnd, destinationCoreEnd);
  const clampedFalloffCount = Math.max(0, Math.floor(falloffSampleCount));
  const writeRange = {
    startSampleIndex: Math.max(0, Math.floor(effectiveCoreStart) - clampedFalloffCount),
    endSampleIndex: Math.min(sampleCount - 1, Math.ceil(effectiveCoreEnd) + clampedFalloffCount),
  };

  for (let i = writeRange.startSampleIndex; i <= writeRange.endSampleIndex; i += 1) {
    const weight = computeRangeInfluenceWeight(
      i,
      effectiveCoreStart,
      effectiveCoreEnd,
      writeRange,
      falloffCurve
    );
    const baseValue = Number(samples[i] ?? 0);
    let translatedValue = baseValue;
    if (usesTime) {
      translatedValue = readInterpolatedSample(samples, i - sampleOffset);
    }
    if (usesValue) {
      translatedValue += scaledValueOffset;
    }
    if (i >= effectiveCoreStart && i <= effectiveCoreEnd) {
      next[i] = translatedValue;
      continue;
    }
    next[i] = baseValue * (1 - weight) + translatedValue * weight;
  }

  return { samples: next, writeRange };
}
