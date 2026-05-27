import type { Point } from "./anim-sample-editing";
import type { LaneRange, TimeSelectionRange } from "./anim-editor-shared";

const MAX_REASONABLE_AXIS_ABS = 1000;

export function fitRangeWithPadding(samples: ArrayLike<number>): LaneRange {
  const sampleCount = samples.length ?? 0;
  if (!sampleCount) return { min: -1, max: 1 };
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const value = Number(samples[i] ?? 0);
    if (!Number.isFinite(value)) continue;
    finiteCount += 1;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (finiteCount === 0) return { min: -1, max: 1 };
  const span = Math.max(1e-6, max - min);
  const pad = span * 0.12;
  const rawMin = min - pad;
  const rawMax = max + pad;

  const roughStep = Math.max(1e-6, (rawMax - rawMin) / 6);
  const exponent = Math.floor(Math.log10(roughStep));
  const base = Math.pow(10, exponent);
  const fraction = roughStep / base;
  let niceFraction = 1;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  const step = niceFraction * base;

  const quantMin = Math.floor(rawMin / step) * step;
  const quantMax = Math.ceil(rawMax / step) * step;
  if (quantMax - quantMin < 1e-6) {
    const boundedMin = Math.max(-MAX_REASONABLE_AXIS_ABS, quantMin - step);
    const boundedMax = Math.min(MAX_REASONABLE_AXIS_ABS, quantMax + step);
    if (boundedMax - boundedMin < 1e-6) return { min: -1, max: 1 };
    return { min: boundedMin, max: boundedMax };
  }
  const boundedMin = Math.max(-MAX_REASONABLE_AXIS_ABS, quantMin);
  const boundedMax = Math.min(MAX_REASONABLE_AXIS_ABS, quantMax);
  if (boundedMax - boundedMin < 1e-6) return { min: -1, max: 1 };
  return { min: boundedMin, max: boundedMax };
}

export function defaultLaneRangeForChannel(channel: string, samples: ArrayLike<number>): LaneRange {
  if (channel.endsWith("_x") || channel.endsWith("_y")) {
    return { min: -1, max: 1 };
  }
  if (channel.endsWith("_norm")) {
    let hasNegativeValue = false;
    for (let i = 0; i < (samples.length ?? 0); i += 1) {
      if (Number(samples[i] ?? 0) < -1e-4) {
        hasNegativeValue = true;
        break;
      }
    }
    return hasNegativeValue ? { min: -1, max: 1 } : { min: 0, max: 1 };
  }
  return fitRangeWithPadding(samples);
}

export function normalizeTimeRange(durationSec: number, range: TimeSelectionRange | null) {
  if (!range || durationSec <= 0) return null;
  const startNorm = Math.min(1, Math.max(0, range.startSec / durationSec));
  const endNorm = Math.min(1, Math.max(0, range.endSec / durationSec));
  return {
    startNorm: Math.min(startNorm, endNorm),
    endNorm: Math.max(startNorm, endNorm),
  };
}

export function closestSamplePointToClientPoint(
  samples: ArrayLike<number>,
  durationSec: number,
  minV: number,
  maxV: number,
  clientX: number,
  clientY: number,
  svg: SVGSVGElement
): Point {
  const sampleCount = samples.length ?? 0;
  if (sampleCount <= 0 || durationSec <= 0) {
    return { t: 0, v: 0 };
  }
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return { t: 0, v: Number(samples[0] ?? 0) };
  }
  const span = Math.max(1e-6, maxV - minV);
  let bestIndex = 0;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < sampleCount; i += 1) {
    const xNorm = sampleCount > 1 ? i / (sampleCount - 1) : 0;
    const value = Number(samples[i] ?? 0);
    const yNorm = Math.min(1, Math.max(0, (maxV - value) / span));
    const sampleClientX = rect.left + xNorm * rect.width;
    const sampleClientY = rect.top + yNorm * rect.height;
    const dx = sampleClientX - clientX;
    const dy = sampleClientY - clientY;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = i;
    }
  }
  const t = sampleCount > 1 ? (bestIndex / (sampleCount - 1)) * durationSec : 0;
  return {
    t,
    v: Number(samples[bestIndex] ?? 0),
  };
}
