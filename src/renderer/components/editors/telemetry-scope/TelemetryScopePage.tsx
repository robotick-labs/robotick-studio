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
import { migrateSelectionToStableIds } from "../telemetry/utils/persisted-selection-migration";
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
type SignalSourceKind = "field" | "generator";
type GeneratorWaveShape = "sine" | "square" | "saw";

type BaseTraceConfig = {
  id: string;
  sourceKind: SignalSourceKind;
  visible: boolean;
  color: string;
  xOffsetSeconds: string;
  scale: string;
  offset: string;
};

type FieldTraceConfig = BaseTraceConfig & {
  sourceKind: "field";
  modelId?: string;
  modelPath: string;
  workloadId?: string;
  workloadName: string;
  section: SectionKind;
  fieldPath: string;
};

type GeneratorTraceConfig = BaseTraceConfig & {
  sourceKind: "generator";
  waveShape: GeneratorWaveShape;
  frequencyHz: string;
};

type TraceConfig = FieldTraceConfig | GeneratorTraceConfig;

type ScopePanelSettings = {
  traces: TraceConfig[];
  windowSeconds: string;
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
  seamBefore?: boolean;
};

type PlotTrace = TraceConfig & {
  isBoolean: boolean;
  labelText: string;
  latestValue: number | null;
  points: SamplePoint[];
  polylines: string[];
  seamMarkers: number[];
};

type ModelTimingAnchor = {
  anchorMs: number;
  lastEngineTimeMs: number | null;
  sessionId: string;
  calibrationSampleCount: number;
  calibrationAnchorSumMs: number;
};

type TraceScrubKind = "scale" | "offset" | "xOffsetSeconds";

type TraceScrubState = {
  previousUserSelect: string;
  onMove: (event: MouseEvent) => void;
  onUp: () => void;
};

type PlotCursorPosition = {
  previewX: number;
  previewY: number;
  svgX: number;
  svgY: number;
  timeSec: number;
  value: number;
};

const STORAGE_BASE_KEY = "robotick-studio.telemetry-scope.panel";
const DEFAULT_WINDOW_SECONDS = 10;
const MIN_WINDOW_SECONDS = 0.1;
const DEFAULT_Y_MIN = "-1";
const DEFAULT_Y_MAX = "1";
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
const GENERATOR_SAMPLE_COUNT = 256;
const RESUME_SEAM_MS = 120;
const MODEL_TIMING_ANCHOR_WARMUP_SAMPLES = 16;

function createTraceId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `trace-${Math.random().toString(36).slice(2, 10)}`;
}

function createFieldTrace(
  modelPath: string,
  workloadName: string,
  section: SectionKind,
  fieldPath: string,
  color: string
): FieldTraceConfig {
  return {
    id: createTraceId(),
    sourceKind: "field",
    modelPath,
    workloadName,
    section,
    fieldPath,
    visible: true,
    color,
    xOffsetSeconds: "0",
    scale: "1",
    offset: "0",
  };
}

function createGeneratorTrace(color: string): GeneratorTraceConfig {
  return {
    id: createTraceId(),
    sourceKind: "generator",
    waveShape: "sine",
    frequencyHz: "1",
    visible: true,
    color,
    xOffsetSeconds: "0",
    scale: "1",
    offset: "0",
  };
}

