import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ProjectData } from "../../../data-sources/launcher";
import {
  type ITelemetryField,
  type ITelemetryModel,
  type ITelemetryStruct,
  type ITelemetryWorkload,
  useTelemetryService,
} from "../../../data-sources/telemetry";
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
  telemetryBaseUrl: string;
  preferredTelemetrySampleRateHz?: number;
};

type SectionKind = "config" | "inputs" | "outputs" | "stats";
type YMode = "auto" | "manual";

type TraceConfig = {
  id: string;
  modelPath: string;
  workloadName: string;
  section: SectionKind;
  fieldPath: string;
  visible: boolean;
  color: string;
  scale: string;
  offset: string;
};

type ScopePanelSettings = {
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

type ScopeFieldOption = {
  path: string;
  label: string;
  type: string;
  isBoolean: boolean;
};

type SamplePoint = {
  timeMs: number;
  value: number;
  breakBefore?: boolean;
};

type PlotTrace = TraceConfig & {
  field: ScopeFieldOption;
  labelText: string;
  latestValue: number | null;
  points: SamplePoint[];
  polylines: string[];
};

type TraceScrubKind = "scale" | "offset";

type TraceScrubState = {
  previousUserSelect: string;
  onMove: (event: MouseEvent) => void;
  onUp: () => void;
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
const DEFAULT_SAMPLE_RATE_HZ = 20;

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
  modelPath: string,
  workloadName: string,
  section: SectionKind,
  fieldPath: string,
  color: string
): TraceConfig {
  return {
    id: createTraceId(),
    modelPath,
    workloadName,
    section,
    fieldPath,
    visible: true,
    color,
    scale: "1",
    offset: "0",
  };
}

function createDefaultSettings(): ScopePanelSettings {
  return {
    traces: [createTrace("", "", "outputs", "", TRACE_COLORS[0])],
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
  migrationDefaults: Partial<TraceConfig>
): TraceConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const data = value as Record<string, unknown>;
  return {
    id: typeof data.id === "string" ? data.id : createTraceId(),
    modelPath:
      typeof data.modelPath === "string"
        ? data.modelPath
        : migrationDefaults.modelPath ?? "",
    workloadName:
      typeof data.workloadName === "string"
        ? data.workloadName
        : migrationDefaults.workloadName ?? "",
    section: isSectionKind(data.section)
      ? data.section
      : migrationDefaults.section ?? "outputs",
    fieldPath:
      typeof data.fieldPath === "string"
        ? data.fieldPath
        : migrationDefaults.fieldPath ?? "",
    visible: typeof data.visible === "boolean" ? data.visible : true,
    color:
      typeof data.color === "string" && data.color.length > 0
        ? data.color
        : TRACE_COLORS[index % TRACE_COLORS.length],
    scale: typeof data.scale === "string" ? data.scale : "1",
    offset: typeof data.offset === "string" ? data.offset : "0",
  };
}

function readScopePanelSettings(storageKeys: string[]): ScopePanelSettings {
  const fallback = createDefaultSettings();
  try {
    const raw =
      storageKeys.map((storageKey) => readStorageValue(storageKey)).find(Boolean) ??
      null;
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }
    const data = parsed as Record<string, unknown>;
    const migrationDefaults: Partial<TraceConfig> = {
      modelPath: typeof data.modelPath === "string" ? data.modelPath : "",
      workloadName:
        typeof data.workloadName === "string" ? data.workloadName : "",
      section: isSectionKind(data.section) ? data.section : "outputs",
      fieldPath: typeof data.fieldPath === "string" ? data.fieldPath : "",
    };
    const traces = Array.isArray(data.traces)
      ? data.traces
          .map((item, index) => sanitizeTrace(item, index, migrationDefaults))
          .filter((trace): trace is TraceConfig => trace !== null)
      : [];
    return {
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
  storageKeys: string[],
  settings: ScopePanelSettings
): void {
  const serialized = JSON.stringify(settings);
  for (const storageKey of storageKeys) {
    setStorageValue(storageKey, serialized);
  }
}

function getStruct(
  workload: ITelemetryWorkload,
  section: SectionKind
): ITelemetryStruct | undefined {
  if (section === "config") return workload.config;
  if (section === "inputs") return workload.inputs;
  if (section === "outputs") return workload.outputs;
  return workload.stats;
}

function isBooleanField(field: ITelemetryField): boolean {
  return field.type === "bool";
}

function isNumericField(field: ITelemetryField): boolean {
  if (field.enum_values && field.enum_values.length > 0) return true;
  return (
    field.type === "float" ||
    field.type === "double" ||
    field.type === "int" ||
    field.type === "int32_t" ||
    field.type === "uint32_t" ||
    field.type === "uint16_t" ||
    field.type === "int16_t" ||
    field.type === "int8_t" ||
    field.type === "uint8_t"
  );
}

function isCompatibleScalarField(field: ITelemetryField): boolean {
  if (field.elementCount !== 1) return false;
  if (field.fields && field.fields.length > 0) return false;
  if (field.mime_type && field.mime_type !== "text/plain") return false;
  return isBooleanField(field) || isNumericField(field);
}

function collectScalarFields(
  fields: ITelemetryField[],
  workloadName: string,
  section: SectionKind,
  out: ScopeFieldOption[] = []
): ScopeFieldOption[] {
  for (const field of fields) {
    if (isCompatibleScalarField(field)) {
      out.push({
        path: field.path,
        label: formatFieldLabel(field.path, workloadName, section),
        type: field.type,
        isBoolean: isBooleanField(field),
      });
      continue;
    }
    if (field.fields && field.fields.length > 0) {
      collectScalarFields(field.fields, workloadName, section, out);
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function formatFieldLabel(
  path: string,
  workloadName: string,
  section: SectionKind
): string {
  const sectionPrefix = `${workloadName}.${section}.`;
  if (path.startsWith(sectionPrefix)) {
    return path.slice(sectionPrefix.length);
  }
  const segments = path.split(".");
  const relativePath = segments.slice(2).join(".");
  return relativePath || segments[segments.length - 1] || path;
}

function coerceScalarValue(field: ITelemetryField): number | null {
  const value = field.getValue?.();
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return null;
}

function parseTraceTransformValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function transformTraceValue(trace: TraceConfig, value: number): number {
  const scale = parseTraceTransformValue(trace.scale, 1);
  const offset = parseTraceTransformValue(trace.offset, 0);
  return value * scale + offset;
}

function formatTraceTransformValue(value: number): string {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3);
}

function hasTraceTransform(trace: TraceConfig): boolean {
  return (
    parseTraceTransformValue(trace.scale, 1) !== 1 ||
    parseTraceTransformValue(trace.offset, 0) !== 0
  );
}

function formatRateLabel(hzValues: number[]): string {
  const valid = hzValues.filter((value) => Number.isFinite(value) && value > 0);
  if (valid.length === 0) return "Waiting";
  const unique = Array.from(new Set(valid.map((value) => value.toFixed(1))));
  if (unique.length === 1) {
    const value = valid[0];
    return `${value.toFixed(value >= 10 ? 0 : 1)} Hz`;
  }
  return "Mixed";
}

function formatTraceValue(
  trace: TraceConfig,
  field: ScopeFieldOption,
  value: number | null
): string {
  if (value === null) return "No sample";
  if (field.isBoolean && !hasTraceTransform(trace)) return value >= 0.5 ? "1" : "0";
  return value.toFixed(3);
}

function getTraceModel(
  trace: TraceConfig,
  modelOptions: ModelOption[]
): ModelOption | null {
  return (
    modelOptions.find((model) => model.modelPath === trace.modelPath) ??
    modelOptions[0] ??
    null
  );
}

function getWorkloadOptions(
  trace: TraceConfig,
  modelOptions: ModelOption[],
  modelsByPath: ReadonlyMap<string, ITelemetryModel>
): ITelemetryWorkload[] {
  const selectedModel = getTraceModel(trace, modelOptions);
  if (!selectedModel) return [];
  return modelsByPath.get(selectedModel.modelPath)?.workloads ?? [];
}

function getSelectedWorkload(
  trace: TraceConfig,
  modelOptions: ModelOption[],
  modelsByPath: ReadonlyMap<string, ITelemetryModel>
): ITelemetryWorkload | null {
  const workloads = getWorkloadOptions(trace, modelOptions, modelsByPath);
  return (
    workloads.find((workload) => workload.name === trace.workloadName) ??
    workloads[0] ??
    null
  );
}

function getFieldOptions(
  trace: TraceConfig,
  modelOptions: ModelOption[],
  modelsByPath: ReadonlyMap<string, ITelemetryModel>
): ScopeFieldOption[] {
  const workload = getSelectedWorkload(trace, modelOptions, modelsByPath);
  if (!workload) return [];
  const struct = getStruct(workload, trace.section);
  return collectScalarFields(struct?.fields ?? [], workload.name, trace.section);
}

export default function TelemetryScopePage() {
  const panelInstance = usePanelInstance();
  const telemetryService = useTelemetryService();
  const workspaceIdentifier = panelInstance.workspaceId ?? "workspace";
  const panelIdentifier = panelInstance.panelId ?? "default";
  const storageKey = buildNamespacedKey(
    STORAGE_BASE_KEY,
    workspaceIdentifier,
    panelIdentifier
  );
  const sharedStorageKey = buildNamespacedKey(STORAGE_BASE_KEY, workspaceIdentifier);
  const storageKeys = useMemo(
    () => [storageKey, sharedStorageKey],
    [sharedStorageKey, storageKey]
  );

  const { projectModels } = ProjectData.use();
  const modelOptions: ModelOption[] = useMemo(
    () =>
      projectModels.data.map((model) => ({
        modelPath: model.modelPath,
        modelName: model.modelName,
        telemetryBaseUrl: model.telemetryBaseUrl,
        preferredTelemetrySampleRateHz: model.preferredTelemetrySampleRateHz,
      })),
    [projectModels.data]
  );
  const [settings, setSettings] = useState<ScopePanelSettings>(() =>
    readScopePanelSettings(storageKeys)
  );
  const [modelsByPath, setModelsByPath] = useState<Map<string, ITelemetryModel>>(
    () => new Map()
  );
  const historiesRef = useRef<Record<string, SamplePoint[]>>({});
  const settingsRef = useRef(settings);
  const modelOptionsRef = useRef(modelOptions);
  const pauseGapTraceIdsRef = useRef<Set<string>>(new Set());
  const freezeTimeMsRef = useRef<number | null>(settings.freeze ? performance.now() : null);
  const traceScrubRef = useRef<TraceScrubState | null>(null);
  const [, forceRefresh] = useReducer((count) => count + 1, 0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    modelOptionsRef.current = modelOptions;
  }, [modelOptions]);

  useEffect(() => {
    if (settings.freeze && freezeTimeMsRef.current === null) {
      freezeTimeMsRef.current = performance.now();
    }
    if (!settings.freeze) {
      freezeTimeMsRef.current = null;
    }
  }, [settings.freeze]);

  useEffect(() => {
    setSettings(readScopePanelSettings(storageKeys));
    historiesRef.current = {};
  }, [storageKeys]);

  useEffect(() => {
    return () => {
      const scrub = traceScrubRef.current;
      if (!scrub) return;
      window.removeEventListener("mousemove", scrub.onMove);
      window.removeEventListener("mouseup", scrub.onUp);
      document.body.style.userSelect = scrub.previousUserSelect;
      traceScrubRef.current = null;
    };
  }, []);

  useEffect(() => {
    writeScopePanelSettings(storageKeys, settings);
  }, [settings, storageKeys]);

  const selectedModelOptions = useMemo(() => {
    const seen = new Set<string>();
    const selected: ModelOption[] = [];
    for (const trace of settings.traces) {
      const model = getTraceModel(trace, modelOptions);
      if (!model || seen.has(model.modelPath)) continue;
      seen.add(model.modelPath);
      selected.push(model);
    }
    return selected;
  }, [modelOptions, settings.traces]);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    for (const descriptor of selectedModelOptions) {
      if (!descriptor.telemetryBaseUrl) continue;
      const sampleRateHz =
        descriptor.preferredTelemetrySampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
      void telemetryService
        .ensureLayout(descriptor.telemetryBaseUrl)
        .then((model) => {
          if (cancelled || !model) return;
          setModelsByPath((current) => {
            const next = new Map(current);
            next.set(descriptor.modelPath, model);
            return next;
          });
        })
        .catch(() => {
          // The panel renders the missing-schema state from the model map.
        });

      const unsubscribe = telemetryService.subscribeTelemetry(
        descriptor.telemetryBaseUrl,
        sampleRateHz,
        {
          callback: (model) => {
            if (cancelled) return;
            setModelsByPath((current) => {
              const next = new Map(current);
              next.set(descriptor.modelPath, model);
              return next;
            });
            sampleTelemetryModel(descriptor.modelPath, model);
          },
        }
      );
      cleanups.push(unsubscribe);
    }

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [selectedModelOptions, telemetryService]);

  function sampleTelemetryModel(modelPath: string, model: ITelemetryModel) {
    const current = settingsRef.current;
    if (current.freeze) return;
    const now = performance.now();
    const horizonMs = current.windowSeconds * 1000;
    let changed = false;

    for (const trace of current.traces) {
      if (trace.modelPath !== modelPath) continue;
      if (!trace.fieldPath || typeof model.getField !== "function") continue;
      const field = model.getField(trace.fieldPath);
      if (!field || !isCompatibleScalarField(field)) continue;
      const value = coerceScalarValue(field);
      if (value === null) continue;
      const series = historiesRef.current[trace.id] ?? [];
      const breakBefore =
        pauseGapTraceIdsRef.current.has(trace.id) && series.length > 0;
      series.push({ timeMs: now, value, breakBefore });
      pauseGapTraceIdsRef.current.delete(trace.id);
      historiesRef.current[trace.id] = series.filter(
        (point) => now - point.timeMs <= horizonMs
      );
      changed = true;
    }

    if (changed) forceRefresh();
  }

  useEffect(() => {
    setSettings((current) => {
      let changed = false;
      const nextTraces = current.traces.map((trace, index) => {
        const nextTrace = normalizeTraceSelection(
          trace,
          index,
          modelOptions,
          modelsByPath
        );
        if (!tracesEqual(trace, nextTrace)) changed = true;
        return nextTrace;
      });
      if (!changed) return current;
      return { ...current, traces: nextTraces };
    });
  }, [modelOptions, modelsByPath]);

  const selectedRates = selectedModelOptions.map(
    (model) => model.preferredTelemetrySampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ
  );
  const sampleRateLabel = formatRateLabel(selectedRates);

  const traceFieldOptions = useMemo(() => {
    const map = new Map<string, ScopeFieldOption[]>();
    for (const trace of settings.traces) {
      map.set(trace.id, getFieldOptions(trace, modelOptions, modelsByPath));
    }
    return map;
  }, [modelOptions, modelsByPath, settings.traces]);

  const plotNowMs =
    settings.freeze && freezeTimeMsRef.current !== null
      ? freezeTimeMsRef.current
      : performance.now();

  const traces = useMemo<PlotTrace[]>(() => {
    const windowMs = settings.windowSeconds * 1000;
    return settings.traces
      .map((trace) => {
        const field =
          traceFieldOptions
            .get(trace.id)
            ?.find((option) => option.path === trace.fieldPath) ?? null;
        if (!field) return null;
        const rawPoints = historiesRef.current[trace.id] ?? [];
        const visiblePoints = rawPoints.filter(
          (point) => plotNowMs - point.timeMs <= windowMs
        );
        const latestValue =
          visiblePoints.length > 0
            ? transformTraceValue(trace, visiblePoints[visiblePoints.length - 1].value)
            : null;
        return {
          ...trace,
          field,
          labelText: field.label,
          latestValue,
          points: visiblePoints.map((point) => ({
            ...point,
            value: transformTraceValue(trace, point.value),
          })),
          polylines: [],
        };
      })
      .filter((trace): trace is PlotTrace => Boolean(trace));
  }, [plotNowMs, settings.traces, settings.windowSeconds, traceFieldOptions]);

  const visibleTraces = traces.filter((trace) => trace.visible);
  const autoYRange = useMemo(() => {
    const values = visibleTraces.flatMap((trace) =>
      trace.points.map((point) => point.value)
    );
    if (values.length === 0) return { min: -1, max: 1 };
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
  }, [visibleTraces]);

  const yRange = useMemo(() => {
    if (settings.yMode === "manual") {
      const parsedMin = Number(settings.yMin);
      const parsedMax = Number(settings.yMax);
      if (
        Number.isFinite(parsedMin) &&
        Number.isFinite(parsedMax) &&
        parsedMin < parsedMax
      ) {
        return { min: parsedMin, max: parsedMax };
      }
    }
    return autoYRange;
  }, [autoYRange, settings.yMax, settings.yMin, settings.yMode]);

  const plotTraces = useMemo<PlotTrace[]>(() => {
    const xSpan = PLOT_WIDTH - PLOT_PADDING.left - PLOT_PADDING.right;
    const ySpan = PLOT_HEIGHT - PLOT_PADDING.top - PLOT_PADDING.bottom;
    const windowMs = settings.windowSeconds * 1000;
    return visibleTraces.map((trace) => {
      const polylines: string[] = [];
      let segment: string[] = [];
      for (const point of trace.points) {
        if (point.breakBefore && segment.length > 0) {
          polylines.push(segment.join(" "));
          segment = [];
        }
        const ageMs = plotNowMs - point.timeMs;
        const normalizedX = 1 - ageMs / windowMs;
        const normalizedY = (point.value - yRange.min) / (yRange.max - yRange.min);
        const x = PLOT_PADDING.left + normalizedX * xSpan;
        const y = PLOT_PADDING.top + (1 - normalizedY) * ySpan;
        segment.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      if (segment.length > 0) {
        polylines.push(segment.join(" "));
      }
      return { ...trace, polylines };
    });
  }, [plotNowMs, settings.windowSeconds, visibleTraces, yRange.max, yRange.min]);

  const emptyMessage = getEmptyMessage(
    projectModels.loading,
    modelOptions,
    settings.traces,
    modelsByPath,
    traceFieldOptions,
    plotTraces
  );

  const updateSettings = (partial: Partial<ScopePanelSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
  };

  const updateYMode = (yMode: YMode) => {
    setSettings((current) => {
      if (yMode !== "manual" || current.yMode === "manual") {
        return { ...current, yMode };
      }
      return {
        ...current,
        yMode,
        yMin: autoYRange.min.toFixed(3),
        yMax: autoYRange.max.toFixed(3),
      };
    });
  };

  const updateFreeze = (freeze: boolean) => {
    if (!freeze && settingsRef.current.freeze) {
      pauseGapTraceIdsRef.current = new Set(
        settingsRef.current.traces.map((trace) => trace.id)
      );
    }
    freezeTimeMsRef.current = freeze ? performance.now() : null;
    updateSettings({ freeze });
  };

  const updateTrace = (traceId: string, partial: Partial<TraceConfig>) => {
    setSettings((current) => ({
      ...current,
      traces: current.traces.map((trace) =>
        trace.id === traceId ? { ...trace, ...partial } : trace
      ),
    }));
  };

  const adjustTraceTransform = (
    traceId: string,
    kind: TraceScrubKind,
    nextNumericValue: number
  ) => {
    updateTrace(traceId, {
      [kind]: formatTraceTransformValue(nextNumericValue),
    } as Partial<TraceConfig>);
  };

  const startTraceTransformScrub = (
    event: React.MouseEvent<HTMLButtonElement>,
    trace: TraceConfig,
    kind: TraceScrubKind
  ) => {
    event.preventDefault();
    const existing = traceScrubRef.current;
    if (existing) {
      window.removeEventListener("mousemove", existing.onMove);
      window.removeEventListener("mouseup", existing.onUp);
      document.body.style.userSelect = existing.previousUserSelect;
      traceScrubRef.current = null;
    }

    const startValue = parseTraceTransformValue(
      kind === "scale" ? trace.scale : trace.offset,
      kind === "scale" ? 1 : 0
    );
    const pixelsPerStep = 6;
    const scrubStep = 0.01;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - event.clientX;
      const steps = Math.trunc(deltaX / pixelsPerStep);
      const multiplier = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
      const nextValue = startValue + steps * scrubStep * multiplier;
      adjustTraceTransform(trace.id, kind, nextValue);
    };

    const onUp = () => {
      const scrub = traceScrubRef.current;
      if (!scrub) return;
      window.removeEventListener("mousemove", scrub.onMove);
      window.removeEventListener("mouseup", scrub.onUp);
      document.body.style.userSelect = scrub.previousUserSelect;
      traceScrubRef.current = null;
    };

    traceScrubRef.current = {
      previousUserSelect,
      onMove,
      onUp,
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const addTrace = () => {
    setSettings((current) => {
      const source = current.traces[current.traces.length - 1];
      const normalized = normalizeTraceSelection(
        source ?? createDefaultSettings().traces[0],
        current.traces.length,
        modelOptionsRef.current,
        modelsByPath
      );
      return {
        ...current,
        traces: [
          ...current.traces,
          createTrace(
            normalized.modelPath,
            normalized.workloadName,
            normalized.section,
            normalized.fieldPath,
            TRACE_COLORS[current.traces.length % TRACE_COLORS.length]
          ),
        ],
      };
    });
  };

  const removeTrace = (traceId: string) => {
    setSettings((current) => {
      const remaining = current.traces.filter((trace) => trace.id !== traceId);
      delete historiesRef.current[traceId];
      pauseGapTraceIdsRef.current.delete(traceId);
      if (remaining.length > 0) return { ...current, traces: remaining };
      const fallback = normalizeTraceSelection(
        createDefaultSettings().traces[0],
        0,
        modelOptionsRef.current,
        modelsByPath
      );
      return { ...current, traces: [fallback] };
    });
    forceRefresh();
  };

  const clearHistory = () => {
    historiesRef.current = {};
    pauseGapTraceIdsRef.current.clear();
    forceRefresh();
  };

  return (
    <div className={styles.panelBody}>
      <div className={styles.traceBand}>
        <button
          type="button"
          className={styles.expandToggle}
          onClick={() =>
            updateSettings({ fieldsExpanded: !settings.fieldsExpanded })
          }
        >
          <span
            className={`${styles.chevron} ${
              settings.fieldsExpanded ? styles.chevronExpanded : ""
            }`}
          >
            ▾
          </span>
          {settings.fieldsExpanded
            ? "Hide Field Settings"
            : "Show Field Settings"}
        </button>

        {settings.fieldsExpanded ? (
          <div className={styles.expandedPanel}>
            <div className={styles.traceArray}>
              {settings.traces.map((trace) => {
                const selectedModel = getTraceModel(trace, modelOptions);
                const workloadOptions = getWorkloadOptions(
                  trace,
                  modelOptions,
                  modelsByPath
                );
                const fieldOptions = traceFieldOptions.get(trace.id) ?? [];
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
                        x
                      </button>

                      <label className={styles.control}>
                        <span>Model</span>
                        <select
                          value={selectedModel?.modelPath ?? ""}
                          disabled={modelOptions.length === 0}
                          onChange={(event) =>
                            updateTrace(trace.id, {
                              modelPath: event.target.value,
                              workloadName: "",
                              fieldPath: "",
                            })
                          }
                        >
                          {modelOptions.length === 0 ? (
                            <option value="">No models</option>
                          ) : null}
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
                          value={trace.workloadName}
                          disabled={workloadOptions.length === 0}
                          onChange={(event) =>
                            updateTrace(trace.id, {
                              workloadName: event.target.value,
                              fieldPath: "",
                            })
                          }
                        >
                          {workloadOptions.length === 0 ? (
                            <option value="">Waiting</option>
                          ) : null}
                          {workloadOptions.map((workload) => (
                            <option key={workload.name} value={workload.name}>
                              {workload.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className={styles.control}>
                        <span>Section</span>
                        <select
                          value={trace.section}
                          onChange={(event) =>
                            updateTrace(trace.id, {
                              section: event.target.value as SectionKind,
                              fieldPath: "",
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
                          disabled={fieldOptions.length === 0}
                          onChange={(event) =>
                            updateTrace(trace.id, {
                              fieldPath: event.target.value,
                            })
                          }
                        >
                          {fieldOptions.length === 0 ? (
                            <option value="">No scalar fields</option>
                          ) : null}
                          {fieldOptions.map((field) => (
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

                      <label className={styles.control}>
                        <span className={styles.controlLabelRow}>
                          <span>Scale</span>
                          <button
                            type="button"
                            className={styles.scrubHotspot}
                            aria-label={`Adjust scale for ${trace.labelText}`}
                            title="Drag to adjust scale"
                            onMouseDown={(event) =>
                              startTraceTransformScrub(event, trace, "scale")
                            }
                          >
                            <span className={styles.scrubDot} />
                          </button>
                        </span>
                        <input
                          type="number"
                          value={trace.scale}
                          onChange={(event) =>
                            updateTrace(trace.id, { scale: event.target.value })
                          }
                        />
                      </label>

                      <label className={styles.control}>
                        <span className={styles.controlLabelRow}>
                          <span>Offset</span>
                          <button
                            type="button"
                            className={styles.scrubHotspot}
                            aria-label={`Adjust offset for ${trace.labelText}`}
                            title="Drag to adjust offset"
                            onMouseDown={(event) =>
                              startTraceTransformScrub(event, trace, "offset")
                            }
                          >
                            <span className={styles.scrubDot} />
                          </button>
                        </span>
                        <input
                          type="number"
                          value={trace.offset}
                          onChange={(event) =>
                            updateTrace(trace.id, { offset: event.target.value })
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
              <button type="button" className={styles.addButton} onClick={addTrace}>
                + Add Field
              </button>
            </div>
          </div>
        ) : null}
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
                        stroke="rgba(255,255,255,0.14)"
                        strokeWidth="1.2"
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
                        stroke="rgba(255,255,255,0.12)"
                        strokeWidth="1.1"
                        strokeDasharray="4 10"
                      />
                    );
                  })
                : null}

              {plotTraces.flatMap((trace) =>
                trace.polylines.map((polyline, index) => (
                  <polyline
                    key={`${trace.id}-${index}`}
                    fill="none"
                    stroke={trace.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={polyline}
                  />
                ))
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
                        {formatTraceValue(trace, trace.field, trace.latestValue)}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className={styles.statusBar}>
              <span>{sampleRateLabel}</span>
              <span>
                Range {yRange.min.toFixed(2)} to {yRange.max.toFixed(2)}
              </span>
            </div>
          </>
        ) : (
          <div className={styles.message}>{emptyMessage}</div>
        )}
      </div>

      <div className={styles.settingsBand}>
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
                <input type="text" value={sampleRateLabel} readOnly />
              </label>

              <label className={styles.control}>
                <span>Y Mode</span>
                <select
                  value={settings.yMode}
                  onChange={(event) =>
                    updateYMode(event.target.value as YMode)
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
                  value={
                    settings.yMode === "auto"
                      ? autoYRange.min.toFixed(3)
                      : settings.yMin
                  }
                  disabled={settings.yMode === "auto"}
                  onChange={(event) => updateSettings({ yMin: event.target.value })}
                />
              </label>

              <label className={styles.control}>
                <span>Y Max</span>
                <input
                  type="number"
                  value={
                    settings.yMode === "auto"
                      ? autoYRange.max.toFixed(3)
                      : settings.yMax
                  }
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
                    updateFreeze(event.target.checked)
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
      </div>
    </div>
  );
}

function tracesEqual(a: TraceConfig, b: TraceConfig): boolean {
  return (
    a.id === b.id &&
    a.modelPath === b.modelPath &&
    a.workloadName === b.workloadName &&
    a.section === b.section &&
    a.fieldPath === b.fieldPath &&
    a.visible === b.visible &&
    a.color === b.color &&
    a.scale === b.scale &&
    a.offset === b.offset
  );
}

function normalizeTraceSelection(
  trace: TraceConfig,
  index: number,
  modelOptions: ModelOption[],
  modelsByPath: ReadonlyMap<string, ITelemetryModel>
): TraceConfig {
  const hasModelOptions = modelOptions.length > 0;
  const matchingModel =
    modelOptions.find((model) => model.modelPath === trace.modelPath) ?? null;
  const selectedModel = matchingModel ?? modelOptions[0] ?? null;
  const modelPath = hasModelOptions
    ? selectedModel?.modelPath ?? ""
    : trace.modelPath;
  const model = selectedModel ? modelsByPath.get(selectedModel.modelPath) : null;
  const workloads = model?.workloads ?? [];
  const hasResolvedWorkloads = workloads.length > 0;
  const selectedWorkload =
    workloads.find((workload) => workload.name === trace.workloadName) ??
    workloads[0] ??
    null;
  const workloadName = hasResolvedWorkloads
    ? selectedWorkload?.name ?? trace.workloadName
    : trace.workloadName;
  const section = trace.section;
  const fields = selectedWorkload
    ? collectScalarFields(
        getStruct(selectedWorkload, section)?.fields ?? [],
        selectedWorkload.name,
        section
      )
    : [];
  const hasResolvedFields = fields.length > 0;
  const selectedField =
    fields.find((field) => field.path === trace.fieldPath) ?? fields[0] ?? null;
  return {
    ...trace,
    modelPath,
    workloadName,
    fieldPath: hasResolvedFields
      ? selectedField?.path ?? trace.fieldPath
      : trace.fieldPath,
    color: trace.color || TRACE_COLORS[index % TRACE_COLORS.length],
    scale: trace.scale || "1",
    offset: trace.offset || "0",
  };
}

function getEmptyMessage(
  loadingModels: boolean,
  modelOptions: ModelOption[],
  traces: TraceConfig[],
  modelsByPath: ReadonlyMap<string, ITelemetryModel>,
  traceFieldOptions: ReadonlyMap<string, ScopeFieldOption[]>,
  plotTraces: PlotTrace[]
): string {
  if (loadingModels) return "Loading telemetry models...";
  if (modelOptions.length === 0) return "No telemetry models available.";
  if (traces.some((trace) => !modelsByPath.has(trace.modelPath))) {
    return "Waiting for telemetry schema...";
  }
  if (traces.some((trace) => (traceFieldOptions.get(trace.id) ?? []).length === 0)) {
    return "No compatible scalar fields in the selected scope.";
  }
  if (plotTraces.length === 0) return "No visible traces.";
  return "Waiting for telemetry samples...";
}
