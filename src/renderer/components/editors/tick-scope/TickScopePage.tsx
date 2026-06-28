import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Launcher, Project, ProjectData } from "../../../data-sources/launcher";
import {
  type ITelemetryField,
  type ITelemetryModel,
  type ITelemetryProcessThread,
  type ITelemetryStruct,
  type ITelemetryWorkload,
  useTelemetryService,
  useTelemetryStream,
} from "../../../data-sources/telemetry";
import type {
  LauncherRuntimeMetrics,
  LauncherRuntimeProcessMetrics,
} from "../../../data-sources/launcher/internal/launcher-interface";
import type { ModelSortKey } from "../telemetry/view/TelemetryApp";
import {
  getSpanBlockStyle,
  getSpanVisibleWidthPct,
  packSpansIntoSubLanes,
  type TickScopeSpanKind,
  type TickScopeWorkSpan,
} from "./internal/tick-scope-layout";
import { usePanelSettings } from "../../workbenches/PanelInstanceContext";
import {
  PANEL_CONTEXT_MENU_ACTIONS_EVENT,
  type PanelContextMenuAction,
  type PanelContextMenuActionsEventDetail,
} from "../../workbenches/PanelContextMenu";
import { tickScopePagePersistence } from "./TickScopePage.persistence";
import { publishRendererStartupTiming } from "../../../services/studio-diagnostics";
import { msSinceRendererStartup } from "../../../services/startup-timing";
import { readStorageValue, setStorageValue } from "../../../services/storage";
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
  runtimeMetrics: RuntimeMetricsSummary;
  threads: ThreadRow[];
  rawSnapshot: unknown;
};

type RuntimeProcessSummary = {
  pid: number;
  parentPid: number | null;
  name: string;
  role: string;
  cpuPercent: number | null;
  rssBytes: number;
  children?: number;
  depth?: number;
  kind?: "engine" | "runtime" | "wrapper";
};

type RuntimeMetricsSummary = {
  source: "launcher" | "unavailable";
  sampledAt: string | null;
  sampleWindowMs: number | null;
  rootPid: number | null;
  processCount: number;
  cpuPercent: number | null;
  rssBytes: number | null;
  engineProcess: RuntimeProcessSummary | null;
  processTree: RuntimeProcessSummary[];
};

type TickScopeModelDescriptor = {
  modelId: string;
  modelName: string;
  modelPath: string;
  telemetryBaseUrl: string;
  runtimeMetrics?: LauncherRuntimeMetrics | null;
};

type DeviceTickScope = {
  id: string;
  name: string;
  models: TickScopeModelDescriptor[];
};

type LiveModelEntry = {
  modelName: string;
  modelPath: string;
  telemetryBaseUrl: string;
  runtimeMetrics?: LauncherRuntimeMetrics | null;
  model: ITelemetryModel | null;
};

type SmoothingSample = {
  tickSeq: number;
  sampledAtMs: number;
  value: number;
};

type WorkerThreadSortKey = "cpu" | "name" | "thread_id" | "logical_cpu";
type RuntimeProcessSortKey = "cpu" | "memory" | "name" | "pid";

type ModelTickCache = {
  raw: ArrayBuffer | null;
  schemaSessionId: string;
  runtimeMetrics: LauncherRuntimeMetrics | null | undefined;
  modelTick: ModelTick | null;
};

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

const RUNTIME_PROCESS_SORT_OPTIONS: ReadonlyArray<{
  value: RuntimeProcessSortKey;
  label: string;
}> = [
  { value: "cpu", label: "CPU" },
  { value: "memory", label: "Memory" },
  { value: "name", label: "Name" },
  { value: "pid", label: "PID" },
];

const TRACE_SPAN_WIDTH_PCT = 2;
const TICK_SCOPE_UPDATE_RATE_HZ = 10;
const TICK_SCOPE_DISCLOSURE_STORAGE_PREFIX = "robotick.tickScope.disclosure.v1";

function tickScopeDisclosureStorageKey(
  modelPath: string,
  section: string,
): string {
  return `${TICK_SCOPE_DISCLOSURE_STORAGE_PREFIX}.${encodeURIComponent(modelPath)}.${section}`;
}

function useStoredDisclosureState(
  storageKey: string,
  defaultExpanded = false,
): [boolean, (updater: boolean | ((current: boolean) => boolean)) => void] {
  const [expanded, setExpandedState] = useState(() => {
    const stored = readStorageValue(storageKey);
    if (stored === "1") return true;
    if (stored === "0") return false;
    return defaultExpanded;
  });

  useEffect(() => {
    const stored = readStorageValue(storageKey);
    setExpandedState(
      stored === "1" ? true : stored === "0" ? false : defaultExpanded,
    );
  }, [defaultExpanded, storageKey]);

  const setExpanded = useCallback(
    (updater: boolean | ((current: boolean) => boolean)) => {
      setExpandedState((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        setStorageValue(storageKey, next ? "1" : "0");
        return next;
      });
    },
    [storageKey],
  );

  return [expanded, setExpanded];
}

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

