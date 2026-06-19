import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Launcher,
  Project,
  ProjectData,
} from "../../../data-sources/launcher";
import {
  type ITelemetryField,
  type ITelemetryModel,
  type ITelemetryProcessThread,
  type ITelemetryStruct,
  type ITelemetryWorkload,
  useTelemetryService,
  useTelemetryStream,
} from "../../../data-sources/telemetry";
import type { ModelSortKey } from "../telemetry/view/TelemetryApp";
import {
  getSpanBlockStyle,
  packSpansIntoSubLanes,
  type TickScopeSpanKind,
  type TickScopeWorkSpan,
} from "./internal/tick-scope-layout";
import { formatBytesWithCommas } from "../telemetry/utils/format-bytes";
import { usePanelSettings } from "../../workbenches/PanelInstanceContext";
import { tickScopePagePersistence } from "./TickScopePage.persistence";
import { publishRendererStartupTiming } from "../../../services/studio-diagnostics";
import { msSinceRendererStartup } from "../../../services/startup-timing";
import styles from "./TickScopePage.module.css";

type WorkSpan = TickScopeWorkSpan;

type ThreadRow = {
  name: string;
  role: string;
  threadId?: number;
  spans: WorkSpan[];
  note?: string;
  copyData?: unknown;
  workerThreads?: ProcessThreadSummary[];
  workerThreadCpuTotalMs?: number | null;
};

type ProcessThreadSummary = {
  threadId: number;
  name: string;
  displayName?: string;
  role?: string;
  cpuTimeNs?: number;
  cpuTimeDeltaNs?: number;
  cpuSampleWindowNs?: number;
  logicalCpuId?: number;
  cpuMs?: number | null;
};

type ModelTick = {
  id: string;
  name: string;
  modelPath: string;
  telemetryBaseUrl: string;
  tickSeq: number;
  periodMs: number;
  slackMs: number;
  status: "healthy" | "tight" | "miss";
  processMemoryUsed: number | null;
  workloadsMemoryUsed: number | null;
  threads: ThreadRow[];
  rawSnapshot: unknown;
};

type TickScopeModelDescriptor = {
  modelName: string;
  modelPath: string;
  telemetryBaseUrl: string;
  telemetryPushRateHz: number;
};

type DeviceTickScope = {
  id: string;
  name: string;
  cpuLabel: string;
  loadLabel: string;
  models: TickScopeModelDescriptor[];
};

type LiveModelEntry = {
  modelName: string;
  modelPath: string;
  telemetryBaseUrl: string;
  model: ITelemetryModel | null;
};

type SmoothingSample = {
  tickSeq: number;
  sampledAtMs: number;
  value: number;
};

type WorkerThreadSortKey = "cpu" | "name" | "thread_id" | "logical_cpu";

const MODEL_SORT_OPTIONS: ReadonlyArray<{
  value: ModelSortKey;
  label: string;
}> = [
  { value: "telemetry_port", label: "Telemetry Port" },
  { value: "model_name", label: "Model Name" },
  { value: "model_path", label: "Model Path" },
  { value: "memory_process", label: "Memory - Process" },
  { value: "memory_workloads", label: "Memory - Workloads" },
];

const WORKER_THREAD_SORT_OPTIONS: ReadonlyArray<{
  value: WorkerThreadSortKey;
  label: string;
}> = [
  { value: "cpu", label: "CPU" },
  { value: "name", label: "Name" },
  { value: "thread_id", label: "TID" },
  { value: "logical_cpu", label: "Core" },
];

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return "0 ms";
  if (Math.abs(value) < 1) return `${value.toFixed(2)} ms`;
  return `${value.toFixed(1)} ms`;
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function nsToMs(valueNs: number): number {
  return roundMs(valueNs / 1_000_000);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  if (Math.abs(value) < 1) return `${value.toFixed(2)}%`;
  if (Math.abs(value) < 10) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function averageThreadCpuMsForPeriod(
  thread: ProcessThreadSummary,
  periodMs: number,
): number | null {
  const deltaNs = thread.cpuTimeDeltaNs;
  if (typeof deltaNs !== "number" || !Number.isFinite(deltaNs) || deltaNs <= 0) {
    return deltaNs === 0 ? 0 : null;
  }
  const sampleWindowNs = thread.cpuSampleWindowNs;
  if (
    typeof sampleWindowNs === "number" &&
    Number.isFinite(sampleWindowNs) &&
    sampleWindowNs > 0
  ) {
    return (deltaNs / sampleWindowNs) * periodMs;
  }
  return nsToMs(deltaNs);
}

function totalThreadCpuMsForPeriod(
  threads: ProcessThreadSummary[],
  periodMs: number,
): number | null {
  let total = 0;
  let hasSample = false;
  for (const thread of threads) {
    const value = thread.cpuMs ?? averageThreadCpuMsForPeriod(thread, periodMs);
    if (value == null) continue;
    total += value;
    hasSample = true;
  }
  return hasSample ? total : null;
}

function workerThreadCpuMs(thread: ProcessThreadSummary, periodMs: number): number | null {
  return thread.cpuMs ?? averageThreadCpuMsForPeriod(thread, periodMs);
}

function compareNullableNumbers(
  lhs: number | null | undefined,
  rhs: number | null | undefined,
  direction: "asc" | "desc",
): number {
  const lhsValid = typeof lhs === "number" && Number.isFinite(lhs);
  const rhsValid = typeof rhs === "number" && Number.isFinite(rhs);
  if (!lhsValid && !rhsValid) return 0;
  if (!lhsValid) return 1;
  if (!rhsValid) return -1;
  return direction === "asc" ? lhs - rhs : rhs - lhs;
}

function sortWorkerThreads(
  threads: ProcessThreadSummary[] | undefined,
  sortKey: WorkerThreadSortKey,
  periodMs: number,
): ProcessThreadSummary[] {
  return [...(threads ?? [])].sort((lhs, rhs) => {
    let result = 0;
    switch (sortKey) {
      case "cpu":
        result = compareNullableNumbers(
          workerThreadCpuMs(lhs, periodMs),
          workerThreadCpuMs(rhs, periodMs),
          "desc",
        );
        break;
      case "name":
        result = (lhs.displayName?.trim() || lhs.name).localeCompare(
          rhs.displayName?.trim() || rhs.name,
        );
        break;
      case "thread_id":
        result = lhs.threadId - rhs.threadId;
        break;
      case "logical_cpu":
        result = compareNullableNumbers(lhs.logicalCpuId, rhs.logicalCpuId, "asc");
        break;
    }
    return result || lhs.threadId - rhs.threadId;
  });
}

function relativeMs(valueNs: number, originNs: number): number {
  return roundMs((valueNs - originNs) / 1_000_000);
}

function rawPhaseSnapshot(
  startNs: number,
  endNs: number,
  originNs: number,
): { startNs: number; endNs: number; startMs: number; endMs: number; durationMs: number } | null {
  if (endNs <= startNs) return null;
  return {
    startNs,
    endNs,
    startMs: relativeMs(startNs, originNs),
    endMs: relativeMs(endNs, originNs),
    durationMs: nsToMs(endNs - startNs),
  };
}

function timeWeightedAverageSmoothingSamples(
  samples: SmoothingSample[],
  oldestMs: number,
  nowMs: number,
): number | null {
  if (samples.length === 0) return null;
  if (samples.length === 1) return samples[0].value;

  let weightedTotal = 0;
  let durationTotal = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const nextSample = samples[index + 1];
    const segmentStart = Math.max(oldestMs, sample.sampledAtMs);
    const segmentEnd = Math.min(nowMs, nextSample?.sampledAtMs ?? nowMs);
    const durationMs = Math.max(0, segmentEnd - segmentStart);
    if (durationMs <= 0) continue;
    weightedTotal += sample.value * durationMs;
    durationTotal += durationMs;
  }

  return durationTotal > 0 ? weightedTotal / durationTotal : samples[samples.length - 1].value;
}

