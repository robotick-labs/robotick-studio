import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ProjectData } from "../../../data-sources/launcher";
import {
  buildNamespacedKey,
  readStorageValue,
  setStorageValue,
} from "../../../services/storage";
import { usePanelInstance } from "../../workspaces/PanelInstanceContext";
import styles from "./TelemetryScopePage.module.css";

type ModelOption = {
  modelPath: string;
  modelName: string;
  modelShortName: string;
  preferredTelemetrySampleRateHz?: number;
};

type SectionKind = "config" | "inputs" | "outputs" | "stats";
type YMode = "auto" | "manual";
type MockSignalKind = "number" | "boolean";
type MockSignalGenerator = "sine" | "triangle" | "ramp" | "pulse" | "drift";

type MockField = {
  path: string;
  label: string;
  kind: MockSignalKind;
  generator: MockSignalGenerator;
  amplitude: number;
  baseline: number;
  frequencyHz: number;
};

type MockWorkload = {
  name: string;
  sections: Record<SectionKind, MockField[]>;
};

type TraceConfig = {
  id: string;
  fieldPath: string;
  visible: boolean;
  color: string;
};

type ScopePanelSettings = {
  modelPath: string;
  workloadName: string;
  section: SectionKind;
  traces: TraceConfig[];
  windowSeconds: number;
  freeze: boolean;
  yMode: YMode;
  yMin: string;
  yMax: string;
  showGrid: boolean;
  showLegend: boolean;
  showLatestValues: boolean;
  fieldsExpanded: boolean;
  settingsExpanded: boolean;
};

type SamplePoint = {
  timeMs: number;
  value: number;
};

type PlotTrace = TraceConfig & {
  field: MockField;
  labelText: string;
  latestValue: number | null;
  points: SamplePoint[];
  polyline: string;
};

const STORAGE_BASE_KEY = "robotick-studio.telemetry-scope.panel";
const DEFAULT_WINDOW_SECONDS = 10;
const DEFAULT_Y_MIN = "-1";
const DEFAULT_Y_MAX = "1";
const WINDOW_OPTIONS = [5, 10, 30, 60];
const SECTION_OPTIONS: Array<{ value: SectionKind; label: string }> = [
  { value: "config", label: "Config" },
  { value: "inputs", label: "Inputs" },
  { value: "outputs", label: "Outputs" },
  { value: "stats", label: "Stats" },
];
const TRACE_COLORS = ["#7ef9a9", "#73c7ff", "#ffd166", "#ff7b72", "#d9a3ff"];
const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 420;
const PLOT_PADDING = { top: 24, right: 16, bottom: 28, left: 18 };
const MOCK_SAMPLE_RATE_FALLBACK_HZ = 20;
const MOCK_WORKLOADS: MockWorkload[] = [
  {
    name: "brain",
    sections: {
      config: [
        createMockField("brain.config.arousal_target", "Arousal Target", "number", "drift", 0.22, 0.45, 0.03),
        createMockField("brain.config.social_bias", "Social Bias", "number", "triangle", 0.28, 0.4, 0.04),
      ],
      inputs: [
        createMockField("brain.inputs.operator_approval", "Operator Approval", "boolean", "pulse", 1, 0, 0.15),
        createMockField("brain.inputs.energy_hint", "Energy Hint", "number", "sine", 0.35, 0.55, 0.18),
      ],
      outputs: [
        createMockField("brain.outputs.arousal", "Arousal", "number", "sine", 0.65, 0.18, 0.12),
        createMockField("brain.outputs.valence", "Valence", "number", "triangle", 0.55, 0, 0.09),
        createMockField("brain.outputs.social_attention", "Social Attention", "number", "drift", 0.48, 0.42, 0.05),
      ],
      stats: [
        createMockField("brain.stats.loop_jitter_ms", "Loop Jitter (ms)", "number", "ramp", 1.8, 0.4, 0.11),
        createMockField("brain.stats.hot_path", "Hot Path", "boolean", "pulse", 1, 0, 0.08),
      ],
    },
  },
  {
    name: "spine",
    sections: {
      config: [
        createMockField("spine.config.steering_trim", "Steering Trim", "number", "triangle", 0.15, 0, 0.07),
      ],
      inputs: [
        createMockField("spine.inputs.desired_speed", "Desired Speed", "number", "sine", 0.7, 0.15, 0.14),
        createMockField("spine.inputs.stop_requested", "Stop Requested", "boolean", "pulse", 1, 0, 0.05),
      ],
      outputs: [
        createMockField("spine.outputs.left_wheel_speed", "Left Wheel Speed", "number", "sine", 1.2, 0, 0.21),
        createMockField("spine.outputs.right_wheel_speed", "Right Wheel Speed", "number", "sine", 1.1, 0.08, 0.22),
      ],
      stats: [
        createMockField("spine.stats.tick_duration_ms", "Tick Duration (ms)", "number", "ramp", 2.2, 1.2, 0.18),
      ],
    },
  },
  {
    name: "face",
    sections: {
      config: [
        createMockField("face.config.idle_brightness", "Idle Brightness", "number", "drift", 0.18, 0.62, 0.03),
      ],
      inputs: [
        createMockField("face.inputs.eyes_open_amount", "Eyes Open Amount", "number", "triangle", 0.5, 0.5, 0.16),
        createMockField("face.inputs.blink_requested", "Blink Requested", "boolean", "pulse", 1, 0, 0.18),
      ],
      outputs: [
        createMockField("face.outputs.mouth_curve", "Mouth Curve", "number", "sine", 0.6, 0, 0.1),
        createMockField("face.outputs.eyebrow_tension", "Eyebrow Tension", "number", "triangle", 0.4, 0.25, 0.07),
      ],
      stats: [
        createMockField("face.stats.frame_skips", "Frame Skips", "boolean", "pulse", 1, 0, 0.03),
      ],
    },
  },
];