function createDefaultSettings(): ScopePanelSettings {
  return {
    traces: [createFieldTrace("", "", "outputs", "", TRACE_COLORS[0])],
    windowSeconds: String(DEFAULT_WINDOW_SECONDS),
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

function sanitizeWindowSecondsInput(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(DEFAULT_WINDOW_SECONDS);
}

function parseWindowSeconds(value: string): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= MIN_WINDOW_SECONDS
    ? numeric
    : DEFAULT_WINDOW_SECONDS;
}

function isSectionKind(value: unknown): value is SectionKind {
  return (
    value === "config" ||
    value === "inputs" ||
    value === "outputs" ||
    value === "stats"
  );
}

function isSignalSourceKind(value: unknown): value is SignalSourceKind {
  return value === "field" || value === "generator";
}

function isGeneratorWaveShape(value: unknown): value is GeneratorWaveShape {
  return value === "sine" || value === "square" || value === "saw";
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
  const base = {
    id: typeof data.id === "string" ? data.id : createTraceId(),
    sourceKind: isSignalSourceKind(data.sourceKind) ? data.sourceKind : "field",
    visible: typeof data.visible === "boolean" ? data.visible : true,
    color:
      typeof data.color === "string" && data.color.length > 0
        ? data.color
        : TRACE_COLORS[index % TRACE_COLORS.length],
    xOffsetSeconds:
      typeof data.xOffsetSeconds === "string" ? data.xOffsetSeconds : "0",
    scale: typeof data.scale === "string" ? data.scale : "1",
    offset: typeof data.offset === "string" ? data.offset : "0",
  } satisfies BaseTraceConfig;

  if (base.sourceKind === "generator") {
    return {
      ...base,
      sourceKind: "generator",
      waveShape: isGeneratorWaveShape(data.waveShape) ? data.waveShape : "sine",
      frequencyHz: typeof data.frequencyHz === "string" ? data.frequencyHz : "1",
    };
  }

  return {
    ...base,
    sourceKind: "field",
    modelId:
      typeof data.modelId === "string"
        ? data.modelId
        : "modelId" in migrationDefaults &&
            typeof migrationDefaults.modelId === "string"
          ? migrationDefaults.modelId
          : "",
    modelPath:
      typeof data.modelPath === "string"
        ? data.modelPath
        : "modelPath" in migrationDefaults && typeof migrationDefaults.modelPath === "string"
          ? migrationDefaults.modelPath
          : "",
    workloadId:
      typeof data.workloadId === "string"
        ? data.workloadId
        : "workloadId" in migrationDefaults &&
            typeof migrationDefaults.workloadId === "string"
          ? migrationDefaults.workloadId
          : "",
    workloadName:
      typeof data.workloadName === "string"
        ? data.workloadName
        : "workloadName" in migrationDefaults &&
            typeof migrationDefaults.workloadName === "string"
          ? migrationDefaults.workloadName
          : "",
    section: isSectionKind(data.section)
      ? data.section
      : "section" in migrationDefaults && isSectionKind(migrationDefaults.section)
        ? migrationDefaults.section
        : "outputs",
    fieldPath:
      typeof data.fieldPath === "string"
        ? data.fieldPath
        : "fieldPath" in migrationDefaults && typeof migrationDefaults.fieldPath === "string"
          ? migrationDefaults.fieldPath
          : "",
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
    const migrationDefaults: Partial<FieldTraceConfig> = {
      sourceKind: "field",
      modelId: typeof data.modelId === "string" ? data.modelId : "",
      modelPath: typeof data.modelPath === "string" ? data.modelPath : "",
      workloadId: typeof data.workloadId === "string" ? data.workloadId : "",
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
      windowSeconds: sanitizeWindowSecondsInput(data.windowSeconds),
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

function isFieldTrace(trace: TraceConfig): trace is FieldTraceConfig {
  return trace.sourceKind === "field";
}

function isGeneratorTrace(trace: TraceConfig): trace is GeneratorTraceConfig {
  return trace.sourceKind === "generator";
}

function formatGeneratorLabel(trace: GeneratorTraceConfig): string {
  const frequency = Number(trace.frequencyHz);
  const frequencyText = Number.isFinite(frequency)
    ? `${frequency.toFixed(frequency >= 10 ? 0 : 1)} Hz`
    : "Invalid Hz";
  return `${trace.waveShape} ${frequencyText}`;
}

function formatCursorTimeSeconds(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded.toFixed(Math.abs(rounded) >= 10 ? 2 : 3)} s`;
}

function formatCursorValue(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded.toFixed(3);
}

function getTraceEditorLabel(trace: TraceConfig): string {
  if (isGeneratorTrace(trace)) return formatGeneratorLabel(trace);
  return trace.fieldPath || trace.workloadName || "trace";
}

function parseGeneratorFrequencyHz(trace: GeneratorTraceConfig): number | null {
  const parsed = Number(trace.frequencyHz);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getGeneratorWaveValue(
  waveShape: GeneratorWaveShape,
  frequencyHz: number,
  timeSeconds: number
): number {
  const phase = frequencyHz * timeSeconds;
  const cycle = phase - Math.floor(phase);
  if (waveShape === "square") {
    return cycle < 0.5 ? 1 : -1;
  }
  if (waveShape === "saw") {
    return cycle * 2 - 1;
  }
  return Math.sin(phase * Math.PI * 2);
}

function createGeneratorPoints(
  trace: GeneratorTraceConfig,
  plotNowMs: number,
  windowSeconds: number
): SamplePoint[] {
  const frequencyHz = parseGeneratorFrequencyHz(trace);
  if (frequencyHz === null) return [];
  const sampleCount = Math.max(2, GENERATOR_SAMPLE_COUNT);
  const windowMs = windowSeconds * 1000;
  const points: SamplePoint[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / (sampleCount - 1);
    const timeMs = plotNowMs - windowMs + progress * windowMs;
    points.push({
      timeMs,
      value: getGeneratorWaveValue(trace.waveShape, frequencyHz, timeMs / 1000),
    });
  }
  return points;
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

function getEngineSampleTimeMs(model: ITelemetryModel): number | null {
  if (typeof model.getField !== "function") return null;

  const timeNow = Number(model.getField("engine.clock.time_now")?.getValue?.());
  if (Number.isFinite(timeNow) && timeNow >= 0) {
    return timeNow * 1000;
  }

  const timeNowNs = Number(
    model.getField("engine.clock.time_now_ns")?.getValue?.()
  );
  if (Number.isFinite(timeNowNs) && timeNowNs >= 0) {
    return timeNowNs / 1_000_000;
  }

  return null;
}

function parseTraceTransformValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTraceXOffsetMs(trace: TraceConfig): number {
  return parseTraceTransformValue(trace.xOffsetSeconds, 0) * 1000;
}

function getTraceTransformNumericValue(
  trace: TraceConfig,
  kind: TraceScrubKind
): number {
  if (kind === "scale") {
    return parseTraceTransformValue(trace.scale, 1);
  }
  if (kind === "offset") {
    return parseTraceTransformValue(trace.offset, 0);
  }
  return parseTraceTransformValue(trace.xOffsetSeconds, 0);
}

function toNiceStep(value: number): number {
  const finite = Number.isFinite(value) ? Math.abs(value) : 0;
  if (finite <= 0) return 0.01;
  const exponent = Math.floor(Math.log10(finite));
  const base = finite / 10 ** exponent;
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return niceBase * 10 ** exponent;
}

function getAdaptiveTransformStep(
  kind: TraceScrubKind,
  currentValue: number
): number {
  const magnitude = Math.max(Math.abs(currentValue), kind === "scale" ? 1 : 0.1);
  const raw =
    kind === "scale"
      ? magnitude * 0.02
      : magnitude * 0.05;
  const clamped =
    kind === "scale"
      ? Math.min(0.5, Math.max(0.001, raw))
      : Math.min(2.0, Math.max(0.001, raw));
  return toNiceStep(clamped);
}

function getScaleTransformStep(currentValue: number): number {
  return getAdaptiveTransformStep("scale", currentValue);
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
  const uniqueNumeric = Array.from(new Set(valid.map((value) => Number(value.toFixed(1))))).sort(
    (a, b) => a - b
  );
  return uniqueNumeric
    .map((value) => (value >= 10 ? value.toFixed(0) : value.toFixed(1)))
    .join(" | ");
}

function formatTraceValue(trace: PlotTrace, value: number | null): string {
  if (value === null) return "No sample";
  if (trace.isBoolean && !hasTraceTransform(trace)) {
    return value >= 0.5 ? "1" : "0";
  }
  return value.toFixed(3);
}

function getTraceModel(
  trace: FieldTraceConfig,
  modelOptions: ModelOption[]
): ModelOption | null {
  return (
    modelOptions.find((model) => model.modelPath === trace.modelPath) ??
    modelOptions[0] ??
    null
  );
}

function getWorkloadOptions(
  trace: FieldTraceConfig,
  modelOptions: ModelOption[],
  modelsByPath: ReadonlyMap<string, ITelemetryModel>
): ITelemetryWorkload[] {
  const selectedModel = getTraceModel(trace, modelOptions);
  if (!selectedModel) return [];
  return modelsByPath.get(selectedModel.modelPath)?.workloads ?? [];
}

function getSelectedWorkload(
  trace: FieldTraceConfig,
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
  trace: FieldTraceConfig,
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
  const modelTimingRef = useRef<Record<string, ModelTimingAnchor>>({});
  const pauseGapTraceIdsRef = useRef<Set<string>>(new Set());
  const freezeTimeMsRef = useRef<number | null>(settings.freeze ? performance.now() : null);
  const traceScrubRef = useRef<TraceScrubState | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [cursorPosition, setCursorPosition] = useState<PlotCursorPosition | null>(null);
  const [dragStartPosition, setDragStartPosition] = useState<PlotCursorPosition | null>(null);
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
    modelTimingRef.current = {};
  }, [storageKeys]);

  useEffect(() => {
    if (projectModels.data.length === 0) return;
    setSettings((current) => {
      let changed = false;
      const nextTraces = current.traces.map((trace) => {
        if (!isFieldTrace(trace)) return trace;
        const migrated = migrateSelectionToStableIds(trace, projectModels.data);
        if (JSON.stringify(migrated) !== JSON.stringify(trace)) {
          changed = true;
        }
        return migrated as FieldTraceConfig;
      });
      if (!changed) return current;
      return { ...current, traces: nextTraces };
    });
  }, [projectModels.data]);

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
    if (!dragStartPosition) return;

    const handleMouseUp = () => {
      setDragStartPosition(null);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragStartPosition]);

  useEffect(() => {
    writeScopePanelSettings(storageKeys, settings);
  }, [settings, storageKeys]);

  const selectedModelOptions = useMemo(() => {
    const seen = new Set<string>();
    const selected: ModelOption[] = [];
    for (const trace of settings.traces) {
      if (!isFieldTrace(trace)) continue;
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

  function getAlignedModelSampleTimeMs(modelPath: string, model: ITelemetryModel): number {
    const engineTimeMs = getEngineSampleTimeMs(model);
    if (engineTimeMs === null) {
      return performance.now();
    }

    const sessionId = model.schemaSessionId ?? "";
    const uiNowMs = performance.now();
    const current = modelTimingRef.current[modelPath];
    const didSessionChange = !!current && sessionId !== current.sessionId;
    const didClockRewind =
      !!current &&
      current.lastEngineTimeMs !== null &&
      engineTimeMs + 0.5 < current.lastEngineTimeMs;

    if (!current || didSessionChange || didClockRewind) {
      const instantAnchorMs = uiNowMs - engineTimeMs;
      const next: ModelTimingAnchor = {
        anchorMs: instantAnchorMs,
        lastEngineTimeMs: engineTimeMs,
        sessionId,
        calibrationSampleCount: 1,
        calibrationAnchorSumMs: instantAnchorMs,
      };
      modelTimingRef.current[modelPath] = next;
      return engineTimeMs + next.anchorMs;
    }

    if (current.calibrationSampleCount < MODEL_TIMING_ANCHOR_WARMUP_SAMPLES) {
      const instantAnchorMs = uiNowMs - engineTimeMs;
      current.calibrationAnchorSumMs += instantAnchorMs;
      current.calibrationSampleCount += 1;
      current.anchorMs = current.calibrationAnchorSumMs / current.calibrationSampleCount;
    }

    current.lastEngineTimeMs = engineTimeMs;
    return engineTimeMs + current.anchorMs;
  }

  function sampleTelemetryModel(modelPath: string, model: ITelemetryModel) {
    const current = settingsRef.current;
    if (current.freeze) return;
    const now = getAlignedModelSampleTimeMs(modelPath, model);
    const horizonMs = parseWindowSeconds(current.windowSeconds) * 1000;
    let changed = false;

    for (const trace of current.traces) {
      if (!isFieldTrace(trace)) continue;
      if (trace.modelPath !== modelPath) continue;
      if (!trace.fieldPath || typeof model.getField !== "function") continue;
      const field = model.getField(trace.fieldPath);
      if (!field || !isCompatibleScalarField(field)) continue;
      const value = coerceScalarValue(field);
      if (value === null) continue;
      const series = historiesRef.current[trace.id] ?? [];
      if (
        series.length > 0 &&
        now + RESUME_SEAM_MS < series[series.length - 1].timeMs
      ) {
        historiesRef.current[trace.id] = [];
      }
      const stableSeries = historiesRef.current[trace.id] ?? [];
      const breakBefore =
        pauseGapTraceIdsRef.current.has(trace.id) && stableSeries.length > 0;
      stableSeries.push({
        timeMs: now,
        value,
        breakBefore,
        seamBefore: breakBefore,
      });
      pauseGapTraceIdsRef.current.delete(trace.id);
      historiesRef.current[trace.id] = stableSeries.filter(
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
        if (!isFieldTrace(trace)) return trace;
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
      if (!isFieldTrace(trace)) continue;
      map.set(trace.id, getFieldOptions(trace, modelOptions, modelsByPath));
    }
    return map;
  }, [modelOptions, modelsByPath, settings.traces]);

  const getLatestTraceSampleTimeMs = (traces: ReadonlyArray<TraceConfig>) => {
    let latestTimeMs: number | null = null;
    for (const trace of traces) {
      if (!isFieldTrace(trace)) continue;
      const series = historiesRef.current[trace.id];
      if (!series || series.length === 0) continue;
      const lastPoint = series[series.length - 1];
      if (!lastPoint || !Number.isFinite(lastPoint.timeMs)) continue;
      if (latestTimeMs === null || lastPoint.timeMs > latestTimeMs) {
        latestTimeMs = lastPoint.timeMs;
      }
    }
    return latestTimeMs;
  };

  const plotNowMs = (() => {
    if (settings.freeze && freezeTimeMsRef.current !== null) {
      return freezeTimeMsRef.current;
    }
    const latestSampleTime = getLatestTraceSampleTimeMs(settings.traces);
    return latestSampleTime ?? performance.now();
  })();
  const effectiveWindowSeconds = parseWindowSeconds(settings.windowSeconds);

  const traces = useMemo<PlotTrace[]>(() => {
    const windowMs = effectiveWindowSeconds * 1000;
    const nextTraces: PlotTrace[] = [];
    for (const trace of settings.traces) {
        if (isGeneratorTrace(trace)) {
          const points = createGeneratorPoints(trace, plotNowMs, effectiveWindowSeconds).map(
            (point) => ({
              ...point,
              value: transformTraceValue(trace, point.value),
            })
          );
          nextTraces.push({
            ...trace,
            isBoolean: false,
            labelText: formatGeneratorLabel(trace),
            latestValue: points.length > 0 ? points[points.length - 1].value : null,
            points,
            polylines: [],
            seamMarkers: [],
          });
          continue;
        }
        const field =
          traceFieldOptions
            .get(trace.id)
            ?.find((option) => option.path === trace.fieldPath) ?? null;
        if (!field) continue;
        const rawPoints = historiesRef.current[trace.id] ?? [];
        const visiblePoints = rawPoints.filter(
          (point) => plotNowMs - point.timeMs <= windowMs
        );
        const latestValue =
          visiblePoints.length > 0
            ? transformTraceValue(trace, visiblePoints[visiblePoints.length - 1].value)
            : null;
        nextTraces.push({
          ...trace,
          isBoolean: field.isBoolean,
          labelText: field.label,
          latestValue,
          points: visiblePoints.map((point) => ({
            ...point,
            value: transformTraceValue(trace, point.value),
          })),
          polylines: [],
          seamMarkers: [],
        });
    }
    return nextTraces;
  }, [effectiveWindowSeconds, plotNowMs, settings.traces, traceFieldOptions]);

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

  const yAxisHeight = Math.max(1e-6, yRange.max - yRange.min);
  const xAxisSpanSeconds = Math.max(MIN_WINDOW_SECONDS, effectiveWindowSeconds);

  const getOffsetInputStep = (kind: "offset" | "xOffsetSeconds"): number => {
    if (kind === "offset") {
      // Arrow nudges track Y-axis scale (about a tenth of visible height).
      return toNiceStep(Math.max(0.001, yAxisHeight / 10));
    }
    // X-offset nudges track visible X window span.
    return toNiceStep(Math.max(0.001, xAxisSpanSeconds / 10));
  };

  const getOffsetScrubStep = (kind: "offset" | "xOffsetSeconds"): number => {
    if (kind === "offset") {
      // Drag scrub defaults to finer control than arrow nudge.
      return toNiceStep(Math.max(0.0001, yAxisHeight / 50));
    }
    return toNiceStep(Math.max(0.0001, xAxisSpanSeconds / 50));
  };

  const plotTraces = useMemo<PlotTrace[]>(() => {
    const xSpan = PLOT_WIDTH - PLOT_PADDING.left - PLOT_PADDING.right;
    const ySpan = PLOT_HEIGHT - PLOT_PADDING.top - PLOT_PADDING.bottom;
    const windowMs = effectiveWindowSeconds * 1000;
    return visibleTraces.map((trace) => {
      const polylines: string[] = [];
      const seamMarkers: number[] = [];
      let segment: string[] = [];
      const xOffsetMs = parseTraceXOffsetMs(trace);
      for (const point of trace.points) {
        const ageMs = plotNowMs - (point.timeMs + xOffsetMs);
        const normalizedX = 1 - ageMs / windowMs;
        const normalizedY = (point.value - yRange.min) / (yRange.max - yRange.min);
        const x = PLOT_PADDING.left + normalizedX * xSpan;
        const y = PLOT_PADDING.top + (1 - normalizedY) * ySpan;
        if (point.breakBefore && segment.length > 0) {
          polylines.push(segment.join(" "));
          segment = [];
        }
        if (point.seamBefore) {
          seamMarkers.push(x);
        }
        segment.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      if (segment.length > 0) {
        polylines.push(segment.join(" "));
      }
      return { ...trace, polylines, seamMarkers };
    });
  }, [effectiveWindowSeconds, plotNowMs, visibleTraces, yRange.max, yRange.min]);

  const emptyMessage = getEmptyMessage(
    projectModels.loading,
    modelOptions,
    settings.traces,
    modelsByPath,
    traceFieldOptions,
    plotTraces
  );

  const getPlotCursorPosition = (
    event: React.MouseEvent<SVGSVGElement>
  ): PlotCursorPosition | null => {
    const preview = previewRef.current;
    if (!preview) return null;
    const rect = preview.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const previewX = event.clientX - rect.left;
    const previewY = event.clientY - rect.top;
    const normalizedSvgX = Math.min(Math.max(previewX / rect.width, 0), 1);
    const normalizedSvgY = Math.min(Math.max(previewY / rect.height, 0), 1);
    const svgX = normalizedSvgX * PLOT_WIDTH;
    const svgY = normalizedSvgY * PLOT_HEIGHT;

    const xSpan = PLOT_WIDTH - PLOT_PADDING.left - PLOT_PADDING.right;
    const ySpan = PLOT_HEIGHT - PLOT_PADDING.top - PLOT_PADDING.bottom;
    const clampedPlotX = Math.min(
      Math.max(svgX, PLOT_PADDING.left),
      PLOT_WIDTH - PLOT_PADDING.right
    );
    const clampedPlotY = Math.min(
      Math.max(svgY, PLOT_PADDING.top),
      PLOT_HEIGHT - PLOT_PADDING.bottom
    );
    const normalizedX = (clampedPlotX - PLOT_PADDING.left) / xSpan;
    const normalizedY = 1 - (clampedPlotY - PLOT_PADDING.top) / ySpan;

    return {
      previewX,
      previewY,
      svgX: clampedPlotX,
      svgY: clampedPlotY,
      timeSec: (normalizedX - 1) * effectiveWindowSeconds,
      value: yRange.min + normalizedY * (yRange.max - yRange.min),
    };
  };

  const handlePlotMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const next = getPlotCursorPosition(event);
    setCursorPosition(next);
  };

  const handlePlotMouseLeave = () => {
    setCursorPosition(null);
  };

  const handlePlotMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const next = getPlotCursorPosition(event);
    if (!next) return;
    setCursorPosition(next);
    setDragStartPosition(next);
  };

  const dragMeasurement =
    dragStartPosition && cursorPosition
      ? {
          start: dragStartPosition,
          end: cursorPosition,
          deltaTimeSec: cursorPosition.timeSec - dragStartPosition.timeSec,
          deltaValue: cursorPosition.value - dragStartPosition.value,
        }
      : null;
  const previewWidthPx = previewRef.current?.clientWidth ?? 0;

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

  const fitYToViewport = () => {
    setSettings((current) => ({
      ...current,
      yMode: "manual",
      yMin: autoYRange.min.toFixed(3),
      yMax: autoYRange.max.toFixed(3),
    }));
  };

  const updateFreeze = (freeze: boolean) => {
    const getTimelineNowMs = (): number => {
      const latestSampleTime = getLatestTraceSampleTimeMs(settingsRef.current.traces);
      return latestSampleTime ?? performance.now();
    };

    if (!freeze && settingsRef.current.freeze) {
      const frozenAt = freezeTimeMsRef.current;
      const now = getTimelineNowMs();
      if (frozenAt !== null) {
        const pausedDurationMs = Math.max(0, now - frozenAt);
        const shiftMs = Math.max(0, pausedDurationMs - RESUME_SEAM_MS);
        if (shiftMs > 0) {
          const nextHistories: Record<string, SamplePoint[]> = {};
          for (const [traceId, series] of Object.entries(historiesRef.current)) {
            nextHistories[traceId] = series.map((point) => ({
              ...point,
              timeMs: point.timeMs + shiftMs,
            }));
          }
          historiesRef.current = nextHistories;
        }
      }
      pauseGapTraceIdsRef.current = new Set(
        settingsRef.current.traces.map((trace) => trace.id)
      );
    }
    freezeTimeMsRef.current = freeze ? getTimelineNowMs() : null;
    updateSettings({ freeze });
  };

  const updateTrace = (traceId: string, partial: Partial<TraceConfig>) => {
    setSettings((current) => ({
      ...current,
      traces: current.traces.map((trace) =>
        trace.id === traceId ? ({ ...trace, ...partial } as TraceConfig) : trace
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

    const startValue = getTraceTransformNumericValue(trace, kind);
    const pixelsPerStep = 6;
    const scrubStep =
      kind === "offset" || kind === "xOffsetSeconds"
        ? getOffsetScrubStep(kind)
        : getScaleTransformStep(startValue);
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

  const addFieldTrace = () => {
    setSettings((current) => {
      let source: FieldTraceConfig | undefined;
      for (let index = current.traces.length - 1; index >= 0; index -= 1) {
        const candidate = current.traces[index];
        if (isFieldTrace(candidate)) {
          source = candidate;
          break;
        }
      }
      const normalized = normalizeTraceSelection(
        source ?? (createDefaultSettings().traces[0] as FieldTraceConfig),
        current.traces.length,
        modelOptionsRef.current,
        modelsByPath
      );
      return {
        ...current,
        traces: [
          ...current.traces,
          createFieldTrace(
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

  const addGeneratorTrace = () => {
    setSettings((current) => ({
      ...current,
      traces: [
        ...current.traces,
        createGeneratorTrace(
          TRACE_COLORS[current.traces.length % TRACE_COLORS.length]
        ),
      ],
    }));
  };

  const syncFieldTraceXOffsetsToFirst = () => {
    setSettings((current) => {
      const fieldTraces = current.traces.filter(isFieldTrace);
      if (fieldTraces.length < 2) return current;

      const reference = fieldTraces[0];
      const referenceSeries = historiesRef.current[reference.id] ?? [];
      const referenceLast = referenceSeries[referenceSeries.length - 1];
      if (!referenceLast || !Number.isFinite(referenceLast.timeMs)) {
        return current;
      }
      const referenceEffectiveMs =
        referenceLast.timeMs + parseTraceXOffsetMs(reference);

      let changed = false;
      const nextTraces = current.traces.map((trace) => {
        if (!isFieldTrace(trace) || trace.id === reference.id) {
          return trace;
        }
        const series = historiesRef.current[trace.id] ?? [];
        const last = series[series.length - 1];
        if (!last || !Number.isFinite(last.timeMs)) {
          return trace;
        }

        const effectiveMs = last.timeMs + parseTraceXOffsetMs(trace);
        const deltaMs = referenceEffectiveMs - effectiveMs;
        const nextSeconds =
          parseTraceTransformValue(trace.xOffsetSeconds, 0) + deltaMs / 1000;
        const next = {
          ...trace,
          xOffsetSeconds: formatTraceTransformValue(nextSeconds),
        };
        if (next.xOffsetSeconds !== trace.xOffsetSeconds) {
          changed = true;
        }
        return next;
      });

      return changed ? { ...current, traces: nextTraces } : current;
    });
  };

  const removeTrace = (traceId: string) => {
    setSettings((current) => {
      const remaining = current.traces.filter((trace) => trace.id !== traceId);
      delete historiesRef.current[traceId];
      pauseGapTraceIdsRef.current.delete(traceId);
      if (remaining.length > 0) return { ...current, traces: remaining };
      const fallback = normalizeTraceSelection(
        createDefaultSettings().traces[0] as FieldTraceConfig,
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
                const selectedModel = isFieldTrace(trace)
                  ? getTraceModel(trace, modelOptions)
                  : null;
                const workloadOptions = isFieldTrace(trace)
                  ? getWorkloadOptions(trace, modelOptions, modelsByPath)
                  : [];
                const fieldOptions = isFieldTrace(trace)
                  ? traceFieldOptions.get(trace.id) ?? []
                  : [];
                const editorLabel = getTraceEditorLabel(trace);
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

                      {isFieldTrace(trace) ? (
                        <>
                          <label className={styles.control}>
                            <span>Model</span>
                            <select
                              value={selectedModel?.modelPath ?? ""}
                              disabled={modelOptions.length === 0}
                              onChange={(event) =>
                                {
                                  const nextModelPath = event.target.value;
                                  const descriptor = projectModels.data.find(
                                    (model) => model.modelPath === nextModelPath
                                  );
                                  updateTrace(trace.id, {
                                    modelId:
                                      typeof descriptor?.data === "object" &&
                                      descriptor?.data &&
                                      "id" in (descriptor.data as Record<string, unknown>)
                                        ? String(
                                            (descriptor.data as Record<string, unknown>).id ??
                                              ""
                                          )
                                        : "",
                                    modelPath: nextModelPath,
                                    workloadId: "",
                                    workloadName: "",
                                    fieldPath: "",
                                  } satisfies Partial<FieldTraceConfig>);
                                }
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
                                {
                                  const selectedWorkloadName = event.target.value;
                                  const workloadId =
                                    Array.isArray(
                                      (
                                        projectModels.data.find(
                                          (model) => model.modelPath === trace.modelPath
                                        )?.data as {
                                          workloads?: Array<Record<string, unknown>>;
                                        }
                                      )?.workloads
                                    )
                                      ? (
                                          (
                                            projectModels.data.find(
                                              (model) =>
                                                model.modelPath === trace.modelPath
                                            )?.data as {
                                              workloads?: Array<Record<string, unknown>>;
                                            }
                                          ).workloads ?? []
                                        ).find(
                                          (workload) =>
                                            String(workload?.name ?? "") ===
                                            selectedWorkloadName
                                        )?.id
                                      : "";
                                  updateTrace(trace.id, {
                                    workloadId:
                                      typeof workloadId === "string" ? workloadId : "",
                                    workloadName: selectedWorkloadName,
                                    fieldPath: "",
                                  } satisfies Partial<FieldTraceConfig>);
                                }
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
                                } satisfies Partial<FieldTraceConfig>)
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
                                } satisfies Partial<FieldTraceConfig>)
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
                        </>
                      ) : (
                        <>
                          <label className={styles.control}>
                            <span>Wave</span>
                            <select
                              value={trace.waveShape}
                              onChange={(event) =>
                                updateTrace(trace.id, {
                                  waveShape: event.target.value as GeneratorWaveShape,
                                } satisfies Partial<GeneratorTraceConfig>)
                              }
                            >
                              <option value="sine">Sine</option>
                              <option value="square">Square</option>
                              <option value="saw">Saw</option>
                            </select>
                          </label>

                          <label className={styles.control}>
                            <span>Frequency (Hz)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.1"
                              value={trace.frequencyHz}
                              onChange={(event) =>
                                updateTrace(trace.id, {
                                  frequencyHz: event.target.value,
                                } satisfies Partial<GeneratorTraceConfig>)
                              }
                            />
                          </label>

                          <div className={styles.sourceSpacer} aria-hidden="true" />
                          <div className={styles.sourceSpacer} aria-hidden="true" />
                        </>
                      )}

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

                      <label className={`${styles.control} ${styles.transformControl}`}>
                        <span className={styles.controlLabelRow}>
                          <span>Offset X (s)</span>
                          <button
                            type="button"
                            className={styles.scrubHotspot}
                            aria-label={`Adjust x offset for ${editorLabel}`}
                            title="Drag to adjust x offset"
                            onMouseDown={(event) =>
                              startTraceTransformScrub(event, trace, "xOffsetSeconds")
                            }
                          >
                            <span className={styles.scrubDot} />
                          </button>
                        </span>
                        <input
                          type="number"
                          step={getOffsetInputStep("xOffsetSeconds")}
                          value={trace.xOffsetSeconds}
                          onChange={(event) =>
                            updateTrace(trace.id, {
                              xOffsetSeconds: event.target.value,
                            })
                          }
                        />
                      </label>

                      <label className={`${styles.control} ${styles.transformControl}`}>
                        <span className={styles.controlLabelRow}>
                          <span>Scale Y</span>
                          <button
                            type="button"
                            className={styles.scrubHotspot}
                            aria-label={`Adjust scale for ${editorLabel}`}
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
                          step={getScaleTransformStep(
                            getTraceTransformNumericValue(trace, "scale")
                          )}
                          value={trace.scale}
                          onChange={(event) =>
                            updateTrace(trace.id, { scale: event.target.value })
                          }
                        />
                      </label>

                      <label className={`${styles.control} ${styles.transformControl}`}>
                        <span className={styles.controlLabelRow}>
                          <span>Offset Y</span>
                          <button
                            type="button"
                            className={styles.scrubHotspot}
                            aria-label={`Adjust offset for ${editorLabel}`}
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
                          step={getOffsetInputStep("offset")}
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
              <button type="button" className={styles.addButton} onClick={addFieldTrace}>
                + Add Field
              </button>
              <button type="button" className={styles.addButton} onClick={addGeneratorTrace}>
                + Add Generator
              </button>
              <button
                type="button"
                className={styles.addButton}
                onClick={syncFieldTraceXOffsetsToFirst}
              >
                Sync All Fields
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.preview} ref={previewRef}>
        {plotTraces.length > 0 ? (
          <>
            <svg
              className={styles.plotSvg}
              viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
              preserveAspectRatio="none"
              aria-label="Telemetry scope preview"
              onMouseMove={handlePlotMouseMove}
              onMouseLeave={handlePlotMouseLeave}
              onMouseDown={handlePlotMouseDown}
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

              {plotTraces.flatMap((trace) =>
                trace.seamMarkers.map((x, index) => (
                  <line
                    key={`${trace.id}-seam-${index}`}
                    x1={x}
                    y1={PLOT_PADDING.top}
                    x2={x}
                    y2={PLOT_HEIGHT - PLOT_PADDING.bottom}
                    stroke={trace.color}
                    strokeWidth="1.4"
                    strokeDasharray="3 6"
                    opacity="0.75"
                  />
                ))
              )}

              {dragMeasurement ? (
                <line
                  x1={dragMeasurement.start.svgX}
                  y1={dragMeasurement.start.svgY}
                  x2={dragMeasurement.end.svgX}
                  y2={dragMeasurement.end.svgY}
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                />
              ) : null}

              {dragMeasurement ? (
                <>
                  <circle
                    cx={dragMeasurement.start.svgX}
                    cy={dragMeasurement.start.svgY}
                    r="4"
                    fill="rgba(255,255,255,0.95)"
                  />
                  <circle
                    cx={dragMeasurement.end.svgX}
                    cy={dragMeasurement.end.svgY}
                    r="4"
                    fill="rgba(255,255,255,0.95)"
                  />
                </>
              ) : null}
            </svg>

            {cursorPosition ? (
              <div
                className={styles.cursorReadout}
                style={{
                  left: `${cursorPosition.previewX + 12}px`,
                  top: `${Math.max(cursorPosition.previewY - 12, 10)}px`,
                  transform:
                    previewWidthPx > 0 && cursorPosition.previewX > previewWidthPx * 0.7
                      ? "translate(-100%, 0)"
                      : "none",
                }}
              >
                {dragMeasurement ? (
                  <>
                    <div>
                      Start {formatCursorTimeSeconds(dragMeasurement.start.timeSec)},{" "}
                      {formatCursorValue(dragMeasurement.start.value)}
                    </div>
                    <div>
                      End {formatCursorTimeSeconds(dragMeasurement.end.timeSec)},{" "}
                      {formatCursorValue(dragMeasurement.end.value)}
                    </div>
                    <div>
                      Δ {formatCursorTimeSeconds(dragMeasurement.deltaTimeSec)},{" "}
                      {formatCursorValue(dragMeasurement.deltaValue)}
                    </div>
                  </>
                ) : (
                  <div>
                    {formatCursorTimeSeconds(cursorPosition.timeSec)},{" "}
                    {formatCursorValue(cursorPosition.value)}
                  </div>
                )}
              </div>
            ) : null}

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
                        {formatTraceValue(trace, trace.latestValue)}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className={styles.viewportControls}>
              <button
                type="button"
                className={`${styles.viewportToggleButton} ${
                  settings.freeze ? styles.viewportToggleButtonActive : ""
                }`}
                aria-pressed={settings.freeze}
                onClick={() => updateFreeze(!settings.freeze)}
              >
                Freeze
              </button>

              <button
                type="button"
                className={styles.clearButton}
                onClick={syncFieldTraceXOffsetsToFirst}
              >
                Sync All
              </button>

              <button
                type="button"
                className={styles.clearButton}
                onClick={fitYToViewport}
              >
                Fit Y
              </button>

              <button type="button" className={styles.clearButton} onClick={clearHistory}>
                Clear
              </button>
            </div>

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
                <span>Sample Rate / Hz</span>
                <input type="text" value={sampleRateLabel} readOnly />
              </label>
              
              <label className={styles.control}>
                <span>Window / sec</span>
                <input
                  type="number"
                  min={MIN_WINDOW_SECONDS}
                  step="0.1"
                  value={settings.windowSeconds}
                  onChange={(event) =>
                    updateSettings({
                      windowSeconds: event.target.value,
                    })
                  }
                />
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
                <span>Min Y</span>
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
                <span>Max Y</span>
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
  if (a.sourceKind !== b.sourceKind) return false;
  return (
    a.id === b.id &&
    a.visible === b.visible &&
    a.color === b.color &&
    a.xOffsetSeconds === b.xOffsetSeconds &&
    a.scale === b.scale &&
    a.offset === b.offset &&
    (isFieldTrace(a) && isFieldTrace(b)
      ? a.modelPath === b.modelPath &&
        a.workloadName === b.workloadName &&
        a.section === b.section &&
        a.fieldPath === b.fieldPath
      : isGeneratorTrace(a) && isGeneratorTrace(b)
        ? a.waveShape === b.waveShape && a.frequencyHz === b.frequencyHz
        : false)
  );
}

function normalizeTraceSelection(
  trace: FieldTraceConfig,
  index: number,
  modelOptions: ModelOption[],
  modelsByPath: ReadonlyMap<string, ITelemetryModel>
): FieldTraceConfig {
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
    xOffsetSeconds: trace.xOffsetSeconds || "0",
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
  const fieldTraces = traces.filter(isFieldTrace);
  const generatorTraces = traces.filter(isGeneratorTrace);
  if (loadingModels && fieldTraces.length > 0) return "Loading telemetry models...";
  if (fieldTraces.length > 0 && modelOptions.length === 0) {
    return "No telemetry models available.";
  }
  if (fieldTraces.some((trace) => !modelsByPath.has(trace.modelPath))) {
    return "Waiting for telemetry schema...";
  }
  if (
    fieldTraces.some((trace) => (traceFieldOptions.get(trace.id) ?? []).length === 0)
  ) {
    return "No compatible scalar fields in the selected scope.";
  }
  if (
    generatorTraces.some(
      (trace) => parseGeneratorFrequencyHz(trace) === null
    )
  ) {
    return "One or more generators has an invalid frequency.";
  }
  if (plotTraces.length === 0) return "No visible traces.";
  return fieldTraces.length > 0
    ? "Waiting for telemetry samples..."
    : "No visible traces.";
}