function smoothTimeValue(
  key: string,
  value: number | null | undefined,
  tickSeq: number,
  smoothingDurationSeconds: number,
  nowMs: number,
  history: Map<string, SmoothingSample[]>,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;

  const windowMs = smoothingDurationSeconds * 1000;
  const oldestMs = nowMs - windowMs;
  const existingSamples = history.get(key) ?? [];
  const samples = existingSamples.filter(
    (sample) => sample.sampledAtMs >= oldestMs,
  );
  const previousSample = existingSamples
    .filter((sample) => sample.sampledAtMs < oldestMs)
    .at(-1);
  if (previousSample) {
    samples.unshift(previousSample);
  }
  const lastSample = samples[samples.length - 1];
  if (lastSample?.tickSeq === tickSeq) {
    samples[samples.length - 1] = { tickSeq, sampledAtMs: nowMs, value };
  } else {
    samples.push({ tickSeq, sampledAtMs: nowMs, value });
  }
  history.set(key, samples);
  return timeWeightedAverageSmoothingSamples(samples, oldestMs, nowMs);
}

function statusForSlack(slackMs: number, periodMs: number): ModelTick["status"] {
  return slackMs < 0 ? "miss" : slackMs < periodMs * 0.1 ? "tight" : "healthy";
}

function applyTickScopeSmoothing(
  modelTick: ModelTick,
  smoothingDurationSeconds: number,
  history: Map<string, SmoothingSample[]>,
): ModelTick {
  if (!Number.isFinite(smoothingDurationSeconds) || smoothingDurationSeconds <= 0) {
    history.clear();
    return modelTick;
  }

  const nowMs = performance.now();
  const seenKeys = new Set<string>();
  const smooth = (key: string, value: number | null | undefined) => {
    seenKeys.add(key);
    return smoothTimeValue(
      key,
      value,
      modelTick.tickSeq,
      smoothingDurationSeconds,
      nowMs,
      history,
    );
  };

  const periodMs = smooth("model:periodMs", modelTick.periodMs) ?? modelTick.periodMs;
  const slackMs = smooth("model:slackMs", modelTick.slackMs) ?? modelTick.slackMs;
  const threads = modelTick.threads.map((thread) => {
    const threadKey = thread.threadId != null ? `thread:${thread.threadId}` : `thread:${thread.name}`;
    const spans = thread.spans.map((span, index) => {
      const spanKey = `${threadKey}:span:${index}:${span.kind}:${span.workload}`;
      const startMs = smooth(`${spanKey}:startMs`, span.startMs) ?? span.startMs;
      const endMs = smooth(`${spanKey}:endMs`, span.endMs) ?? span.endMs;
      return {
        ...span,
        startMs,
        endMs: Math.max(startMs, endMs),
        carryOutMs: span.carryOutMs == null
          ? undefined
          : smooth(`${spanKey}:carryOutMs`, span.carryOutMs) ?? span.carryOutMs,
      };
    });
    const workerThreads = thread.workerThreads?.map((worker) => {
      const cpuMs = smooth(
        `${threadKey}:worker:${worker.threadId}:cpuMs`,
        averageThreadCpuMsForPeriod(worker, modelTick.periodMs),
      );
      return { ...worker, cpuMs };
    });
    return {
      ...thread,
      spans,
      workerThreads,
      workerThreadCpuTotalMs: workerThreads
        ? totalThreadCpuMsForPeriod(workerThreads, periodMs)
        : thread.workerThreadCpuTotalMs,
    };
  });

  for (const key of history.keys()) {
    if (!seenKeys.has(key)) history.delete(key);
  }

  return {
    ...modelTick,
    periodMs,
    slackMs,
    status: statusForSlack(slackMs, periodMs),
    threads,
  };
}