function createMockField(
  path: string,
  label: string,
  kind: MockSignalKind,
  generator: MockSignalGenerator,
  amplitude: number,
  baseline: number,
  frequencyHz: number
): MockField {
  return { path, label, kind, generator, amplitude, baseline, frequencyHz };
}

function createTraceId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `trace-${Math.random().toString(36).slice(2, 10)}`;
}

function createTrace(
  fieldPath: string,
  color: string
): TraceConfig {
  return {
    id: createTraceId(),
    fieldPath,
    visible: true,
    color,
  };
}

function createDefaultSettings(defaultFieldPath: string): ScopePanelSettings {
  return {
    modelPath: "",
    workloadName: MOCK_WORKLOADS[0]?.name ?? "",
    section: "outputs",
    traces: [createTrace(defaultFieldPath, TRACE_COLORS[0])],
    windowSeconds: DEFAULT_WINDOW_SECONDS,
    freeze: false,
    yMode: "auto",
    yMin: DEFAULT_Y_MIN,
    yMax: DEFAULT_Y_MAX,
    showGrid: true,
    showLegend: true,
    showLatestValues: true,
    fieldsExpanded: true,
    settingsExpanded: false,
  };
}

function sanitizeWindowSeconds(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return WINDOW_OPTIONS.includes(numeric) ? numeric : DEFAULT_WINDOW_SECONDS;
}

function isSectionKind(value: unknown): value is SectionKind {
  return (
    value === "config" ||
    value === "inputs" ||
    value === "outputs" ||
    value === "stats"
  );
}

function sanitizeTrace(
  value: unknown,
  index: number,
  defaultFieldPath: string
): TraceConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const data = value as Record<string, unknown>;
  return {
    id: typeof data.id === "string" ? data.id : createTraceId(),
    fieldPath:
      typeof data.fieldPath === "string" && data.fieldPath.length > 0
        ? data.fieldPath
        : defaultFieldPath,
    visible: typeof data.visible === "boolean" ? data.visible : true,
    color:
      typeof data.color === "string" && data.color.length > 0
        ? data.color
        : TRACE_COLORS[index % TRACE_COLORS.length],
  };
}

