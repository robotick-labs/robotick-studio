import type { ITelemetryWorkload } from "../../../../data-sources/telemetry";

const USAGE_THRESHOLD_WARNING_YELLOW = 102;
const USAGE_THRESHOLD_ERROR_RED = 110;
export const TICK_DURATION_WINDOW_SIZE = 64;

export type UsageSeverity = "low" | "warning" | "error";

export interface DurationStats {
  lastMs: number;
  meanMs?: number;
  jitterMs?: number;
}

export interface WorkloadStatsSummary {
  workloadDuration: DurationStats;
  actualPeriod: DurationStats;
  goalPeriodMs: number;
  budgetUsagePercent: number;
}

/**
 * Retrieve the raw value of a named statistic from a workload's stats.
 *
 * @param w - The telemetry workload containing stats
 * @param fieldName - The name of the statistic field to retrieve
 * @returns The value of the named statistic, or `undefined` if stats are missing or the field is not found
 */
function getStat(w: ITelemetryWorkload, fieldName: string): unknown {
  const struct = w.stats;
  const fields = struct?.fields;
  if (!fields || !Array.isArray(fields)) return undefined;
  const field = fields.find((f) => f.name === fieldName);
  return field?.getValue();
}

/**
 * Get the numeric value of a named statistic from a telemetry workload.
 *
 * @param w - The telemetry workload to read the statistic from
 * @param fieldName - The name of the statistic field to retrieve
 * @returns The numeric value of the named statistic, or `0` if the statistic is missing or not a finite number
 */
function getNumericStat(w: ITelemetryWorkload, fieldName: string): number {
  const value = getStat(w, fieldName);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Extracts finite numeric samples from a window-like telemetry field on a workload.
 *
 * @param w - The telemetry workload object to read the field from.
 * @param fieldName - The name of the window field (expected to be an object with a `data_buffer` array and optional `count`) to extract samples from.
 * @returns An array of finite numeric samples taken from the field's `data_buffer` (up to `count` if present); returns an empty array if the field is missing or malformed.
 */
function extractWindowSamples(
  w: ITelemetryWorkload,
  fieldName: string
): number[] {
  const windowStruct = getStat(w, fieldName);
  if (!windowStruct || typeof windowStruct !== "object") return [];

  const buffer = (windowStruct as { data_buffer?: unknown }).data_buffer;
  const count = (windowStruct as { count?: unknown }).count;

  if (!Array.isArray(buffer)) return [];

  const maxSamples = buffer.length;
  const usableSamples =
    typeof count === "number" && Number.isFinite(count)
      ? Math.max(0, Math.min(count, maxSamples))
      : maxSamples;

  const samples: number[] = [];
  for (let i = 0; i < usableSamples; i++) {
    const value = buffer[i];
    if (typeof value === "number" && Number.isFinite(value)) {
      samples.push(value);
    }
  }

  return samples;
}

/**
 * Compute the sample mean and jitter (standard deviation) from an array of duration samples measured in nanoseconds.
 *
 * @param samples - Array of duration samples in nanoseconds.
 * @returns An object containing `meanMs` — the sample mean in milliseconds, and `jitterMs` — the sample standard deviation in milliseconds. If `samples` is empty, returns an empty object.
 */
function computeWindowStats(samples: number[]): {
  meanMs?: number;
  jitterMs?: number;
} {
  if (!samples.length) return {};

  const meanNs =
    samples.reduce((acc, value) => acc + value, 0) / samples.length;
  let variance = 0;
  for (const sample of samples) {
    const delta = sample - meanNs;
    variance += delta * delta;
  }
  variance /= samples.length;
  const stdDevNs = Math.sqrt(Math.max(variance, 0));

  return {
    meanMs: meanNs * 1e-6,
    jitterMs: stdDevNs * 1e-6,
  };
}

/**
 * Produce the derived stats required for workload displays.
 *
 * @param workload - The telemetry workload containing raw stats fields.
 * @returns A collection of derived stats in milliseconds and percent for use across UI components.
 */
export function deriveWorkloadStats(
  workload: ITelemetryWorkload
): WorkloadStatsSummary {
  const lastDurationNs = getNumericStat(workload, "last_tick_duration_ns");
  const lastPeriodNs = getNumericStat(workload, "last_time_delta_ns");
  const tickRateHz = getNumericStat(workload, "tick_rate_hz");

  const workloadDurationSamples = extractWindowSamples(
    workload,
    "duration_window"
  );
  const durationWindowStats = computeWindowStats(workloadDurationSamples);

  const periodSamples = extractWindowSamples(workload, "delta_window");
  const periodWindowStats = computeWindowStats(periodSamples);

  const lastDurationMs = lastDurationNs * 1e-6;
  const lastPeriodMs = lastPeriodNs * 1e-6;
  const goalPeriodMs = tickRateHz > 0 ? 1000.0 / tickRateHz : 0;
  const usagePercent =
    goalPeriodMs > 0 ? (100.0 * lastDurationMs) / goalPeriodMs : 0;

  return {
    workloadDuration: {
      lastMs: lastDurationMs,
      meanMs: durationWindowStats.meanMs,
      jitterMs: durationWindowStats.jitterMs,
    },
    actualPeriod: {
      lastMs: lastPeriodMs,
      meanMs: periodWindowStats.meanMs,
      jitterMs: periodWindowStats.jitterMs,
    },
    goalPeriodMs,
    budgetUsagePercent: usagePercent,
  };
}

/**
 * Formats a duration in milliseconds as a string with three decimal places.
 *
 * @param value - Duration in milliseconds to format; if not a finite number or omitted, a placeholder is used.
 * @returns The duration formatted to three decimal places (for example, "12.345"), or "–" when `value` is not a finite number.
 */
export function formatDurationMs(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return value.toFixed(3);
}

/**
 * Format jitter relative to a goal period as a percent string.
 *
 * @param jitterMs - Jitter in milliseconds.
 * @param goalPeriodMs - Target period in milliseconds; must be greater than zero.
 * @returns A percentage string like "12.3%" when both inputs are finite and `goalPeriodMs` > 0, otherwise `undefined`.
 */
export function formatJitterPercent(
  jitterMs?: number,
  goalPeriodMs?: number
): string | undefined {
  if (
    typeof jitterMs !== "number" ||
    !Number.isFinite(jitterMs) ||
    typeof goalPeriodMs !== "number" ||
    !Number.isFinite(goalPeriodMs) ||
    goalPeriodMs <= 0
  ) {
    return undefined;
  }
  const percent = (100 * jitterMs) / goalPeriodMs;
  return `${percent.toFixed(1)}%`;
}

/**
 * Classify budget usage into severity buckets so callers can apply consistent styling.
 *
 * @param usagePercent - Usage percentage to classify.
 * @returns `"low"`, `"warning"`, or `"error"` depending on configured thresholds.
 */
export function classifyUsagePercent(usagePercent: number): UsageSeverity {
  if (usagePercent < USAGE_THRESHOLD_WARNING_YELLOW) return "low";
  if (usagePercent < USAGE_THRESHOLD_ERROR_RED) return "warning";
  return "error";
}