function jsonForClipboard(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function statusLabel(status: ModelTick["status"]): string {
  switch (status) {
    case "healthy":
      return "healthy";
    case "tight":
      return "tight";
    case "miss":
      return "miss";
  }
}

function findNestedField(
  root: ITelemetryStruct | undefined,
  path: string[],
): ITelemetryField | undefined {
  let fields = root?.fields;
  let found: ITelemetryField | undefined;
  for (const part of path) {
    found = fields?.find((field) => field.name === part);
    if (!found) return undefined;
    fields = found.fields;
  }
  return found;
}

function numericStat(
  workload: ITelemetryWorkload,
  path: string[],
): number | null {
  const value = findNestedField(workload.stats, path)?.getValue();
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function deviceIdFor(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname || "local";
  } catch {
    const hostWithoutPort = baseUrl.trim().split("/")[0]?.split(":")[0];
    return hostWithoutPort || "local";
  }
}

function extractPort(url?: string): number {
  if (!url) return 0;
  try {
    const parsed = new URL(url);
    return parseInt(parsed.port || "0", 10);
  } catch {
    return 0;
  }
}

function compareTickScopeModels(
  left: TickScopeModelDescriptor,
  right: TickScopeModelDescriptor,
  sortKey: ModelSortKey,
  getLatestMetrics: (
    baseUrl: string,
  ) => { processMemoryUsed: number; workloadsMemoryUsed: number },
): number {
  switch (sortKey) {
    case "model_name":
      return left.modelName.localeCompare(right.modelName);
    case "model_path":
      return left.modelPath.localeCompare(right.modelPath);
    case "memory_process": {
      const leftMetrics = getLatestMetrics(left.telemetryBaseUrl);
      const rightMetrics = getLatestMetrics(right.telemetryBaseUrl);
      const byProcess =
        rightMetrics.processMemoryUsed - leftMetrics.processMemoryUsed;
      if (byProcess !== 0) return byProcess;
      return left.modelName.localeCompare(right.modelName);
    }
    case "memory_workloads": {
      const leftMetrics = getLatestMetrics(left.telemetryBaseUrl);
      const rightMetrics = getLatestMetrics(right.telemetryBaseUrl);
      const byWorkloads =
        rightMetrics.workloadsMemoryUsed - leftMetrics.workloadsMemoryUsed;
      if (byWorkloads !== 0) return byWorkloads;
      return left.modelName.localeCompare(right.modelName);
    }
    case "telemetry_port":
    default: {
      const portA = extractPort(left.telemetryBaseUrl);
      const portB = extractPort(right.telemetryBaseUrl);
      if (portA !== portB) return portA - portB;
      return left.telemetryBaseUrl.localeCompare(right.telemetryBaseUrl);
    }
  }
}

function formatThreadName(
  threadId: number,
  threadInfo?: ITelemetryProcessThread,
  isMainThread = false,
): string {
  const rawName = threadInfo?.displayName?.trim() || threadInfo?.name?.trim();
  const baseName = rawName && rawName !== `thread ${threadId}` ? rawName : "thread";
  const suffix = isMainThread ? " main" : "";
  return `${baseName}${suffix} - tid ${threadId}`;
}

function toModelTick(entry: LiveModelEntry): ModelTick | null {
  const model = entry.model;
  if (!model?.raw) return null;

  const rawSpans = model.workloads
    .map((workload) => {
      const tickSeq = numericStat(workload, ["latest_span", "tick_seq"]) ?? 0;
      const scheduledStartNs =
        numericStat(workload, ["latest_span", "scheduled_start_time_ns"]) ?? 0;
      const scheduledEndNs =
        numericStat(workload, ["latest_span", "scheduled_end_time_ns"]) ?? 0;
      const startNs = numericStat(workload, ["latest_span", "start_time_ns"]) ?? 0;
      const endNs = numericStat(workload, ["latest_span", "end_time_ns"]) ?? 0;
      const waitTotalNs =
        numericStat(workload, ["latest_span", "wait_total_ns"]) ?? 0;
      const waitRequestedNs =
        numericStat(workload, ["latest_span", "wait_requested_ns"]) ?? 0;
      const wakeLatenessNs =
        numericStat(workload, ["latest_span", "wake_lateness_ns"]) ?? 0;
      const engineIoStartNs =
        numericStat(workload, ["latest_span", "engine_io_start_time_ns"]) ?? 0;
      const engineIoEndNs =
        numericStat(workload, ["latest_span", "engine_io_end_time_ns"]) ?? 0;
      const syncWaitStartNs =
        numericStat(workload, ["latest_span", "sync_wait_start_time_ns"]) ?? 0;
      const syncWaitEndNs =
        numericStat(workload, ["latest_span", "sync_wait_end_time_ns"]) ?? 0;
      const localInputsStartNs =
        numericStat(workload, ["latest_span", "local_inputs_start_time_ns"]) ?? 0;
      const localInputsEndNs =
        numericStat(workload, ["latest_span", "local_inputs_end_time_ns"]) ?? 0;
      const sleepYieldStartNs =
        numericStat(workload, ["latest_span", "sleep_yield_start_time_ns"]) ?? 0;
      const sleepYieldEndNs =
        numericStat(workload, ["latest_span", "sleep_yield_end_time_ns"]) ?? 0;
      const cpuStart =
        numericStat(workload, ["latest_span", "logical_cpu_start_id"]) ?? -1;
      const cpuEnd =
        numericStat(workload, ["latest_span", "logical_cpu_end_id"]) ?? cpuStart;
      const kernelThreadId =
        numericStat(workload, ["latest_span", "kernel_thread_id"]) ??
        numericStat(workload, ["latest_span", "thread_id"]) ??
        0;
      const isRunning = Boolean(
        findNestedField(workload.stats, ["latest_span", "is_running"])?.getValue(),
      );

      if (tickSeq <= 0 || scheduledEndNs <= scheduledStartNs) {
        return null;
      }

      return {
        workload,
        tickSeq,
        scheduledStartNs,
        scheduledEndNs,
        startNs,
        endNs: isRunning ? Math.max(endNs, startNs) : endNs,
        waitTotalNs,
        waitRequestedNs,
        wakeLatenessNs,
        engineIoStartNs,
        engineIoEndNs,
        syncWaitStartNs,
        syncWaitEndNs,
        localInputsStartNs,
        localInputsEndNs,
        sleepYieldStartNs,
        sleepYieldEndNs,
        cpuStart,
        cpuEnd,
        kernelThreadId,
      };
    })
    .filter((span): span is NonNullable<typeof span> => span != null);

  if (rawSpans.length === 0) return null;

  const originNs = Math.min(...rawSpans.map((span) => span.scheduledStartNs));
  const scheduledEndNs = Math.max(...rawSpans.map((span) => span.scheduledEndNs));
  const visibleEndNs = Math.max(
    scheduledEndNs,
    ...rawSpans.map((span) => span.endNs),
    ...rawSpans.map((span) => span.sleepYieldEndNs),
    ...rawSpans.map((span) => span.engineIoEndNs),
    ...rawSpans.map((span) => span.syncWaitEndNs),
    ...rawSpans.map((span) => span.localInputsEndNs),
  );
  const activeEndNs = Math.max(
    ...rawSpans.map((span) => span.endNs),
    ...rawSpans.map((span) => span.engineIoEndNs),
    ...rawSpans.map((span) => span.syncWaitEndNs),
    ...rawSpans.map((span) => span.localInputsEndNs),
  );
  const periodMs = Math.max(0.001, (scheduledEndNs - originNs) / 1_000_000);
  const threadRows = new Map<string, ThreadRow>();
  const seenThreadIds = new Set<number>();
  const processThreads = [...(model.process_threads ?? [])].sort(
    (lhs, rhs) => lhs.threadId - rhs.threadId,
  );
  const processThreadsById = new Map(
    processThreads.map((thread) => [thread.threadId, thread]),
  );
  const mainThreadId = processThreads[0]?.threadId ?? null;

  const rawWorkloads = rawSpans.map((span) => {
    const threadInfo = processThreadsById.get(span.kernelThreadId);
    const activeEndForSpan = Math.max(
      span.endNs,
      span.engineIoEndNs,
      span.syncWaitEndNs,
      span.localInputsEndNs,
    );
    const phases = {
      engineIo: rawPhaseSnapshot(span.engineIoStartNs, span.engineIoEndNs, originNs),
      syncWait: rawPhaseSnapshot(span.syncWaitStartNs, span.syncWaitEndNs, originNs),
      localInputs: rawPhaseSnapshot(span.localInputsStartNs, span.localInputsEndNs, originNs),
      workload: rawPhaseSnapshot(span.startNs, span.endNs, originNs),
      sleepYield: rawPhaseSnapshot(span.sleepYieldStartNs, span.sleepYieldEndNs, originNs),
    };
    const snapshot = {
      workloadName: span.workload.name,
      workloadType: span.workload.type,
      tickSeq: span.tickSeq,
      threadId: span.kernelThreadId,
      threadName: threadInfo?.name ?? null,
      logicalCpuStartId: span.cpuStart,
      logicalCpuEndId: span.cpuEnd,
      scheduledStartTimeNs: span.scheduledStartNs,
      scheduledEndTimeNs: span.scheduledEndNs,
      startTimeNs: span.startNs,
      endTimeNs: span.endNs,
      waitTotalNs: span.waitTotalNs,
      sleepYieldStartTimeNs: span.sleepYieldStartNs,
      sleepYieldEndTimeNs: span.sleepYieldEndNs,
      scheduledStartMs: relativeMs(span.scheduledStartNs, originNs),
      scheduledEndMs: relativeMs(span.scheduledEndNs, originNs),
      startMs: relativeMs(span.startNs, originNs),
      endMs: relativeMs(span.endNs, originNs),
      durationMs: nsToMs(span.endNs - span.startNs),
      activeSlackMs: nsToMs(span.scheduledEndNs - activeEndForSpan),
      startOffsetMs: nsToMs(span.startNs - span.scheduledStartNs),
      phases,
      waitStats: {
        requestedMs: nsToMs(span.waitRequestedNs),
        totalMs: nsToMs(span.waitTotalNs),
        wakeLatenessMs: nsToMs(span.wakeLatenessNs),
      },
    };
    return snapshot;
  });

  for (const span of rawSpans) {
    seenThreadIds.add(span.kernelThreadId);
    const threadKey =
      span.kernelThreadId > 0 ? String(span.kernelThreadId) : "unknown";
    let row = threadRows.get(threadKey);
    if (!row) {
      const threadInfo = processThreadsById.get(span.kernelThreadId);
      const isMainThread =
        mainThreadId != null && span.kernelThreadId === mainThreadId;
      row = {
        name:
          span.kernelThreadId > 0
            ? formatThreadName(span.kernelThreadId, threadInfo, isMainThread)
            : "unknown thread",
        role: isMainThread ? "main loop" : "",
        threadId: span.kernelThreadId > 0 ? span.kernelThreadId : undefined,
        spans: [],
      };
      threadRows.set(threadKey, row);
    }

    const carryOutNs = Math.max(0, span.endNs - span.scheduledEndNs);
    const addPhase = (
      workload: string,
      kind: TickScopeSpanKind,
      startNs: number,
      endNs: number,
    ) => {
      if (endNs <= startNs) return;
      row.spans.push({
        workload,
        kind,
        startMs: (startNs - originNs) / 1_000_000,
        endMs: (endNs - originNs) / 1_000_000,
        cpuStart: span.cpuStart,
        cpuEnd: span.cpuStart,
      });
    };

    addPhase("engine I/O", "engine_io", span.engineIoStartNs, span.engineIoEndNs);
    addPhase("sync wait", "sync_wait", span.syncWaitStartNs, span.syncWaitEndNs);
    addPhase("local inputs", "local_inputs", span.localInputsStartNs, span.localInputsEndNs);

    row.spans.push({
      workload: span.workload.name,
      kind: carryOutNs > 0 ? "carry" : "useful",
      startMs: (span.startNs - originNs) / 1_000_000,
      endMs: (span.endNs - originNs) / 1_000_000,
      cpuStart: span.cpuStart,
      cpuEnd: span.cpuEnd,
      carryOutMs: carryOutNs > 0 ? carryOutNs / 1_000_000 : undefined,
    });

    addPhase("sleep/yield", "sleep", span.sleepYieldStartNs, span.sleepYieldEndNs);
  }

  for (const row of threadRows.values()) {
    const workloadNames = new Set(
      row.spans
        .filter(
          (span) =>
            span.kind !== "engine_io" &&
            span.kind !== "sync_wait" &&
            span.kind !== "local_inputs" &&
            span.kind !== "sleep",
        )
        .map((span) => span.workload),
    );
    if (row.role === "" && workloadNames.size === 1) {
      row.name = [...workloadNames][0] ?? row.name;
    }
  }

  if (mainThreadId != null && !seenThreadIds.has(mainThreadId)) {
    const mainThread = processThreadsById.get(mainThreadId);
    threadRows.set(`main-${mainThreadId}`, {
      name: formatThreadName(mainThreadId, mainThread, true),
      role: "main loop",
      threadId: mainThreadId,
      note: "present in process, no Robotick span in latest tick",
      spans: [],
    });
  }

  const unmatchedProcessThreads = processThreads.filter(
    (thread) =>
      !seenThreadIds.has(thread.threadId) && thread.threadId !== mainThreadId,
  );
  if (unmatchedProcessThreads.length > 0) {
    const workerThreads = unmatchedProcessThreads.map((thread) => ({
      threadId: thread.threadId,
      name: thread.name,
      displayName: thread.displayName,
      role: thread.role,
      cpuTimeNs: thread.cpuTimeNs,
      cpuTimeDeltaNs: thread.cpuTimeDeltaNs,
      cpuSampleWindowNs: thread.cpuSampleWindowNs,
      logicalCpuId: thread.logicalCpuId,
    }));
    threadRows.set("process-workers", {
      name: `+${unmatchedProcessThreads.length} process worker threads`,
      role: "observed",
      note: "present in process, no Robotick span in latest tick",
      spans: [],
      workerThreads,
      workerThreadCpuTotalMs: totalThreadCpuMsForPeriod(workerThreads, periodMs),
      copyData: {
        note: "present in process, no Robotick span in latest tick",
        threads: workerThreads,
      },
    });
  }

  const slackMs = (scheduledEndNs - activeEndNs) / 1_000_000;
  const status = statusForSlack(slackMs, periodMs);
  const tickSeq = Math.max(...rawSpans.map((span) => span.tickSeq));
  const threads = [...threadRows.values()];

  const rawSnapshot = {
    modelName: entry.modelName,
    telemetryBaseUrl: entry.telemetryBaseUrl,
    tickSeq,
    originTimeNs: originNs,
    scheduledEndTimeNs: scheduledEndNs,
    tickWindowMs: roundMs(periodMs),
    activeSlackMs: roundMs(slackMs),
    status,
    processThreads: processThreads.map((thread) => ({
      threadId: thread.threadId,
      name: thread.name,
      displayName: thread.displayName,
      role: thread.role,
      cpuTimeNs: thread.cpuTimeNs,
      cpuTimeDeltaNs: thread.cpuTimeDeltaNs,
      cpuSampleWindowNs: thread.cpuSampleWindowNs,
      logicalCpuId: thread.logicalCpuId,
    })),
    workloads: rawWorkloads,
  };

  return {
    id: entry.telemetryBaseUrl,
    name: entry.modelName,
    modelPath: entry.modelPath,
    telemetryBaseUrl: entry.telemetryBaseUrl,
    tickSeq,
    periodMs,
    slackMs,
    status,
    processMemoryUsed: finiteNumber(model.process_memory_used),
    workloadsMemoryUsed: finiteNumber(model.workloads_buffer_size_used),
    threads,
    rawSnapshot,
  };
}

export default function TickScopePage() {
  const { projectPath } = Project.Context.use();
  const { status } = Launcher.Context.use();
  const { projectModels } = ProjectData.use();
  const telemetryService = useTelemetryService();
  const [settings, updateSettings] = usePanelSettings(tickScopePagePersistence);
  const [paused, setPaused] = useState(false);
  const publishedMountTimingRef = useRef(false);
  const publishedActiveTimingRef = useRef(false);
  const [smoothingDurationInput, setSmoothingDurationInput] = useState(
    String(settings.smoothingDurationSeconds),
  );
  useEffect(() => {
    if (publishedMountTimingRef.current) {
      return;
    }
    publishedMountTimingRef.current = true;
    publishRendererStartupTiming("tick_scope_mounted_ms", msSinceRendererStartup());
  }, []);
  useEffect(() => {
    setSmoothingDurationInput(String(settings.smoothingDurationSeconds));
  }, [settings.smoothingDurationSeconds]);
  const smoothingDurationSeconds = useMemo(() => {
    const parsed = Number(settings.smoothingDurationSeconds);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [settings.smoothingDurationSeconds]);

  const telemetryDescriptors = useMemo<TickScopeModelDescriptor[]>(
    () =>
      projectModels.data
        .filter((model) => Boolean(model.telemetryBaseUrl))
        .map((model) => ({
          modelName: model.modelName,
          modelPath: model.modelPath,
          telemetryBaseUrl: model.telemetryBaseUrl,
          telemetryPushRateHz: Math.max(1, model.telemetryPushRateHz || 20),
        }))
        .sort((left, right) =>
          compareTickScopeModels(left, right, settings.modelSortKey, (baseUrl) => {
            const latest = telemetryService.getLatestModel(baseUrl);
            return {
              processMemoryUsed: latest?.process_memory_used ?? -1,
              workloadsMemoryUsed: latest?.workloads_buffer_size_used ?? -1,
            };
          }),
        ),
    [projectModels.data, settings.modelSortKey, telemetryService],
  );

  const devices = useMemo<DeviceTickScope[]>(() => {
    const byDevice = new Map<string, DeviceTickScope>();
    for (const descriptor of telemetryDescriptors) {
      const deviceId = deviceIdFor(descriptor.telemetryBaseUrl);
      let device = byDevice.get(deviceId);
      if (!device) {
        device = {
          id: deviceId,
          name: deviceId,
          cpuLabel: "logical CPUs sampled per span",
          loadLabel: "latest Robotick tick",
          models: [],
        };
        byDevice.set(deviceId, device);
      }
      device.models.push(descriptor);
    }
    return [...byDevice.values()];
  }, [telemetryDescriptors]);

  useEffect(() => {
    if (publishedActiveTimingRef.current) {
      return;
    }
    if (!projectPath || status !== "running" || projectModels.loading || devices.length === 0) {
      return;
    }
    requestAnimationFrame(() => {
      if (publishedActiveTimingRef.current) {
        return;
      }
      publishedActiveTimingRef.current = true;
      publishRendererStartupTiming("tick_scope_active_ms", msSinceRendererStartup());
    });
  }, [devices.length, projectModels.loading, projectPath, status]);

  let body: React.ReactNode;
  if (!projectPath) {
    body = <p className={styles.message}>Select a project to view Tick Scope.</p>;
  } else if (status !== "running") {
    body = <p className={styles.message}>Launch your robot to enable Tick Scope.</p>;
  } else if (projectModels.loading) {
    body = <p className={styles.message}>Loading telemetry models...</p>;
  } else if (devices.length === 0) {
    body = <p className={styles.message}>No telemetry models available.</p>;
  } else {
    body = (
      <div className={styles.deviceList}>
        {devices.map((device) => (
          <DeviceSection
            key={device.id}
            device={device}
            paused={paused}
            smoothingDurationSeconds={smoothingDurationSeconds}
            showCpuIds={settings.showCpuIds}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Tick Scope</h1>
          <p>Project-wide latest tick layout</p>
          <div className={styles.headerControls}>
            <button
              className={`${styles.pauseButton} ${paused ? styles.pauseButtonActive : ""}`}
              type="button"
              onClick={() => setPaused((current) => !current)}
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <label className={styles.smoothingControl}>
              <span>Smooth</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={smoothingDurationInput}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSmoothingDurationInput(nextValue);
                  const parsed = Number(nextValue);
                  updateSettings({
                    smoothingDurationSeconds:
                      Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
                  });
                }}
                aria-label="Tick Scope smoothing window in seconds"
              />
              <span>s</span>
            </label>
            <button
              className={`${styles.headerToggleButton} ${settings.showCpuIds ? styles.headerToggleButtonActive : ""}`}
              type="button"
              aria-pressed={settings.showCpuIds}
              onClick={() => updateSettings({ showCpuIds: !settings.showCpuIds })}
            >
              CPU IDs
            </button>
          </div>
        </div>
        <label className={styles.panelHeaderControlLabel}>
          Sort models by:
          <select
            id="tick-scope-model-sort"
            className={styles.panelHeaderControlSelect}
            value={settings.modelSortKey}
            onChange={(event) =>
              updateSettings({ modelSortKey: event.target.value as ModelSortKey })
            }
          >
            {MODEL_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {body}
    </div>
  );
}

const DeviceSection = memo(function DeviceSection({
  device,
  paused,
  smoothingDurationSeconds,
  showCpuIds,
}: {
  device: DeviceTickScope;
  paused: boolean;
  smoothingDurationSeconds: number;
  showCpuIds: boolean;
}) {
  return (
    <section className={styles.deviceSection}>
      <div className={styles.deviceHeader}>
        <div>
          <h2>{device.name}</h2>
          <p>
            {device.cpuLabel} · {device.loadLabel}
          </p>
        </div>
        <span>{device.models.length} models</span>
      </div>
      <div className={styles.modelGrid}>
        {device.models.map((model) => (
          <LiveModelCard
            key={model.telemetryBaseUrl}
            descriptor={model}
            paused={paused}
            smoothingDurationSeconds={smoothingDurationSeconds}
            showCpuIds={showCpuIds}
          />
        ))}
      </div>
    </section>
  );
});

const LiveModelCard = memo(function LiveModelCard({
  descriptor,
  paused,
  smoothingDurationSeconds,
  showCpuIds,
}: {
  descriptor: TickScopeModelDescriptor;
  paused: boolean;
  smoothingDurationSeconds: number;
  showCpuIds: boolean;
}) {
  const pausedModelTickRef = useRef<ModelTick | null>(null);
  const smoothingHistoryRef = useRef<Map<string, SmoothingSample[]>>(new Map());
  const publishedFirstTelemetryRef = useRef(false);
  const { model, revision } = useTelemetryStream(
    descriptor.telemetryBaseUrl,
    descriptor.telemetryPushRateHz,
  );

  const modelTick = useMemo(
    () =>
      toModelTick({
        modelName: descriptor.modelName,
        modelPath: descriptor.modelPath,
        telemetryBaseUrl: descriptor.telemetryBaseUrl,
        model,
      }),
    [descriptor.modelName, descriptor.telemetryBaseUrl, model, revision],
  );
  const smoothedModelTick =
    modelTick && !paused
      ? applyTickScopeSmoothing(
          modelTick,
          smoothingDurationSeconds,
          smoothingHistoryRef.current,
        )
      : modelTick;
  if (!paused && smoothedModelTick) {
    pausedModelTickRef.current = smoothedModelTick;
  }
  const visibleModelTick = paused ? pausedModelTickRef.current : smoothedModelTick;

  useEffect(() => {
    if (publishedFirstTelemetryRef.current || !visibleModelTick) {
      return;
    }
    publishedFirstTelemetryRef.current = true;
    publishRendererStartupTiming(
      "tick_scope_first_telemetry_frame_ms",
      msSinceRendererStartup()
    );
  }, [visibleModelTick]);

  if (!visibleModelTick) {
    return (
      <article className={`${styles.modelCard} ${styles.model_healthy}`}>
        <div className={styles.modelHeader}>
          <div>
            <h3>{descriptor.modelName}</h3>
            <p>{paused ? "Paused before first tick telemetry." : "Waiting for latest tick telemetry..."}</p>
          </div>
        </div>
      </article>
    );
  }

  return (
    <ModelCard
      model={visibleModelTick}
      paused={paused}
      showCpuIds={showCpuIds}
    />
  );
});

const ModelCard = memo(function ModelCard({
  model,
  paused,
  showCpuIds,
}: {
  model: ModelTick;
  paused: boolean;
  showCpuIds: boolean;
}) {
  return (
    <article className={`${styles.modelCard} ${styles[`model_${model.status}`]}`}>
      <div className={styles.modelHeader}>
        <div>
          <h3>{model.name}</h3>
          <p className={styles.modelOverview}>
            {model.processMemoryUsed != null ? (
              <>
                {"process memory: "}
                {formatBytesWithCommas(model.processMemoryUsed)} bytes
              </>
            ) : null}
            {model.workloadsMemoryUsed != null ? (
              <>
                {model.processMemoryUsed != null ? " | " : ""}
                {"workloads memory: "}
                {formatBytesWithCommas(model.workloadsMemoryUsed)} bytes
              </>
            ) : null}
          </p>
          <p>
            tick {model.tickSeq} · {formatMs(model.periodMs)} window
            {paused ? " · paused" : ""}
          </p>
        </div>
        <div className={styles.modelStatus}>
          <CopyJsonButton label="Copy raw" data={model.rawSnapshot} />
          <span>{statusLabel(model.status)}</span>
          <strong>{formatMs(model.slackMs)} slack</strong>
        </div>
      </div>
      <div className={styles.axis}>
        <span>0</span>
        <span>{formatMs(model.periodMs)}</span>
      </div>
      <div className={styles.threadRows}>
        {model.threads.map((thread) => (
          <ThreadLane
            key={thread.name}
            model={model}
            thread={thread}
            showCpuIds={showCpuIds}
          />
        ))}
      </div>
    </article>
  );
});

const ThreadLane = memo(function ThreadLane({
  model,
  thread,
  showCpuIds,
}: {
  model: ModelTick;
  thread: ThreadRow;
  showCpuIds: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [workerThreadSortKey, setWorkerThreadSortKey] =
    useState<WorkerThreadSortKey>("cpu");
  const hasWorkerThreads = Boolean(thread.workerThreads?.length);
  const sortedWorkerThreads = useMemo(
    () => sortWorkerThreads(thread.workerThreads, workerThreadSortKey, model.periodMs),
    [model.periodMs, thread.workerThreads, workerThreadSortKey],
  );
  const toggleExpanded = () => setExpanded((current) => !current);

  if (thread.copyData) {
    return (
      <div className={`${styles.threadLane} ${styles.workerThreadLane}`}>
        <div className={styles.workerThreadHeader}>
          {hasWorkerThreads ? (
            <div
              className={`${styles.workerThreadDisclosure} ${expanded ? styles.workerThreadDisclosureExpanded : ""}`}
              role="button"
              tabIndex={0}
              onClick={toggleExpanded}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleExpanded();
                }
              }}
            >
              <span className={styles.workerThreadChevron} aria-hidden="true" />
              <div className={styles.workerThreadHeadingText}>
                <strong>{thread.name}</strong>
                {thread.note || thread.role ? <span>{thread.note ?? thread.role}</span> : null}
              </div>
              <span className={styles.workerThreadCount}>
                {thread.workerThreads?.length ?? 0}
              </span>
            </div>
          ) : (
            <div className={styles.workerThreadHeadingText}>
              <strong>{thread.name}</strong>
              {thread.note || thread.role ? <span>{thread.note ?? thread.role}</span> : null}
            </div>
          )}
          {hasWorkerThreads ? (
            <WorkerThreadCpuBar
              cpuMs={thread.workerThreadCpuTotalMs}
              periodMs={model.periodMs}
              titlePrefix="Total worker CPU"
            />
          ) : null}
          {hasWorkerThreads ? (
            <label className={styles.workerThreadSortControl}>
              <span>Sort</span>
              <select
                value={workerThreadSortKey}
                onChange={(event) =>
                  setWorkerThreadSortKey(event.target.value as WorkerThreadSortKey)
                }
                aria-label="Sort worker threads"
              >
                {WORKER_THREAD_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <CopyJsonButton label="Copy raw" data={thread.copyData} />
        </div>
        {expanded && hasWorkerThreads ? (
          <div className={styles.workerThreadList}>
            {sortedWorkerThreads.map((worker) => (
              <div className={styles.workerThreadItem} key={worker.threadId}>
                <div className={styles.workerThreadText}>
                  <span>{worker.displayName?.trim() || worker.name || "thread"}</span>
                  <span>
                    tid {worker.threadId}
                    {worker.logicalCpuId != null ? ` · CPU ${worker.logicalCpuId}` : ""}
                    {worker.role ? ` · ${worker.role}` : ""}
                    {worker.displayName && worker.name && worker.displayName !== worker.name
                      ? ` · ${worker.name}`
                      : ""}
                  </span>
                </div>
                <WorkerThreadCpuBar
                  cpuMs={workerThreadCpuMs(worker, model.periodMs)}
                  periodMs={model.periodMs}
                  rawDeltaNs={worker.cpuTimeDeltaNs}
                  sampleWindowNs={worker.cpuSampleWindowNs}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.threadLane}>
      <div className={styles.threadLabel}>
        <strong>{thread.name}</strong>
        {thread.note || thread.role ? <span>{thread.note ?? thread.role}</span> : null}
      </div>
      <div className={styles.threadTrackStack}>
        {packSpansIntoSubLanes(thread.spans).map((laneSpans, laneIndex) => (
          <div className={styles.laneTrack} key={`${thread.name}:lane:${laneIndex}`}>
            <div className={styles.deadlineLine} />
            {laneSpans.map((span, index) => (
              <SpanBlock
                key={`${thread.name}:${laneIndex}:${index}:${span.workload}`}
                periodMs={model.periodMs}
                span={span}
                showCpuIds={showCpuIds}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

const CopyJsonButton = memo(function CopyJsonButton({
  label,
  data,
}: {
  label: string;
  data: unknown;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timeoutRef = useRef<number | null>(null);

  const copy = async () => {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    try {
      await navigator.clipboard.writeText(jsonForClipboard(data));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    timeoutRef.current = window.setTimeout(() => {
      setCopyState("idle");
      timeoutRef.current = null;
    }, 1200);
  };

  return (
    <button
      className={`${styles.copyButton} ${copyState !== "idle" ? styles.copyButtonActive : ""}`}
      type="button"
      onClick={copy}
      title={label}
    >
      {copyState === "copied" ? "Copied" : copyState === "failed" ? "Failed" : label}
    </button>
  );
});

const WorkerThreadCpuBar = memo(function WorkerThreadCpuBar({
  cpuMs,
  periodMs,
  rawDeltaNs,
  sampleWindowNs,
  titlePrefix = "CPU",
}: {
  cpuMs: number | null | undefined;
  periodMs: number;
  rawDeltaNs?: number;
  sampleWindowNs?: number;
  titlePrefix?: string;
}) {
  const safePeriodMs = Number.isFinite(periodMs) && periodMs > 0 ? periodMs : 0.001;
  const loadPct = cpuMs == null ? 0 : (cpuMs / safePeriodMs) * 100;
  const widthPct = Math.max(0, Math.min(100, loadPct));
  const rawDeltaMs =
    typeof rawDeltaNs === "number" && Number.isFinite(rawDeltaNs)
      ? nsToMs(rawDeltaNs)
      : null;
  const sampleWindowMs =
    typeof sampleWindowNs === "number" &&
    Number.isFinite(sampleWindowNs) &&
    sampleWindowNs > 0
      ? nsToMs(sampleWindowNs)
      : null;
  const label =
    cpuMs == null
      ? "n/a"
      : `${formatMs(cpuMs)} · ${formatPercent(loadPct)}`;
  const title =
    cpuMs == null
      ? `${titlePrefix} sample unavailable`
      : sampleWindowMs != null && rawDeltaMs != null
        ? `${titlePrefix}: ${formatMs(cpuMs)} average per tick period (${formatMs(rawDeltaMs)} over ${formatMs(sampleWindowMs)})`
        : `${titlePrefix}: ${formatMs(cpuMs)} average per tick period`;

  return (
    <div className={styles.workerThreadCpu} title={title}>
      <div className={styles.workerThreadCpuTrack}>
        <span
          className={styles.workerThreadCpuFill}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className={styles.workerThreadCpuLabel}>{label}</span>
    </div>
  );
});

const SpanBlock = memo(function SpanBlock({
  span,
  periodMs,
  showCpuIds,
}: {
  span: WorkSpan;
  periodMs: number;
  showCpuIds: boolean;
}) {
  const migrated = span.cpuStart !== span.cpuEnd;
  const showCpuBadge =
    showCpuIds &&
    span.kind !== "engine_io" &&
    span.kind !== "sync_wait" &&
    span.kind !== "local_inputs" &&
    span.kind !== "sleep";
  const style = getSpanBlockStyle(span, periodMs) as React.CSSProperties;
  const durationMs = Math.max(0, span.endMs - span.startMs);
  const safePeriodMs = Number.isFinite(periodMs) && periodMs > 0 ? periodMs : 0.001;
  const widthPct = (durationMs / safePeriodMs) * 100;
  const traceClass = durationMs > 0 && widthPct < 0.2 ? styles.spanTrace : "";

  return (
    <div
      className={`${styles.spanBlock} ${styles[`span_${span.kind}`]} ${traceClass}`}
      style={style}
      title={`${span.workload}: ${formatMs(durationMs)}`}
    >
      <span className={styles.spanName}>{span.workload}</span>
      {showCpuBadge ? (
        <span className={styles.cpuBadge}>
          CPU {span.cpuStart}
          {migrated ? `->${span.cpuEnd}` : ""}
        </span>
      ) : null}
      {span.carryOutMs ? (
        <span className={styles.carryBadge}>+{formatMs(span.carryOutMs)}</span>
      ) : null}
    </div>
  );
});