function readScopePanelSettings(
  storageKey: string,
  defaultFieldPath: string
): ScopePanelSettings {
  const fallback = createDefaultSettings(defaultFieldPath);
  try {
    const raw = readStorageValue(storageKey);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }
    const data = parsed as Record<string, unknown>;
    const traces = Array.isArray(data.traces)
      ? data.traces
          .map((item, index) => sanitizeTrace(item, index, defaultFieldPath))
          .filter((trace): trace is TraceConfig => trace !== null)
      : [];
    return {
      modelPath:
        typeof data.modelPath === "string" ? data.modelPath : fallback.modelPath,
      workloadName:
        typeof data.workloadName === "string"
          ? data.workloadName
          : fallback.workloadName,
      section: isSectionKind(data.section) ? data.section : fallback.section,
      traces: traces.length > 0 ? traces : fallback.traces,
      windowSeconds: sanitizeWindowSeconds(data.windowSeconds),
      freeze:
        typeof data.freeze === "boolean" ? data.freeze : fallback.freeze,
      yMode: data.yMode === "manual" ? "manual" : "auto",
      yMin: typeof data.yMin === "string" ? data.yMin : fallback.yMin,
      yMax: typeof data.yMax === "string" ? data.yMax : fallback.yMax,
      showGrid:
        typeof data.showGrid === "boolean"
          ? data.showGrid
          : fallback.showGrid,
      showLegend:
        typeof data.showLegend === "boolean"
          ? data.showLegend
          : fallback.showLegend,
      showLatestValues:
        typeof data.showLatestValues === "boolean"
          ? data.showLatestValues
          : fallback.showLatestValues,
      fieldsExpanded:
        typeof data.fieldsExpanded === "boolean"
          ? data.fieldsExpanded
          : fallback.fieldsExpanded,
      settingsExpanded:
        typeof data.settingsExpanded === "boolean"
          ? data.settingsExpanded
          : fallback.settingsExpanded,
    };
  } catch {
    return fallback;
  }
}

function writeScopePanelSettings(
  storageKey: string,
  settings: ScopePanelSettings
): void {
  setStorageValue(storageKey, JSON.stringify(settings));
}

function getFirstMockField(): MockField | null {
  for (const workload of MOCK_WORKLOADS) {
    for (const section of SECTION_OPTIONS) {
      const first = workload.sections[section.value][0];
      if (first) {
        return first;
      }
    }
  }
  return null;
}

function getDefaultFieldPath(
  workloadName: string,
  section: SectionKind
): string {
  const workload = MOCK_WORKLOADS.find((entry) => entry.name === workloadName);
  const field = workload?.sections[section]?.[0] ?? getFirstMockField();
  return field?.path ?? "";
}

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function sampleMockField(field: MockField, timeMs: number): number {
  const seconds = timeMs / 1000;
  const phaseOffset = (hashString(field.path) % 360) * (Math.PI / 180);
  const omega = seconds * field.frequencyHz * Math.PI * 2 + phaseOffset;

  if (field.kind === "boolean") {
    return Math.sin(omega) > 0.42 ? 1 : 0;
  }

  switch (field.generator) {
    case "triangle": {
      const normalized = ((seconds * field.frequencyHz + phaseOffset) % 1 + 1) % 1;
      const triangle = normalized < 0.5 ? normalized * 4 - 1 : 3 - normalized * 4;
      return field.baseline + triangle * field.amplitude;
    }
    case "ramp": {
      const normalized = ((seconds * field.frequencyHz + phaseOffset) % 1 + 1) % 1;
      return field.baseline + (normalized * 2 - 1) * field.amplitude;
    }
    case "drift":
      return (
        field.baseline +
        Math.sin(omega) * field.amplitude * 0.6 +
        Math.sin(omega * 0.27) * field.amplitude * 0.4
      );
    case "pulse":
      return Math.sin(omega) > 0.66 ? field.baseline + field.amplitude : field.baseline;
    case "sine":
    default:
      return field.baseline + Math.sin(omega) * field.amplitude;
  }
}

function formatRateLabel(hz: number): string {
  return `${hz.toFixed(hz >= 10 ? 0 : 1)} Hz`;
}

function formatTraceValue(field: MockField, value: number | null): string {
  if (value === null) return "No sample";
  if (field.kind === "boolean") {
    return value >= 0.5 ? "1" : "0";
  }
  return value.toFixed(3);
}

