import React, { memo, useMemo, useRef, useState } from "react";
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
  useTelemetryStream,
} from "../../../data-sources/telemetry";
import {
  getSpanBlockStyle,
  packSpansIntoSubLanes,
  type TickScopeSpanKind,
  type TickScopeWorkSpan,
} from "./internal/tick-scope-layout";
import styles from "./TickScopePage.module.css";

type WorkSpan = TickScopeWorkSpan;

type ThreadRow = {
  name: string;
  role: string;
  threadId?: number;
  spans: WorkSpan[];
  note?: string;
  copyData?: unknown;
};

type ModelTick = {
  id: string;
  name: string;
  tickSeq: number;
  periodMs: number;
  slackMs: number;
  status: "healthy" | "tight" | "miss";
  threads: ThreadRow[];
  rawSnapshot: unknown;
};

type TickScopeModelDescriptor = {
  modelName: string;
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
  telemetryBaseUrl: string;
  model: ITelemetryModel | null;
};

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
    threadRows.set("process-workers", {
      name: `+${unmatchedProcessThreads.length} process worker threads`,
      role: "observed",
      note: "present in process, no Robotick span in latest tick",
      spans: [],
      copyData: {
        note: "present in process, no Robotick span in latest tick",
        threads: unmatchedProcessThreads.map((thread) => ({
          threadId: thread.threadId,
          name: thread.name,
          displayName: thread.displayName,
          role: thread.role,
        })),
      },
    });
  }

  const slackMs = (scheduledEndNs - activeEndNs) / 1_000_000;
  const status: ModelTick["status"] =
    slackMs < 0 ? "miss" : slackMs < periodMs * 0.1 ? "tight" : "healthy";
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
    })),
    workloads: rawWorkloads,
  };

  return {
    id: entry.telemetryBaseUrl,
    name: entry.modelName,
    tickSeq,
    periodMs,
    slackMs,
    status,
    threads,
    rawSnapshot,
  };
}

export default function TickScopePage() {
  const { projectPath } = Project.Context.use();
  const { status } = Launcher.Context.use();
  const { projectModels } = ProjectData.use();
  const [paused, setPaused] = useState(false);

  const telemetryDescriptors = useMemo<TickScopeModelDescriptor[]>(
    () =>
      projectModels.data
        .filter((model) => Boolean(model.telemetryBaseUrl))
        .map((model) => ({
          modelName: model.modelName,
          telemetryBaseUrl: model.telemetryBaseUrl,
          telemetryPushRateHz: Math.max(1, model.telemetryPushRateHz || 20),
        })),
    [projectModels.data],
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
          <DeviceSection key={device.id} device={device} paused={paused} />
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
          <button
            className={`${styles.pauseButton} ${paused ? styles.pauseButtonActive : ""}`}
            type="button"
            onClick={() => setPaused((current) => !current)}
          >
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </header>

      {body}
    </div>
  );
}

const DeviceSection = memo(function DeviceSection({
  device,
  paused,
}: {
  device: DeviceTickScope;
  paused: boolean;
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
          <LiveModelCard key={model.telemetryBaseUrl} descriptor={model} paused={paused} />
        ))}
      </div>
    </section>
  );
});

const LiveModelCard = memo(function LiveModelCard({
  descriptor,
  paused,
}: {
  descriptor: TickScopeModelDescriptor;
  paused: boolean;
}) {
  const pausedModelTickRef = useRef<ModelTick | null>(null);
  const { model, revision } = useTelemetryStream(
    descriptor.telemetryBaseUrl,
    descriptor.telemetryPushRateHz,
  );

  const modelTick = useMemo(
    () =>
      toModelTick({
        modelName: descriptor.modelName,
        telemetryBaseUrl: descriptor.telemetryBaseUrl,
        model,
      }),
    [descriptor.modelName, descriptor.telemetryBaseUrl, model, revision],
  );
  if (!paused && modelTick) {
    pausedModelTickRef.current = modelTick;
  }
  const visibleModelTick = paused ? pausedModelTickRef.current : modelTick;

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

  return <ModelCard model={visibleModelTick} paused={paused} />;
});

const ModelCard = memo(function ModelCard({
  model,
  paused,
}: {
  model: ModelTick;
  paused: boolean;
}) {
  return (
    <article className={`${styles.modelCard} ${styles[`model_${model.status}`]}`}>
      <div className={styles.modelHeader}>
        <div>
          <h3>{model.name}</h3>
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
          <ThreadLane key={thread.name} model={model} thread={thread} />
        ))}
      </div>
    </article>
  );
});

const ThreadLane = memo(function ThreadLane({
  model,
  thread,
}: {
  model: ModelTick;
  thread: ThreadRow;
}) {
  return (
    <div className={styles.threadLane}>
      <div className={styles.threadLabel}>
        <strong>{thread.name}</strong>
        {thread.note || thread.role ? <span>{thread.note ?? thread.role}</span> : null}
      </div>
      {thread.copyData ? (
        <div className={styles.threadActions}>
          <CopyJsonButton label="Copy raw" data={thread.copyData} />
        </div>
      ) : (
        <div className={styles.threadTrackStack}>
          {packSpansIntoSubLanes(thread.spans).map((laneSpans, laneIndex) => (
            <div className={styles.laneTrack} key={`${thread.name}:lane:${laneIndex}`}>
              <div className={styles.deadlineLine} />
              {laneSpans.map((span, index) => (
                <SpanBlock
                  key={`${thread.name}:${laneIndex}:${index}:${span.workload}`}
                  periodMs={model.periodMs}
                  span={span}
                />
              ))}
            </div>
          ))}
        </div>
      )}
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

const SpanBlock = memo(function SpanBlock({
  span,
  periodMs,
}: {
  span: WorkSpan;
  periodMs: number;
}) {
  const migrated = span.cpuStart !== span.cpuEnd;
  const showCpuBadge =
    span.kind !== "engine_io" &&
    span.kind !== "sync_wait" &&
    span.kind !== "local_inputs" &&
    span.kind !== "sleep";
  const style = getSpanBlockStyle(span, periodMs) as React.CSSProperties;

  return (
    <div
      className={`${styles.spanBlock} ${styles[`span_${span.kind}`]}`}
      style={style}
      title={`${span.workload}: ${formatMs(span.endMs - span.startMs)}`}
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