function formatBytesCompact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "n/a";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${Math.round(size)} ${units[unitIndex]}`;
  const digits = size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericMetricValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function namespacePidsForProcess(
  process: LauncherRuntimeProcessMetrics,
): number[] {
  const candidates = [
    process.namespace_pids,
    process.namespacePids,
    process.pid_namespace_ids,
  ];
  const pids: number[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const value of candidate) {
      const pid = numericMetricValue(value);
      if (pid != null) pids.push(pid);
    }
  }
  return pids;
}

function processNameFromMainThread(
  processThreads: ITelemetryProcessThread[],
): string | null {
  const mainThread = processThreads[0];
  const displayName = mainThread?.displayName?.trim();
  const rawName = mainThread?.name?.trim();
  const name = displayName || rawName;
  if (!name) return null;
  return name.replace(/\s+main$/i, "").trim() || name;
}

function runtimeProcessMetricName(
  process: LauncherRuntimeProcessMetrics | null | undefined,
  fallbackPid?: number | null,
): string {
  const displayName =
    typeof process?.display_name === "string"
      ? process.display_name.trim()
      : "";
  if (displayName) return displayName;
  const name = typeof process?.name === "string" ? process.name.trim() : "";
  if (name) return name;
  return fallbackPid != null
    ? `pid ${fallbackPid}`
    : "<process name not found>";
}

function runtimeCpuLabel(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? formatPercent(value)
    : "n/a";
}

function averageThreadCpuMsForPeriod(
  thread: ProcessThreadSummary,
  periodMs: number,
): number | null {
  const deltaNs = thread.cpuTimeDeltaNs;
  if (
    typeof deltaNs !== "number" ||
    !Number.isFinite(deltaNs) ||
    deltaNs <= 0
  ) {
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

function engineCpuPercentFromThreads(
  threads: ITelemetryProcessThread[],
  periodMs: number,
): number | null {
  if (!(periodMs > 0)) return null;
  const cpuMs = totalThreadCpuMsForPeriod(threads, periodMs);
  return cpuMs == null ? null : (cpuMs / periodMs) * 100;
}

function workerThreadCpuMs(
  thread: ProcessThreadSummary,
  periodMs: number,
): number | null {
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
        result = compareNullableNumbers(
          lhs.logicalCpuId,
          rhs.logicalCpuId,
          "asc",
        );
        break;
    }
    return result || lhs.threadId - rhs.threadId;
  });
}

function sortRuntimeProcesses(
  processes: RuntimeProcessSummary[],
  sortKey: RuntimeProcessSortKey,
): RuntimeProcessSummary[] {
  return [...processes].sort((lhs, rhs) => {
    let result = 0;
    switch (sortKey) {
      case "cpu":
        result = compareNullableNumbers(lhs.cpuPercent, rhs.cpuPercent, "desc");
        break;
      case "memory":
        result = rhs.rssBytes - lhs.rssBytes;
        break;
      case "name":
        result = lhs.name.localeCompare(rhs.name);
        break;
      case "pid":
        result = lhs.pid - rhs.pid;
        break;
    }
    return (
      result ||
      compareNullableNumbers(lhs.cpuPercent, rhs.cpuPercent, "desc") ||
      lhs.pid - rhs.pid
    );
  });
}

function sortProcessTreeSiblings(
  processes: RuntimeProcessSummary[],
  sortKey: RuntimeProcessSortKey,
  subtreeCostByPid: ReadonlyMap<
    number,
    { cpuPercent: number | null; rssBytes: number }
  >,
): RuntimeProcessSummary[] {
  if (sortKey === "cpu" || sortKey === "memory") {
    return [...processes].sort((lhs, rhs) => {
      const leftCost = subtreeCostByPid.get(lhs.pid);
      const rightCost = subtreeCostByPid.get(rhs.pid);
      const result =
        sortKey === "cpu"
          ? compareNullableNumbers(
              leftCost?.cpuPercent ?? null,
              rightCost?.cpuPercent ?? null,
              "desc",
            )
          : (rightCost?.rssBytes ?? 0) - (leftCost?.rssBytes ?? 0);
      return (
        result ||
        compareNullableNumbers(lhs.cpuPercent, rhs.cpuPercent, "desc") ||
        lhs.pid - rhs.pid
      );
    });
  }
  return sortRuntimeProcesses(processes, sortKey);
}

function flattenProcessTree(
  processes: RuntimeProcessSummary[],
  sortKey: RuntimeProcessSortKey,
): RuntimeProcessSummary[] {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const childrenByParent = new Map<number, RuntimeProcessSummary[]>();
  const roots: RuntimeProcessSummary[] = [];
  for (const process of processes) {
    const parentPid = process.parentPid;
    if (parentPid != null && byPid.has(parentPid)) {
      const children = childrenByParent.get(parentPid) ?? [];
      children.push(process);
      childrenByParent.set(parentPid, children);
    } else {
      roots.push(process);
    }
  }

  const subtreeCostByPid = new Map<
    number,
    { cpuPercent: number | null; rssBytes: number }
  >();
  const calculateSubtreeCost = (
    process: RuntimeProcessSummary,
    ancestors: Set<number>,
  ): { cpuPercent: number | null; rssBytes: number } => {
    const cached = subtreeCostByPid.get(process.pid);
    if (cached) return cached;
    if (ancestors.has(process.pid)) {
      return {
        cpuPercent: process.cpuPercent,
        rssBytes: process.rssBytes,
      };
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(process.pid);
    let cpuPercent = process.cpuPercent;
    let rssBytes = process.rssBytes;
    for (const child of childrenByParent.get(process.pid) ?? []) {
      const childCost = calculateSubtreeCost(child, nextAncestors);
      rssBytes += childCost.rssBytes;
      if (childCost.cpuPercent != null) {
        cpuPercent = (cpuPercent ?? 0) + childCost.cpuPercent;
      }
    }
    const cost = { cpuPercent, rssBytes };
    subtreeCostByPid.set(process.pid, cost);
    return cost;
  };
  for (const process of processes) {
    calculateSubtreeCost(process, new Set());
  }

  const flattened: RuntimeProcessSummary[] = [];
  const visit = (
    process: RuntimeProcessSummary,
    depth: number,
    ancestors: Set<number>,
  ) => {
    flattened.push({ ...process, depth });
    if (ancestors.has(process.pid)) return;
    const children = sortProcessTreeSiblings(
      childrenByParent.get(process.pid) ?? [],
      sortKey,
      subtreeCostByPid,
    );
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(process.pid);
    for (const child of children) {
      visit(child, depth + 1, nextAncestors);
    }
  };

  for (const root of sortProcessTreeSiblings(
    roots,
    sortKey,
    subtreeCostByPid,
  )) {
    visit(root, 0, new Set());
  }
  return flattened;
}

function runtimeProcessSubtitle(
  process: RuntimeProcessSummary | null | undefined,
): string {
  if (!process) return "process unavailable";
  const name = process.name.trim() || "process";
  return process.pid > 0 ? `${name} · pid ${process.pid}` : name;
}

function relativeMs(valueNs: number, originNs: number): number {
  return roundMs((valueNs - originNs) / 1_000_000);
}

function rawPhaseSnapshot(
  startNs: number,
  endNs: number,
  originNs: number,
): {
  startNs: number;
  endNs: number;
  startMs: number;
  endMs: number;
  durationMs: number;
} | null {
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

  return durationTotal > 0
    ? weightedTotal / durationTotal
    : samples[samples.length - 1].value;
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
  if (lastSample?.tickSeq !== tickSeq || lastSample.value !== value) {
    samples.push({ tickSeq, sampledAtMs: nowMs, value });
  }
  history.set(key, samples);
  return timeWeightedAverageSmoothingSamples(samples, oldestMs, nowMs);
}

function statusForSlack(
  slackMs: number,
  periodMs: number,
): ModelTick["status"] {
  return slackMs < 0 ? "miss" : slackMs < periodMs * 0.1 ? "tight" : "healthy";
}

export function applyTickScopeSmoothing(
  modelTick: ModelTick,
  smoothingDurationSeconds: number,
  history: Map<string, SmoothingSample[]>,
): ModelTick {
  if (
    !Number.isFinite(smoothingDurationSeconds) ||
    smoothingDurationSeconds <= 0
  ) {
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

  const periodMs =
    smooth("model:periodMs", modelTick.periodMs) ?? modelTick.periodMs;
  const slackMs =
    smooth("model:slackMs", modelTick.slackMs) ?? modelTick.slackMs;
  const threads = modelTick.threads.map((thread) => {
    const threadKey =
      thread.threadId != null
        ? `thread:${thread.threadId}`
        : `thread:${thread.name}`;
    const previousSmoothedEndMsByChain = new Map<string, number>();
    const spans = thread.spans.map((span, index) => {
      const spanKey = `${threadKey}:span:${index}:${span.kind}:${span.workload}`;
      const smoothedStartMs =
        smooth(`${spanKey}:startMs`, span.startMs) ?? span.startMs;
      const previousChainEndMs =
        span.snapChainId == null
          ? null
          : (previousSmoothedEndMsByChain.get(span.snapChainId) ?? null);
      const startMs =
        span.snapStartToPreviousEnd && previousChainEndMs != null
          ? previousChainEndMs
          : smoothedStartMs;
      const endMs = smooth(`${spanKey}:endMs`, span.endMs) ?? span.endMs;
      const normalizedEndMs = Math.max(startMs, endMs);
      if (span.snapChainId != null) {
        previousSmoothedEndMsByChain.set(
          span.snapChainId,
          Math.max(
            previousChainEndMs ?? Number.NEGATIVE_INFINITY,
            normalizedEndMs,
          ),
        );
      }
      return {
        ...span,
        startMs,
        endMs: normalizedEndMs,
        carryOutMs:
          span.carryOutMs == null
            ? undefined
            : (smooth(`${spanKey}:carryOutMs`, span.carryOutMs) ??
              span.carryOutMs),
      };
    });
    const workerThreads = thread.workerThreads?.map((workerThread) => {
      const workerThreadKey = `${threadKey}:worker:${workerThread.threadId}`;
      return {
        ...workerThread,
        cpuMs:
          smooth(
            `${workerThreadKey}:cpuMs`,
            workerThreadCpuMs(workerThread, modelTick.periodMs),
          ) ?? workerThreadCpuMs(workerThread, modelTick.periodMs),
      };
    });
    return {
      ...thread,
      spans,
      workerThreads,
      workerThreadCpuTotalMs:
        workerThreads && workerThreads.length > 0
          ? totalThreadCpuMsForPeriod(workerThreads, periodMs)
          : thread.workerThreadCpuTotalMs,
    };
  });
  const runtimeMetrics: RuntimeMetricsSummary = {
    ...modelTick.runtimeMetrics,
    cpuPercent:
      smooth("runtime:cpuPercent", modelTick.runtimeMetrics.cpuPercent) ??
      modelTick.runtimeMetrics.cpuPercent,
    rssBytes:
      smooth("runtime:rssBytes", modelTick.runtimeMetrics.rssBytes) ??
      modelTick.runtimeMetrics.rssBytes,
    engineProcess: modelTick.runtimeMetrics.engineProcess
      ? {
          ...modelTick.runtimeMetrics.engineProcess,
          cpuPercent:
            smooth(
              "runtime:engine:cpuPercent",
              modelTick.runtimeMetrics.engineProcess.cpuPercent,
            ) ?? modelTick.runtimeMetrics.engineProcess.cpuPercent,
          rssBytes:
            smooth(
              "runtime:engine:rssBytes",
              modelTick.runtimeMetrics.engineProcess.rssBytes,
            ) ?? modelTick.runtimeMetrics.engineProcess.rssBytes,
        }
      : null,
    processTree: modelTick.runtimeMetrics.processTree.map((process) => ({
      ...process,
      cpuPercent:
        smooth(
          `runtime:process:${process.pid}:cpuPercent`,
          process.cpuPercent,
        ) ?? process.cpuPercent,
      rssBytes:
        smooth(`runtime:process:${process.pid}:rssBytes`, process.rssBytes) ??
        process.rssBytes,
    })),
  };
  const processMemoryUsed =
    smooth("model:processMemoryUsed", modelTick.processMemoryUsed) ??
    modelTick.processMemoryUsed;
  const workloadsMemoryUsed =
    smooth("model:workloadsMemoryUsed", modelTick.workloadsMemoryUsed) ??
    modelTick.workloadsMemoryUsed;

  for (const key of history.keys()) {
    if (!seenKeys.has(key)) history.delete(key);
  }

  return {
    ...modelTick,
    periodMs,
    slackMs,
    status: statusForSlack(slackMs, periodMs),
    processMemoryUsed,
    workloadsMemoryUsed,
    runtimeMetrics,
    threads,
  };
}

function jsonForClipboard(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function copyJsonAction(
  id: string,
  label: string,
  data: unknown,
): PanelContextMenuAction {
  return {
    id,
    label,
    onSelect: () => {
      void navigator.clipboard.writeText(jsonForClipboard(data));
    },
  };
}

function modelTickFromCache(
  cache: React.MutableRefObject<ModelTickCache | null>,
  entry: LiveModelEntry,
): ModelTick | null {
  const raw = entry.model?.raw ?? null;
  const schemaSessionId = entry.model?.schemaSessionId ?? "";
  const cached = cache.current;
  if (
    cached &&
    cached.raw === raw &&
    cached.schemaSessionId === schemaSessionId &&
    cached.runtimeMetrics === entry.runtimeMetrics
  ) {
    return cached.modelTick;
  }

  const modelTick = toModelTick(entry);
  cache.current = {
    raw,
    schemaSessionId,
    runtimeMetrics: entry.runtimeMetrics,
    modelTick,
  };
  return modelTick;
}

function spanStageExplanation(span: WorkSpan): string | null {
  switch (span.kind) {
    case "sleep_coarse":
      return "OS sleep phase: hands most of the wait budget to the scheduler; lowest CPU cost, least precise wake.";
    case "sleep_yield":
      return "Yield phase: repeatedly yields near the deadline to reduce wake lateness without busy-spinning.";
    case "sleep_spin":
      return "Spin phase: holds the final tiny timing window for the tightest wake timing; highest CPU cost.";
    case "sleep":
      return span.workload === "sleep remainder"
        ? "Unattributed wait time left after the measured sleep stages."
        : "Aggregate wait after work completes; stage timings were not available for this span.";
    default:
      return null;
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

function displayWorkloadName(workload: ITelemetryWorkload): string {
  return workload.displayName?.trim() || workload.name;
}

function runtimeMetricsFromLauncher(
  metrics: LauncherRuntimeMetrics | null | undefined,
  processMemoryUsed: number | null,
  processThreads: ITelemetryProcessThread[],
  engineProcessId: number | null,
  periodMs: number,
): RuntimeMetricsSummary {
  const fallbackEngineCpuPercent = engineCpuPercentFromThreads(
    processThreads,
    periodMs,
  );
  const effectiveEngineProcessId =
    engineProcessId ?? processThreads[0]?.threadId ?? null;
  const engineProcess: RuntimeProcessSummary = {
    pid: effectiveEngineProcessId ?? 0,
    parentPid: null,
    name:
      processNameFromMainThread(processThreads) ?? "<process name not found>",
    role: "model engine",
    cpuPercent: fallbackEngineCpuPercent,
    rssBytes: processMemoryUsed ?? 0,
    children: 0,
    kind: "engine",
  };
  if (!metrics) {
    return {
      source: "unavailable",
      sampledAt: null,
      sampleWindowMs: null,
      rootPid: null,
      processCount: 0,
      cpuPercent: null,
      rssBytes: null,
      engineProcess,
      processTree: [],
    };
  }
  const topProcesses = Array.isArray(metrics.top_processes)
    ? metrics.top_processes
    : [];
  const sampledProcesses = Array.isArray(metrics.processes)
    ? metrics.processes
    : topProcesses;
  const matchesEngineProcessId = (
    process: LauncherRuntimeProcessMetrics | null | undefined,
  ) => {
    if (effectiveEngineProcessId == null || process == null) return false;
    if (numericMetricValue(process.pid) === effectiveEngineProcessId)
      return true;
    return namespacePidsForProcess(process).some(
      (pid) => pid === effectiveEngineProcessId,
    );
  };
  const rootPid = numericMetricValue(metrics.root_pid);
  const engineMetricProcess =
    metrics.engine_process ??
    (effectiveEngineProcessId != null
      ? sampledProcesses.find((process) => matchesEngineProcessId(process))
      : undefined) ??
    sampledProcesses.find((process) => process.role === "engine");
  const engineMetricPid = numericMetricValue(engineMetricProcess?.pid);
  const engineMetricMemory = numericMetricValue(
    engineMetricProcess?.memory_bytes,
  );
  const engineMetricCpu = numericMetricValue(engineMetricProcess?.cpu_percent);
  if (engineMetricProcess) {
    engineProcess.pid = engineMetricPid ?? engineProcess.pid;
    engineProcess.name = runtimeProcessMetricName(
      engineMetricProcess,
      engineMetricPid,
    );
    engineProcess.cpuPercent = engineMetricCpu ?? fallbackEngineCpuPercent;
    engineProcess.rssBytes = engineMetricMemory ?? engineProcess.rssBytes;
    engineProcess.children = finiteNumber(engineMetricProcess.children) ?? 0;
  }
  const processTree = sampledProcesses
    .map((process): RuntimeProcessSummary | null => {
      const pid = numericMetricValue(process.pid);
      if (pid == null) return null;
      const role = String(process.role || "runtime process");
      return {
        pid,
        parentPid: numericMetricValue(process.parent_pid),
        name: runtimeProcessMetricName(process, pid),
        role,
        cpuPercent: numericMetricValue(process.cpu_percent),
        rssBytes: numericMetricValue(process.memory_bytes) ?? 0,
        children: numericMetricValue(process.children) ?? 0,
        kind:
          matchesEngineProcessId(process) || role === "engine"
            ? "engine"
            : role === "wrapper"
              ? "wrapper"
              : "runtime",
      };
    })
    .filter((process): process is RuntimeProcessSummary => process != null);

  return {
    source: "launcher",
    sampledAt:
      typeof metrics.sampled_at === "string" ? metrics.sampled_at : null,
    sampleWindowMs: finiteNumber(metrics.sample_window_ms),
    rootPid,
    processCount: finiteNumber(metrics.process_count) ?? processTree.length,
    cpuPercent: finiteNumber(metrics.cpu_percent),
    rssBytes: finiteNumber(metrics.memory_bytes),
    engineProcess,
    processTree,
  };
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
  getLatestMetrics: (baseUrl: string) => {
    processMemoryUsed: number;
    workloadsMemoryUsed: number;
  },
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
  const baseName =
    rawName && rawName !== `thread ${threadId}` ? rawName : "thread";
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
      const startNs =
        numericStat(workload, ["latest_span", "start_time_ns"]) ?? 0;
      const endNs = numericStat(workload, ["latest_span", "end_time_ns"]) ?? 0;
      const waitTotalNs =
        numericStat(workload, ["latest_span", "wait_total_ns"]) ?? 0;
      const waitRequestedNs =
        numericStat(workload, ["latest_span", "wait_requested_ns"]) ?? 0;
      const waitCoarseSleepNs =
        numericStat(workload, ["latest_span", "wait_coarse_sleep_ns"]) ?? 0;
      const waitYieldPhaseNs =
        numericStat(workload, ["latest_span", "wait_yield_phase_ns"]) ?? 0;
      const waitSpinPhaseNs =
        numericStat(workload, ["latest_span", "wait_spin_phase_ns"]) ?? 0;
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
        numericStat(workload, ["latest_span", "local_inputs_start_time_ns"]) ??
        0;
      const localInputsEndNs =
        numericStat(workload, ["latest_span", "local_inputs_end_time_ns"]) ?? 0;
      const sleepYieldStartNs =
        numericStat(workload, ["latest_span", "sleep_yield_start_time_ns"]) ??
        0;
      const sleepYieldEndNs =
        numericStat(workload, ["latest_span", "sleep_yield_end_time_ns"]) ?? 0;
      const cpuStart =
        numericStat(workload, ["latest_span", "logical_cpu_start_id"]) ?? -1;
      const cpuEnd =
        numericStat(workload, ["latest_span", "logical_cpu_end_id"]) ??
        cpuStart;
      const kernelThreadId =
        numericStat(workload, ["latest_span", "kernel_thread_id"]) ??
        numericStat(workload, ["latest_span", "thread_id"]) ??
        0;
      const isRunning = Boolean(
        findNestedField(workload.stats, [
          "latest_span",
          "is_running",
        ])?.getValue(),
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
        waitCoarseSleepNs,
        waitYieldPhaseNs,
        waitSpinPhaseNs,
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
  const scheduledEndNs = Math.max(
    ...rawSpans.map((span) => span.scheduledEndNs),
  );
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
      engineIo: rawPhaseSnapshot(
        span.engineIoStartNs,
        span.engineIoEndNs,
        originNs,
      ),
      syncWait: rawPhaseSnapshot(
        span.syncWaitStartNs,
        span.syncWaitEndNs,
        originNs,
      ),
      localInputs: rawPhaseSnapshot(
        span.localInputsStartNs,
        span.localInputsEndNs,
        originNs,
      ),
      workload: rawPhaseSnapshot(span.startNs, span.endNs, originNs),
      sleepYield: rawPhaseSnapshot(
        span.sleepYieldStartNs,
        span.sleepYieldEndNs,
        originNs,
      ),
    };
    const snapshot = {
      workloadName: displayWorkloadName(span.workload),
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
        coarseSleepMs: nsToMs(span.waitCoarseSleepNs),
        yieldPhaseMs: nsToMs(span.waitYieldPhaseNs),
        spinPhaseMs: nsToMs(span.waitSpinPhaseNs),
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
    const snapChainId = `${span.kernelThreadId}:${span.workload.name}:${span.tickSeq}`;
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
        snapChainId,
      });
    };

    const phaseCountBefore = row.spans.length;
    addPhase(
      "engine I/O",
      "engine_io",
      span.engineIoStartNs,
      span.engineIoEndNs,
    );
    addPhase(
      "local inputs",
      "local_inputs",
      span.localInputsStartNs,
      span.localInputsEndNs,
    );

    const hasPreWorkPhase = row.spans.length > phaseCountBefore;
    row.spans.push({
      workload: displayWorkloadName(span.workload),
      kind: carryOutNs > 0 ? "carry" : "useful",
      startMs: (span.startNs - originNs) / 1_000_000,
      endMs: (span.endNs - originNs) / 1_000_000,
      cpuStart: span.cpuStart,
      cpuEnd: span.cpuEnd,
      carryOutMs: carryOutNs > 0 ? carryOutNs / 1_000_000 : undefined,
      snapStartToPreviousEnd: hasPreWorkPhase || undefined,
      snapChainId,
    });

    let sleepStageStartNs = span.sleepYieldStartNs;
    const sleepStageEndNs = span.sleepYieldEndNs;
    const addSleepStage = (
      workload: string,
      kind: TickScopeSpanKind,
      durationNs: number,
    ) => {
      if (durationNs <= 0 || sleepStageStartNs >= sleepStageEndNs) return;
      const endNs = Math.min(sleepStageEndNs, sleepStageStartNs + durationNs);
      const spanCountBefore = row.spans.length;
      addPhase(workload, kind, sleepStageStartNs, endNs);
      const addedSpan = row.spans[spanCountBefore];
      if (addedSpan) {
        addedSpan.snapStartToPreviousEnd = true;
      }
      sleepStageStartNs = endNs;
    };

    addSleepStage("coarse sleep", "sleep_coarse", span.waitCoarseSleepNs);
    addSleepStage("yield", "sleep_yield", span.waitYieldPhaseNs);
    addSleepStage("spin", "sleep_spin", span.waitSpinPhaseNs);
    if (sleepStageStartNs === span.sleepYieldStartNs) {
      addPhase(
        "sleep/yield",
        "sleep",
        span.sleepYieldStartNs,
        span.sleepYieldEndNs,
      );
    } else {
      const spanCountBefore = row.spans.length;
      addPhase("sleep remainder", "sleep", sleepStageStartNs, sleepStageEndNs);
      const addedSpan = row.spans[spanCountBefore];
      if (addedSpan) {
        addedSpan.snapStartToPreviousEnd = true;
      }
    }
  }

  for (const row of threadRows.values()) {
    const workloadNames = new Set(
      row.spans
        .filter(
          (span) =>
            span.kind !== "engine_io" &&
            span.kind !== "sync_wait" &&
            span.kind !== "local_inputs" &&
            span.kind !== "sleep" &&
            span.kind !== "sleep_coarse" &&
            span.kind !== "sleep_yield" &&
            span.kind !== "sleep_spin",
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
      workerThreadCpuTotalMs: totalThreadCpuMsForPeriod(
        workerThreads,
        periodMs,
      ),
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
  const processMemoryUsed = finiteNumber(model.process_memory_used);
  const workloadsMemoryUsed = finiteNumber(model.workloads_buffer_size_used);
  const runtimeMetrics = runtimeMetricsFromLauncher(
    entry.runtimeMetrics,
    processMemoryUsed,
    processThreads,
    finiteNumber(model.process_id),
    periodMs,
  );

  const rawSnapshot = {
    modelName: entry.modelName,
    telemetryBaseUrl: entry.telemetryBaseUrl,
    tickSeq,
    originTimeNs: originNs,
    scheduledEndTimeNs: scheduledEndNs,
    tickWindowMs: roundMs(periodMs),
    activeSlackMs: roundMs(slackMs),
    status,
    processId: finiteNumber(model.process_id),
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
    runtimeMetrics,
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
    processMemoryUsed,
    workloadsMemoryUsed,
    runtimeMetrics,
    threads,
    rawSnapshot,
  };
}

export default function TickScopePage() {
  const { projectPath } = Project.Context.use();
  const { status, launcherModels } = Launcher.Context.use();
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
    publishRendererStartupTiming(
      "tick_scope_mounted_ms",
      msSinceRendererStartup(),
    );
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
          modelId: model.modelShortName,
          modelName: model.modelName,
          modelPath: model.modelPath,
          telemetryBaseUrl: model.telemetryBaseUrl,
          runtimeMetrics: launcherModels[model.modelShortName]?.metrics ?? null,
        }))
        .sort((left, right) =>
          compareTickScopeModels(
            left,
            right,
            settings.modelSortKey,
            (baseUrl) => {
              const latest = telemetryService.getLatestModel(baseUrl);
              return {
                processMemoryUsed: latest?.process_memory_used ?? -1,
                workloadsMemoryUsed: latest?.workloads_buffer_size_used ?? -1,
              };
            },
          ),
        ),
    [
      launcherModels,
      projectModels.data,
      settings.modelSortKey,
      telemetryService,
    ],
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
    if (
      !projectPath ||
      status !== "running" ||
      projectModels.loading ||
      devices.length === 0
    ) {
      return;
    }
    requestAnimationFrame(() => {
      if (publishedActiveTimingRef.current) {
        return;
      }
      publishedActiveTimingRef.current = true;
      publishRendererStartupTiming(
        "tick_scope_active_ms",
        msSinceRendererStartup(),
      );
    });
  }, [devices.length, projectModels.loading, projectPath, status]);

  let body: React.ReactNode;
  if (!projectPath) {
    body = (
      <p className={styles.message}>Select a project to view Tick Scope.</p>
    );
  } else if (status !== "running") {
    body = (
      <p className={styles.message}>Launch your robot to enable Tick Scope.</p>
    );
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
              onClick={() =>
                updateSettings({ showCpuIds: !settings.showCpuIds })
              }
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
              updateSettings({
                modelSortKey: event.target.value as ModelSortKey,
              })
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
  const modelTickCacheRef = useRef<ModelTickCache | null>(null);
  const smoothingHistoryRef = useRef<Map<string, SmoothingSample[]>>(new Map());
  const publishedFirstTelemetryRef = useRef(false);
  const { model, revision } = useTelemetryStream(
    descriptor.telemetryBaseUrl,
    TICK_SCOPE_UPDATE_RATE_HZ,
  );

  const modelTick = useMemo(
    () =>
      modelTickFromCache(modelTickCacheRef, {
        modelName: descriptor.modelName,
        modelPath: descriptor.modelPath,
        telemetryBaseUrl: descriptor.telemetryBaseUrl,
        runtimeMetrics: descriptor.runtimeMetrics,
        model,
      }),
    [
      descriptor.modelName,
      descriptor.modelPath,
      descriptor.runtimeMetrics,
      descriptor.telemetryBaseUrl,
      model,
      revision,
    ],
  );
  const smoothedModelTick = useMemo(
    () =>
      modelTick && !paused
        ? applyTickScopeSmoothing(
            modelTick,
            smoothingDurationSeconds,
            smoothingHistoryRef.current,
          )
        : modelTick,
    [modelTick, paused, revision, smoothingDurationSeconds],
  );
  if (!paused && smoothedModelTick) {
    pausedModelTickRef.current = smoothedModelTick;
  }
  const visibleModelTick = paused
    ? pausedModelTickRef.current
    : smoothedModelTick;

  useEffect(() => {
    if (publishedFirstTelemetryRef.current || !visibleModelTick) {
      return;
    }
    publishedFirstTelemetryRef.current = true;
    publishRendererStartupTiming(
      "tick_scope_first_telemetry_frame_ms",
      msSinceRendererStartup(),
    );
  }, [visibleModelTick]);

  if (!visibleModelTick) {
    return (
      <article className={`${styles.modelCard} ${styles.model_healthy}`}>
        <div className={styles.modelHeader}>
          <div>
            <h3>{descriptor.modelName}</h3>
            <p>
              {paused
                ? "Paused before first tick telemetry."
                : "Waiting for latest tick telemetry..."}
            </p>
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
  const cardRef = useRef<HTMLElement | null>(null);
  const engineWorkerThreadPayloads = useMemo(
    () =>
      model.threads
        .filter((thread) => thread.copyData != null)
        .map((thread) => ({
          name: thread.name,
          data: thread.copyData,
        })),
    [model.threads],
  );
  const contextMenuActions = useMemo<PanelContextMenuAction[]>(() => {
    const actions = [
      copyJsonAction("model-raw", "Copy model tick JSON", model.rawSnapshot),
      copyJsonAction(
        "runtime-metrics",
        "Copy runtime and other-process metrics JSON",
        model.runtimeMetrics,
      ),
    ];
    if (engineWorkerThreadPayloads.length > 0) {
      actions.push(
        copyJsonAction(
          "engine-worker-threads",
          "Copy engine worker-thread JSON",
          engineWorkerThreadPayloads,
        ),
      );
    }
    return actions;
  }, [engineWorkerThreadPayloads, model.rawSnapshot, model.runtimeMetrics]);
  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const handleActions = (event: Event) => {
      const customEvent =
        event as CustomEvent<PanelContextMenuActionsEventDetail>;
      customEvent.detail.actions.push(...contextMenuActions);
    };
    element.addEventListener(PANEL_CONTEXT_MENU_ACTIONS_EVENT, handleActions);
    return () => {
      element.removeEventListener(
        PANEL_CONTEXT_MENU_ACTIONS_EVENT,
        handleActions,
      );
    };
  }, [contextMenuActions]);

  return (
    <article
      className={`${styles.modelCard} ${styles[`model_${model.status}`]}`}
      ref={cardRef}
    >
      <div className={styles.modelHeader}>
        <div>
          <h3>{model.name}</h3>
          {paused ? <p className={styles.modelMeta}>paused</p> : null}
        </div>
      </div>
      <RuntimeOverview model={model} />
      <RuntimeProcessesSection
        runtimeMetrics={model.runtimeMetrics}
        storageKey={tickScopeDisclosureStorageKey(
          model.modelPath,
          "process-tree",
        )}
      />
      <EngineSection
        model={model}
        showCpuIds={showCpuIds}
        storageKey={tickScopeDisclosureStorageKey(model.modelPath, "engine")}
      />
    </article>
  );
});

const RuntimeOverview = memo(function RuntimeOverview({
  model,
}: {
  model: ModelTick;
}) {
  const runtime = model.runtimeMetrics;
  const engine = runtime.engineProcess;
  return (
    <div className={styles.runtimeOverviewLine}>
      <span>
        <strong>Runtime</strong> CPU {runtimeCpuLabel(runtime.cpuPercent)} ·
        memory {formatBytesCompact(runtime.rssBytes)} · {runtime.processCount}{" "}
        process{runtime.processCount === 1 ? "" : "es"}
      </span>
      <span>
        <strong>Engine</strong> CPU {runtimeCpuLabel(engine?.cpuPercent)} ·
        memory {formatBytesCompact(engine?.rssBytes ?? model.processMemoryUsed)}{" "}
        · workload buffer {formatBytesCompact(model.workloadsMemoryUsed)}
      </span>
    </div>
  );
});

const EngineSection = memo(function EngineSection({
  model,
  showCpuIds,
  storageKey,
}: {
  model: ModelTick;
  showCpuIds: boolean;
  storageKey: string;
}) {
  const [expanded, setExpanded] = useStoredDisclosureState(storageKey, false);
  const engine = model.runtimeMetrics.engineProcess;
  return (
    <section className={styles.modelSubsection}>
      <div className={styles.modelSubsectionHeader}>
        <button
          type="button"
          className={`${styles.sectionDisclosure} ${expanded ? styles.sectionDisclosureExpanded : ""}`}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <span className={styles.sectionChevron} aria-hidden="true" />
          <div className={styles.sectionHeadingText}>
            <strong>Engine</strong>
            <span>{runtimeProcessSubtitle(engine)}</span>
          </div>
          <RuntimeUsageSummary
            cpuPercent={engine?.cpuPercent ?? null}
            memoryBytes={engine?.rssBytes ?? model.processMemoryUsed}
          />
        </button>
      </div>
      {expanded ? (
        <div className={styles.modelSubsectionBody}>
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
        </div>
      ) : null}
    </section>
  );
});

const RuntimeProcessesSection = memo(function RuntimeProcessesSection({
  runtimeMetrics,
  storageKey,
}: {
  runtimeMetrics: RuntimeMetricsSummary;
  storageKey: string;
}) {
  const [expanded, setExpanded] = useStoredDisclosureState(storageKey, false);
  const [sortKey, setSortKey] = useState<RuntimeProcessSortKey>("cpu");
  const processTree = runtimeMetrics.processTree;
  const processCount = runtimeMetrics.processCount || processTree.length;
  const processCpuSamples = processTree
    .map((process) => process.cpuPercent)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );
  const processCpuPercent =
    processCpuSamples.length > 0
      ? processCpuSamples.reduce((total, value) => total + value, 0)
      : null;
  const processRssBytes = processTree.reduce(
    (total, process) => total + process.rssBytes,
    0,
  );
  const topProcess = useMemo(
    () => sortRuntimeProcesses(processTree, "cpu")[0],
    [processTree],
  );
  const displayedProcesses = useMemo(
    () => flattenProcessTree(processTree, sortKey),
    [processTree, sortKey],
  );

  if (processCount === 0) {
    return (
      <section className={styles.modelSubsection}>
        <div className={styles.modelSubsectionHeader}>
          <div className={styles.sectionStaticSummary}>
            <div className={styles.sectionHeadingText}>
              <strong>0 process-tree processes</strong>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.modelSubsection}>
      <div className={styles.modelSubsectionHeader}>
        <button
          type="button"
          className={`${styles.sectionDisclosure} ${expanded ? styles.sectionDisclosureExpanded : ""}`}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <span className={styles.sectionChevron} aria-hidden="true" />
          <div className={styles.sectionHeadingText}>
            <strong>
              Process tree · {processCount} process
              {processCount === 1 ? "" : "es"}
            </strong>
            {topProcess?.name ? (
              <span>top process by CPU: {topProcess.name}</span>
            ) : null}
          </div>
          <RuntimeUsageSummary
            cpuPercent={runtimeMetrics.cpuPercent ?? processCpuPercent}
            memoryBytes={runtimeMetrics.rssBytes ?? processRssBytes}
          />
        </button>
      </div>
      {expanded ? (
        <div className={styles.modelSubsectionBody}>
          <div className={styles.runtimeProcessToolbar}>
            <span>engine, runtime children, and wrappers</span>
            <label className={styles.workerThreadSortControl}>
              <span>Sort siblings</span>
              <select
                value={sortKey}
                onChange={(event) =>
                  setSortKey(event.target.value as RuntimeProcessSortKey)
                }
                aria-label="Sort runtime processes"
              >
                {RUNTIME_PROCESS_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {displayedProcesses.length > 0 ? (
            <div className={styles.runtimeProcessList}>
              {displayedProcesses.map((process) => (
                <RuntimeProcessRow key={process.pid} process={process} />
              ))}
            </div>
          ) : (
            <p className={styles.runtimeProcessEmpty}>
              No sampled processes in this snapshot.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
});

const RuntimeUsageSummary = memo(function RuntimeUsageSummary({
  cpuPercent,
  memoryBytes,
}: {
  cpuPercent: number | null | undefined;
  memoryBytes: number | null | undefined;
}) {
  const hasCpu = typeof cpuPercent === "number" && Number.isFinite(cpuPercent);
  const widthPct = hasCpu ? Math.max(0, Math.min(100, cpuPercent)) : 0;
  return (
    <div className={styles.runtimeUsageSummary}>
      <div className={styles.runtimeUsageBar} aria-hidden="true">
        <span style={{ width: `${widthPct}%` }} />
      </div>
      <span className={styles.runtimeUsageMetric}>
        CPU <strong>{runtimeCpuLabel(cpuPercent)}</strong>
      </span>
      <span className={styles.runtimeUsageMetric}>
        Memory <strong>{formatBytesCompact(memoryBytes)}</strong>
      </span>
    </div>
  );
});

const RuntimeProcessRow = memo(function RuntimeProcessRow({
  process,
}: {
  process: RuntimeProcessSummary;
}) {
  const rowClassName = [
    styles.runtimeProcessRow,
    process.kind === "wrapper" ? styles.runtimeProcessRowWrapper : "",
    process.kind === "engine" ? styles.runtimeProcessRowEngine : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={rowClassName}
      style={
        { "--process-depth": String(process.depth ?? 0) } as React.CSSProperties
      }
    >
      <div className={styles.runtimeProcessIdentity}>
        <strong>
          {process.name}
          {process.kind === "engine" ? " (Engine)" : ""}
        </strong>
        <span>
          pid {process.pid}
          {process.parentPid ? ` · parent ${process.parentPid}` : ""}
          {process.children ? ` · ${process.children} child processes` : ""}
          {process.role ? ` · ${process.role}` : ""}
        </span>
      </div>
      <div className={styles.runtimeProcessMetric}>
        <span>CPU</span>
        <strong>{runtimeCpuLabel(process.cpuPercent)}</strong>
      </div>
      <div className={styles.runtimeProcessMetric}>
        <span>Memory</span>
        <strong>{formatBytesCompact(process.rssBytes)}</strong>
      </div>
    </div>
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
  const workerDisclosureKey = tickScopeDisclosureStorageKey(
    model.modelPath,
    `worker-threads.${encodeURIComponent(String(thread.threadId ?? thread.name))}`,
  );
  const [expanded, setExpanded] = useStoredDisclosureState(
    workerDisclosureKey,
    false,
  );
  const [workerThreadSortKey, setWorkerThreadSortKey] =
    useState<WorkerThreadSortKey>("cpu");
  const hasWorkerThreads = Boolean(thread.workerThreads?.length);
  const packedSpanLanes = useMemo(
    () => (thread.copyData ? [] : packSpansIntoSubLanes(thread.spans)),
    [thread.copyData, thread.spans],
  );
  const sortedWorkerThreads = useMemo(
    () =>
      expanded
        ? sortWorkerThreads(
            thread.workerThreads,
            workerThreadSortKey,
            model.periodMs,
          )
        : [],
    [expanded, model.periodMs, thread.workerThreads, workerThreadSortKey],
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
              </div>
            </div>
          ) : (
            <div className={styles.workerThreadHeadingText}>
              <strong>{thread.name}</strong>
            </div>
          )}
          {hasWorkerThreads ? (
            <WorkerThreadCpuBar
              cpuMs={thread.workerThreadCpuTotalMs}
              periodMs={model.periodMs}
              titlePrefix="Total worker CPU"
            />
          ) : null}
          {expanded && hasWorkerThreads ? (
            <label className={styles.workerThreadSortControl}>
              <span>Sort</span>
              <select
                value={workerThreadSortKey}
                onChange={(event) =>
                  setWorkerThreadSortKey(
                    event.target.value as WorkerThreadSortKey,
                  )
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
        </div>
        {expanded && hasWorkerThreads ? (
          <div className={styles.workerThreadList}>
            {sortedWorkerThreads.map((worker) => (
              <div className={styles.workerThreadItem} key={worker.threadId}>
                <div className={styles.workerThreadText}>
                  <span>
                    {worker.displayName?.trim() || worker.name || "thread"}
                  </span>
                  <span>
                    tid {worker.threadId}
                    {showCpuIds && worker.logicalCpuId != null
                      ? ` · CPU ${worker.logicalCpuId}`
                      : ""}
                    {worker.role ? ` · ${worker.role}` : ""}
                    {worker.displayName &&
                    worker.name &&
                    worker.displayName !== worker.name
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
        {thread.note || thread.role ? (
          <span>{thread.note ?? thread.role}</span>
        ) : null}
      </div>
      <div className={styles.threadTrackStack}>
        {packedSpanLanes.map((laneSpans, laneIndex) => (
          <div
            className={styles.laneTrack}
            key={`${thread.name}:lane:${laneIndex}`}
          >
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
  const safePeriodMs =
    Number.isFinite(periodMs) && periodMs > 0 ? periodMs : 0.001;
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
    cpuMs == null ? "n/a" : `${formatMs(cpuMs)} · ${formatPercent(loadPct)}`;
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
    span.kind !== "sleep" &&
    span.kind !== "sleep_coarse" &&
    span.kind !== "sleep_yield" &&
    span.kind !== "sleep_spin";
  const style = getSpanBlockStyle(span, periodMs) as React.CSSProperties;
  const durationMs = Math.max(0, span.endMs - span.startMs);
  const widthPct = getSpanVisibleWidthPct(span, periodMs);
  const traceClass =
    durationMs > 0 && widthPct < TRACE_SPAN_WIDTH_PCT ? styles.spanTrace : "";
  const explanation = spanStageExplanation(span);
  const title = explanation
    ? `${span.workload}: ${formatMs(durationMs)}\n${explanation}`
    : `${span.workload}: ${formatMs(durationMs)}`;

  return (
    <div
      className={`${styles.spanBlock} ${styles[`span_${span.kind}`]} ${traceClass}`}
      style={style}
      title={title}
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