export default function TelemetryScopePage() {
  const panelInstance = usePanelInstance();
  const workspaceIdentifier = panelInstance.workspaceId ?? "workspace";
  const panelIdentifier = panelInstance.panelId ?? "default";
  const storageKey = buildNamespacedKey(
    STORAGE_BASE_KEY,
    workspaceIdentifier,
    panelIdentifier
  );

  const { projectModels } = ProjectData.use();
  const fallbackModels = useMemo<ModelOption[]>(
    () => [
      {
        modelPath: "mock://brain",
        modelName: "Mock Brain",
        modelShortName: "brain",
        preferredTelemetrySampleRateHz: MOCK_SAMPLE_RATE_FALLBACK_HZ,
      },
      {
        modelPath: "mock://spine",
        modelName: "Mock Spine",
        modelShortName: "spine",
        preferredTelemetrySampleRateHz: MOCK_SAMPLE_RATE_FALLBACK_HZ,
      },
      {
        modelPath: "mock://face",
        modelName: "Mock Face",
        modelShortName: "face",
        preferredTelemetrySampleRateHz: MOCK_SAMPLE_RATE_FALLBACK_HZ,
      },
    ],
    []
  );
  const modelOptions = projectModels.data.length
    ? projectModels.data.map((model) => ({
        modelPath: model.modelPath,
        modelName: model.modelName,
        modelShortName: model.modelShortName,
        preferredTelemetrySampleRateHz: model.preferredTelemetrySampleRateHz,
      }))
    : fallbackModels;

  const initialFieldPath = getDefaultFieldPath("brain", "outputs");
  const [settings, setSettings] = useState<ScopePanelSettings>(() =>
    readScopePanelSettings(storageKey, initialFieldPath)
  );
  const historiesRef = useRef<Record<string, SamplePoint[]>>({});
  const [, forceRefresh] = useReducer((count) => count + 1, 0);

  useEffect(() => {
    setSettings(readScopePanelSettings(storageKey, initialFieldPath));
    historiesRef.current = {};
  }, [initialFieldPath, storageKey]);

  const selectedModel =
    modelOptions.find((model) => model.modelPath === settings.modelPath) ??
    modelOptions[0] ??
    null;
  const sampleRateHz =
    selectedModel?.preferredTelemetrySampleRateHz ?? MOCK_SAMPLE_RATE_FALLBACK_HZ;
  const selectedWorkload =
    MOCK_WORKLOADS.find((workload) => workload.name === settings.workloadName) ??
    MOCK_WORKLOADS[0];
  const selectedSection = settings.section;
  const availableFields = selectedWorkload?.sections[selectedSection] ?? [];

  const fieldMap = useMemo(() => {
    const map = new Map<string, MockField>();
    for (const workload of MOCK_WORKLOADS) {
      for (const section of SECTION_OPTIONS) {
        for (const field of workload.sections[section.value]) {
          map.set(field.path, field);
        }
      }
    }
    return map;
  }, []);

  useEffect(() => {
    const nextModelPath = selectedModel?.modelPath ?? "";
    const nextWorkloadName = selectedWorkload?.name ?? settings.workloadName;
    const nextDefaultFieldPath = getDefaultFieldPath(nextWorkloadName, selectedSection);
    setSettings((current) => {
      const hasAvailableField = (fieldPath: string) =>
        availableFields.some((field) => field.path === fieldPath);
      let changed = false;
      const nextTraces =
        current.traces.length > 0
          ? current.traces.map((trace) => {
              if (hasAvailableField(trace.fieldPath)) {
                return trace;
              }
              changed = true;
              return { ...trace, fieldPath: nextDefaultFieldPath };
            })
          : [createTrace(nextDefaultFieldPath, TRACE_COLORS[0])];
      if (current.traces.length === 0) {
        changed = true;
      }
      if (
        current.modelPath === nextModelPath &&
        current.workloadName === nextWorkloadName &&
        !changed
      ) {
        return current;
      }
      return {
        ...current,
        modelPath: nextModelPath,
        workloadName: nextWorkloadName,
        traces: nextTraces,
      };
    });
  }, [availableFields, selectedModel, selectedSection, selectedWorkload, settings.workloadName]);

  useEffect(() => {
    writeScopePanelSettings(storageKey, settings);
  }, [settings, storageKey]);

  useEffect(() => {
    const intervalMs = Math.max(30, Math.round(1000 / sampleRateHz));
    const timer = window.setInterval(() => {
      if (settings.freeze) {
        return;
      }
      const now = performance.now();
      const horizonMs = settings.windowSeconds * 1000;
      for (const trace of settings.traces) {
        const field = fieldMap.get(trace.fieldPath);
        if (!field) continue;
        const series = historiesRef.current[trace.id] ?? [];
        series.push({ timeMs: now, value: sampleMockField(field, now) });
        historiesRef.current[trace.id] = series.filter(
          (point) => now - point.timeMs <= horizonMs
        );
      }
      forceRefresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [fieldMap, sampleRateHz, settings.freeze, settings.traces, settings.windowSeconds]);

  const traces = useMemo<PlotTrace[]>(() => {
    const now = performance.now();
    const windowMs = settings.windowSeconds * 1000;
    return settings.traces
      .map((trace) => {
        const field = fieldMap.get(trace.fieldPath);
        if (!field) return null;
        const rawPoints = historiesRef.current[trace.id] ?? [];
        const visiblePoints = rawPoints.filter((point) => now - point.timeMs <= windowMs);
        const latestValue =
          visiblePoints.length > 0
            ? visiblePoints[visiblePoints.length - 1].value
            : null;
        return {
          ...trace,
          field,
          labelText: field.label,
          latestValue,
          points: visiblePoints,
          polyline: "",
        };
      })
      .filter((trace): trace is PlotTrace => Boolean(trace));
  }, [fieldMap, settings.traces, settings.windowSeconds]);

  const visibleTraces = traces.filter((trace) => trace.visible);
  const yRange = useMemo(() => {
    if (settings.yMode === "manual") {
      const parsedMin = Number(settings.yMin);
      const parsedMax = Number(settings.yMax);
      if (Number.isFinite(parsedMin) && Number.isFinite(parsedMax) && parsedMin < parsedMax) {
        return { min: parsedMin, max: parsedMax };
      }
    }
    const values = visibleTraces.flatMap((trace) => trace.points.map((point) => point.value));
    if (values.length === 0) {
      return { min: -1, max: 1 };
    }
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.2 : 1;
      min -= pad;
      max += pad;
      return { min, max };
    }
    const padding = (max - min) * 0.1;
    return { min: min - padding, max: max + padding };
  }, [settings.yMax, settings.yMin, settings.yMode, visibleTraces]);

  const plotTraces = useMemo<PlotTrace[]>(() => {
    const xSpan = PLOT_WIDTH - PLOT_PADDING.left - PLOT_PADDING.right;
    const ySpan = PLOT_HEIGHT - PLOT_PADDING.top - PLOT_PADDING.bottom;
    const now = performance.now();
    const windowMs = settings.windowSeconds * 1000;
    return visibleTraces.map((trace) => {
      const polyline = trace.points
        .map((point) => {
          const ageMs = now - point.timeMs;
          const normalizedX = 1 - ageMs / windowMs;
          const normalizedY = (point.value - yRange.min) / (yRange.max - yRange.min);
          const x = PLOT_PADDING.left + normalizedX * xSpan;
          const y = PLOT_PADDING.top + (1 - normalizedY) * ySpan;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
      return { ...trace, polyline };
    });
  }, [settings.windowSeconds, visibleTraces, yRange.max, yRange.min]);

  const updateSettings = (partial: Partial<ScopePanelSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
  };

  const updateTrace = (traceId: string, partial: Partial<TraceConfig>) => {
    setSettings((current) => ({
      ...current,
      traces: current.traces.map((trace) =>
        trace.id === traceId ? { ...trace, ...partial } : trace
      ),
    }));
  };

  const addTrace = () => {
    const defaultFieldPath =
      availableFields[0]?.path ?? getDefaultFieldPath(selectedWorkload.name, selectedSection);
    setSettings((current) => ({
      ...current,
      traces: [
        ...current.traces,
        createTrace(
          defaultFieldPath,
          TRACE_COLORS[current.traces.length % TRACE_COLORS.length]
        ),
      ],
    }));
  };

  const removeTrace = (traceId: string) => {
    setSettings((current) => {
      const remaining = current.traces.filter((trace) => trace.id !== traceId);
      delete historiesRef.current[traceId];
      if (remaining.length > 0) {
        return { ...current, traces: remaining };
      }
      const defaultFieldPath =
        availableFields[0]?.path ?? getDefaultFieldPath(selectedWorkload.name, selectedSection);
      return {
        ...current,
        traces: [createTrace(defaultFieldPath, TRACE_COLORS[0])],
      };
    });
    forceRefresh();
  };

  const clearHistory = () => {
    historiesRef.current = {};
    forceRefresh();
  };

  if (settings.traces.length === 0) {
    return (
      <div className={styles.panelBody}>
        <div className={styles.message}>No compatible mock fields available.</div>
      </div>
    );
  }

  return (
    <div className={styles.panelBody}>
      <div className={styles.traceBand}>
        {settings.fieldsExpanded ? (
          <div className={styles.expandedPanel}>
            <div className={styles.traceArray}>
              {settings.traces.map((trace) => {
                return (
                  <div className={styles.traceRow} key={trace.id}>
                    <div className={styles.traceFields}>
                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={() => removeTrace(trace.id)}
                        aria-label="Remove trace"
                        title="Remove trace"
                      >
                        ×
                      </button>

                      <label className={styles.control}>
                        <span>Model</span>
                        <select
                          value={selectedModel?.modelPath ?? ""}
                          onChange={(event) =>
                            updateSettings({ modelPath: event.target.value })
                          }
                        >
                          {modelOptions.map((model) => (
                            <option key={model.modelPath} value={model.modelPath}>
                              {model.modelName}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className={styles.control}>
                        <span>Workload</span>
                        <select
                          value={selectedWorkload.name}
                          onChange={(event) =>
                            updateSettings({ workloadName: event.target.value })
                          }
                        >
                          {MOCK_WORKLOADS.map((workload) => (
                            <option key={workload.name} value={workload.name}>
                              {workload.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className={styles.control}>
                        <span>Section</span>
                        <select
                          value={selectedSection}
                          onChange={(event) =>
                            updateSettings({
                              section: event.target.value as SectionKind,
                            })
                          }
                        >
                          {SECTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className={styles.control}>
                        <span>Field</span>
                        <select
                          value={trace.fieldPath}
                          onChange={(event) =>
                            updateTrace(trace.id, {
                              fieldPath: event.target.value,
                            })
                          }
                        >
                          {availableFields.map((field) => (
                            <option key={field.path} value={field.path}>
                              {field.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.control}>
                        <span>Color</span>
                        <input
                          className={styles.colorInput}
                          type="color"
                          value={trace.color}
                          onChange={(event) =>
                            updateTrace(trace.id, { color: event.target.value })
                          }
                        />
                      </label>

                      <label className={styles.toggle}>
                        <input
                          type="checkbox"
                          checked={trace.visible}
                          onChange={(event) =>
                            updateTrace(trace.id, {
                              visible: event.target.checked,
                            })
                          }
                        />
                        Visible
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.fieldsFooter}>
              <button
                type="button"
                className={styles.expandToggleBottom}
                onClick={() => updateSettings({ fieldsExpanded: false })}
              >
                <span
                  className={`${styles.chevron} ${styles.chevronExpanded}`}
                >
                  ▾
                </span>
                Hide Field Settings
              </button>

              <button type="button" className={styles.addButton} onClick={addTrace}>
                + Add Field
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.expandToggle}
            onClick={() => updateSettings({ fieldsExpanded: true })}
          >
            <span className={styles.chevron}>▾</span>
            Show Field Settings
          </button>
        )}
      </div>

      <div className={styles.preview}>
        {plotTraces.length > 0 ? (
          <>
            <svg
              className={styles.plotSvg}
              viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
              preserveAspectRatio="none"
              aria-label="Telemetry scope preview"
            >
              {settings.showGrid
                ? Array.from({ length: 6 }, (_, index) => {
                    const y =
                      PLOT_PADDING.top +
                      ((PLOT_HEIGHT - PLOT_PADDING.top - PLOT_PADDING.bottom) / 5) *
                        index;
                    return (
                      <line
                        key={`grid-y-${index}`}
                        x1={PLOT_PADDING.left}
                        y1={y}
                        x2={PLOT_WIDTH - PLOT_PADDING.right}
                        y2={y}
                        stroke="rgba(255,255,255,0.08)"
                        strokeDasharray="4 8"
                      />
                    );
                  })
                : null}

              {settings.showGrid
                ? Array.from({ length: 7 }, (_, index) => {
                    const x =
                      PLOT_PADDING.left +
                      ((PLOT_WIDTH - PLOT_PADDING.left - PLOT_PADDING.right) / 6) *
                        index;
                    return (
                      <line
                        key={`grid-x-${index}`}
                        x1={x}
                        y1={PLOT_PADDING.top}
                        x2={x}
                        y2={PLOT_HEIGHT - PLOT_PADDING.bottom}
                        stroke="rgba(255,255,255,0.05)"
                        strokeDasharray="4 10"
                      />
                    );
                  })
                : null}

              {plotTraces.map((trace) =>
                trace.polyline.length > 0 ? (
                  <polyline
                    key={trace.id}
                    fill="none"
                    stroke={trace.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={trace.polyline}
                  />
                ) : null
              )}
            </svg>

            {settings.showLegend ? (
              <div className={styles.legend}>
                {plotTraces.map((trace) => (
                  <div className={styles.legendRow} key={trace.id}>
                    <span
                      className={styles.legendSwatch}
                      style={{ background: trace.color }}
                    />
                    <span className={styles.legendLabel}>{trace.labelText}</span>
                    {settings.showLatestValues ? (
                      <span className={styles.legendValue}>
                        {formatTraceValue(trace.field, trace.latestValue)}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className={styles.statusBar}>
              <span>Mock Preview</span>
              <span>{formatRateLabel(sampleRateHz)}</span>
              <span>
                Range {yRange.min.toFixed(2)} to {yRange.max.toFixed(2)}
              </span>
            </div>
          </>
        ) : (
          <div className={styles.message}>No visible traces.</div>
        )}
      </div>

      <div className={styles.settingsBand}>
        <button
          type="button"
          className={styles.expandToggle}
          onClick={() =>
            updateSettings({ settingsExpanded: !settings.settingsExpanded })
          }
        >
          <span
            className={`${styles.chevron} ${
              settings.settingsExpanded ? styles.chevronExpanded : ""
            }`}
          >
            ▴
          </span>
          {settings.settingsExpanded ? "Hide Scope Settings" : "Show Scope Settings"}
        </button>

        {settings.settingsExpanded ? (
          <div className={styles.expandedPanel}>
            <div className={styles.settingsGrid}>
              <label className={styles.control}>
                <span>Window</span>
                <select
                  value={settings.windowSeconds}
                  onChange={(event) =>
                    updateSettings({
                      windowSeconds: sanitizeWindowSeconds(event.target.value),
                    })
                  }
                >
                  {WINDOW_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds}s
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.control}>
                <span>Sample Rate</span>
                <input type="text" value={formatRateLabel(sampleRateHz)} readOnly />
              </label>

              <label className={styles.control}>
                <span>Y Mode</span>
                <select
                  value={settings.yMode}
                  onChange={(event) =>
                    updateSettings({ yMode: event.target.value as YMode })
                  }
                >
                  <option value="auto">Auto</option>
                  <option value="manual">Manual</option>
                </select>
              </label>

              <label className={styles.control}>
                <span>Y Min</span>
                <input
                  type="number"
                  value={settings.yMin}
                  disabled={settings.yMode === "auto"}
                  onChange={(event) => updateSettings({ yMin: event.target.value })}
                />
              </label>

              <label className={styles.control}>
                <span>Y Max</span>
                <input
                  type="number"
                  value={settings.yMax}
                  disabled={settings.yMode === "auto"}
                  onChange={(event) => updateSettings({ yMax: event.target.value })}
                />
              </label>
            </div>

            <div className={styles.toggleRow}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.freeze}
                  onChange={(event) =>
                    updateSettings({ freeze: event.target.checked })
                  }
                />
                Freeze
              </label>

              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.showGrid}
                  onChange={(event) =>
                    updateSettings({ showGrid: event.target.checked })
                  }
                />
                Show Grid
              </label>

              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.showLegend}
                  onChange={(event) =>
                    updateSettings({ showLegend: event.target.checked })
                  }
                />
                Show Legend
              </label>

              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.showLatestValues}
                  onChange={(event) =>
                    updateSettings({ showLatestValues: event.target.checked })
                  }
                />
                Show Latest Values
              </label>

              <button type="button" className={styles.clearButton} onClick={clearHistory}>
                Clear
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
