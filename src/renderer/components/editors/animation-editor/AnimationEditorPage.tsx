import React from "react";
import {
  ProjectData,
  useLauncherService,
  type WorkloadsRegistryResponse,
} from "../../../data-sources/launcher";
import {
  useTelemetryService,
  useTelemetryStream,
  type ITelemetryField,
} from "../../../data-sources/telemetry";
import { usePanelInstance } from "../../workspaces/PanelInstanceContext";
import {
  buildNamespacedKey,
  createPanelInstanceId,
  getFirstAvailableValue,
  setStorageValue,
} from "../../../services/storage";
import { useProjectContext } from "../../../data-sources/launcher/internal/ProjectContext";
import { buildUrl } from "../../../data-sources/launcher/internal/launcher-interface";
import { normalizedFromClientX } from "./playhead-math";
import {
  applySampleDeltaToBuffer,
  applyOffsetToSampleRangeWithFalloff,
  applySmoothBrushToSamples,
  buildInterpolatedDrawDelta,
  sampleIndexFromTime,
  sampleIndexRangeFromTimes,
  type Point,
} from "./anim-sample-editing";
import { AnimationTimelineViewport } from "./AnimationTimelineViewport";
import { AnimationToolBar } from "./AnimationToolBar";
import { TransportBar } from "./TransportBar";
import { ActiveClipFieldMenu } from "./ActiveClipFieldMenu";
import { AnimSetFieldMenu } from "./AnimSetFieldMenu";
import { listAnimationTools } from "./tools/registry";
import type { AnimationToolId, AnimationToolSettingsContext } from "./tools/types";
import { beginRangeSelectionBehavior } from "./tools/range/range-behavior";
import { handleSmoothBrushPreviewBehavior } from "./tools/smooth/smooth-behavior";
import { handleLaneHoverBehavior, handleLaneSelectBehavior } from "./tools/pencil/pencil-behavior";
import {
  runBeginDrawStrokeBehavior,
  runBeginRangeOffsetBehavior,
} from "./tools/pointer-edit-behaviors";
import { useClipWriteQueue } from "./hooks/useClipWriteQueue";
import { usePlayheadScrubSession } from "./hooks/usePlayheadScrubSession";
import styles from "./AnimationEditorPage.module.css";

type ClipRef = { name: string; animclipPath: string; durationSec?: number; channels?: string[] };
type ClipData = {
  name: string;
  channels: Record<string, Float32Array>;
  durationSec: number;
  sampleCount: number;
  liveSampleRateHz: number;
  clipRevision: string;
  dirty: boolean;
};
type LaneRange = { min: number; max: number };
type AnimToolName = AnimationToolId;
type TimeSelectionRange = { startSec: number; endSec: number };
type CompatibleSourceRef = {
  id: string;
  type: string;
  label: string;
  modelName: string;
  modelPath: string;
  telemetryBaseUrl: string;
  workloadName: string;
};
type AnimTelemetryServiceDescriptor = {
  service_id: string;
  service_type: string;
  display_name: string;
  capabilities?: string[];
};
type AnimTelemetryServicesResponse = {
  services?: AnimTelemetryServiceDescriptor[];
};
type AnimTelemetryAnimsetClip = {
  clip_index: number;
  clip_name: string;
  animclip_path: string;
  channelset_id?: string;
  duration_sec?: number;
  channels?: string[];
};
type AnimTelemetryAnimsetResponse = {
  service_id: string;
  animset_path: string;
  animset_options?: string[];
  channelset_path?: string;
  channelset_id?: string;
  animset_name?: string;
  animset_revision?: number;
  clips?: AnimTelemetryAnimsetClip[];
};
type AnimTelemetryClipIdentity = {
  clip_name?: string;
  animclip_path?: string;
};
type AnimTelemetryClipResponse = {
  service_id: string;
  clip_identity?: AnimTelemetryClipIdentity;
  clip_revision?: string;
  duration_sec?: number;
  dirty?: boolean;
  live_sample_rate_hz?: number;
  sample_count?: number;
  channels?: string[];
};
type PersistedAnimEditorState = {
  selectedSourceId?: string;
  selectedClipPath?: string;
  activeTool?: AnimToolName | null;
  selectedTimeRange?: TimeSelectionRange | null;
  lineSnapStart?: boolean;
  lineSnapEnd?: boolean;
  rangeFalloffSec?: number;
  rangeFalloffCurve?: number;
  smoothFalloffSec?: number;
  smoothFalloffCurve?: number;
  smoothStrength?: number;
  smoothApplyRateHz?: number;
  smoothRangeSec?: number;
  channelVisible?: Record<string, boolean>;
  channelRecordArm?: Record<string, boolean>;
  channelColor?: Record<string, string>;
  selectedChannel?: string | null;
  laneRange?: Record<string, LaneRange>;
  timelineViewportRangeNorm?: { startNorm: number; endNorm: number } | null;
};
type AnimLoadStatusLevel = "ok" | "warning" | "error";
const DEFAULT_ANIMSET = "content/anim/animsets/barr_e_expression_mvp.animset.yaml";
const DEFAULT_CHANNELSET = "content/anim/channelsets/barr_e_expression_mvp.channelset.yaml";
const DEFAULT_EMPTY_CLIP_DURATION_SEC = 1;
const MAX_REASONABLE_AXIS_ABS = 1000;
const ANIM_EDITOR_STORAGE_BASE_KEY = "robotick-studio.anim-editor.state.v1";
const LANE_VIEWBOX_WIDTH = 1000;
const LANE_VIEWBOX_HEIGHT = 40;
const LANE_CURVE_DRAW_HEIGHT = 34;
const DEFAULT_RANGE_SIZE_SEC = 0.45;
const DEFAULT_RANGE_FALLOFF_SEC = 0.12;
const DEFAULT_FALLOFF_CURVE = 1;
const DEFAULT_SMOOTH_FALLOFF_SEC = 0.18;
const DEFAULT_SMOOTH_STRENGTH = 0.65;
const DEFAULT_SMOOTH_APPLY_RATE_HZ = 60;
const DEFAULT_SMOOTH_RANGE_SEC = 0.45;
function parsePersistedAnimEditorState(rawValue: string | null): PersistedAnimEditorState | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as PersistedAnimEditorState;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function sanitizePersistedTimeRange(range: TimeSelectionRange | null | undefined): TimeSelectionRange | null {
  if (!range) return null;
  if (
    typeof range.startSec !== "number" ||
    typeof range.endSec !== "number" ||
    !Number.isFinite(range.startSec) ||
    !Number.isFinite(range.endSec)
  ) {
    return null;
  }
  const startSec = Math.max(0, Math.min(range.startSec, range.endSec));
  const endSec = Math.max(startSec, Math.max(range.startSec, range.endSec));
  return { startSec, endSec };
}

function sanitizePersistedViewportRangeNorm(
  value: { startNorm: number; endNorm: number } | null | undefined
): { startNorm: number; endNorm: number } {
  const fallback = { startNorm: 0, endNorm: 1 };
  if (!value) return fallback;
  if (
    typeof value.startNorm !== "number" ||
    typeof value.endNorm !== "number" ||
    !Number.isFinite(value.startNorm) ||
    !Number.isFinite(value.endNorm)
  ) {
    return fallback;
  }
  const startNorm = Math.min(1, Math.max(0, value.startNorm));
  const endNorm = Math.min(1, Math.max(0, value.endNorm));
  const left = Math.min(startNorm, endNorm);
  const right = Math.max(startNorm, endNorm);
  if (right - left < 0.02) {
    return {
      startNorm: Math.max(0, right - 0.02),
      endNorm: Math.min(1, left + 0.02),
    };
  }
  return { startNorm: left, endNorm: right };
}

function clipRefsFromAnimsetResponse(response: AnimTelemetryAnimsetResponse): ClipRef[] {
  return (response.clips ?? []).map((clip) => ({
    name: clip.clip_name || clip.animclip_path || "clip",
    animclipPath: clip.animclip_path,
    durationSec: typeof clip.duration_sec === "number" ? clip.duration_sec : undefined,
    channels: Array.isArray(clip.channels) ? clip.channels.filter(Boolean) : undefined,
  }));
}

function clipDataFromTelemetryMetadata(payload: AnimTelemetryClipResponse | undefined): ClipData {
  const durationSec =
    typeof payload?.duration_sec === "number" && Number.isFinite(payload.duration_sec)
      ? Math.max(DEFAULT_EMPTY_CLIP_DURATION_SEC, payload.duration_sec)
      : DEFAULT_EMPTY_CLIP_DURATION_SEC;
  const sampleCount =
    typeof payload?.sample_count === "number" && Number.isFinite(payload.sample_count)
      ? Math.max(0, Math.floor(payload.sample_count))
      : 0;
  const name = String(payload?.clip_identity?.clip_name ?? "clip").trim() || "clip";
  const channels: Record<string, Float32Array> = {};
  for (const channelName of payload?.channels ?? []) {
    const parsed = String(channelName ?? "").trim();
    if (!parsed) continue;
    channels[parsed] = new Float32Array(0);
  }
  return {
    name,
    channels,
    durationSec,
    sampleCount,
    liveSampleRateHz:
      typeof payload?.live_sample_rate_hz === "number" && Number.isFinite(payload.live_sample_rate_hz)
        ? payload.live_sample_rate_hz
        : 0,
    clipRevision: typeof payload?.clip_revision === "string" ? payload.clip_revision : "0",
    dirty: Boolean(payload?.dirty),
  };
}

function fitRangeWithPadding(samples: ArrayLike<number>): LaneRange {
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

function defaultLaneRangeForChannel(channel: string, samples: ArrayLike<number>): LaneRange {
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

function normalizeTimeRange(durationSec: number, range: TimeSelectionRange | null) {
  if (!range || durationSec <= 0) return null;
  const startNorm = Math.min(1, Math.max(0, range.startSec / durationSec));
  const endNorm = Math.min(1, Math.max(0, range.endSec / durationSec));
  return {
    startNorm: Math.min(startNorm, endNorm),
    endNorm: Math.max(startNorm, endNorm),
  };
}

function closestSamplePointToClientPoint(
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

function collectAnimCompatibleWorkloadTypes(response: WorkloadsRegistryResponse): Set<string> {
  const out = new Set<string>();
  const typeByName = new Map<string, { fields?: Array<{ name?: string; type?: string }> }>();
  for (const entry of response.types ?? []) {
    if (entry?.name) {
      typeByName.set(String(entry.name), entry);
    }
  }

  for (const workload of response.workloads ?? []) {
    const inputTypeName = workload.inputs?.type;
    const outputTypeName = workload.outputs?.type;
    if (!inputTypeName || !outputTypeName) continue;
    const inputsDef = typeByName.get(inputTypeName);
    const outputsDef = typeByName.get(outputTypeName);
    if (!inputsDef?.fields || !outputsDef?.fields) continue;

    const hasAnimControls = inputsDef.fields.some((f) => {
      const name = String(f?.name ?? "").toLowerCase();
      const type = String(f?.type ?? "");
      return name === "anim_controls" && type === "AnimControls";
    });
    const hasAnimState = outputsDef.fields.some((f) => {
      const name = String(f?.name ?? "").toLowerCase();
      const type = String(f?.type ?? "");
      return name === "anim_state" && type === "AnimState";
    });

    if (hasAnimControls && hasAnimState) {
      out.add(workload.type);
    }
  }
  return out;
}

export default function AnimationEditorPage() {
  const panelInstance = usePanelInstance();
  const fallbackPanelIdRef = React.useRef<string | undefined>(undefined);
  if (!fallbackPanelIdRef.current) {
    fallbackPanelIdRef.current = createPanelInstanceId();
  }
  const panelInstanceId = panelInstance.panelId ?? fallbackPanelIdRef.current;
  const workspaceIdentifier = panelInstance.workspaceId ?? "workspace";
  const panelStorageKey = React.useMemo(
    () => buildNamespacedKey(ANIM_EDITOR_STORAGE_BASE_KEY, workspaceIdentifier, panelInstanceId),
    [panelInstanceId, workspaceIdentifier]
  );
  const initialPersistedState = React.useMemo(() => {
    const { value, key } = getFirstAvailableValue([panelStorageKey, ANIM_EDITOR_STORAGE_BASE_KEY]);
    if (value !== null && key && key !== panelStorageKey) {
      setStorageValue(panelStorageKey, value);
    }
    return parsePersistedAnimEditorState(value);
  }, [panelStorageKey]);
  const launcherService = useLauncherService();
  const telemetryService = useTelemetryService();
  const { projectPath } = useProjectContext();
  const { projectModels } = ProjectData.use();
  const [isPlaying, setIsPlaying] = React.useState(true);
  const [loopEnabled, setLoopEnabled] = React.useState(true);
  const [animCompatibleWorkloadTypes, setAnimCompatibleWorkloadTypes] = React.useState<Set<string>>(new Set());
  const [selectedSourceId, setSelectedSourceId] = React.useState(() => initialPersistedState?.selectedSourceId ?? "");
  const [animsetPath, setAnimsetPath] = React.useState(DEFAULT_ANIMSET);
  const [animsetOptionsFromEngine, setAnimsetOptionsFromEngine] = React.useState<string[]>([]);
  const [channelsetPath, setChannelsetPath] = React.useState(DEFAULT_CHANNELSET);
  const [channelsetId, setChannelsetId] = React.useState("barr_e_expression_mvp");
  const [animLoadStatus, setAnimLoadStatus] = React.useState<{ level: AnimLoadStatusLevel; message: string }>({
    level: "ok",
    message: "OK",
  });
  const [clipRefs, setClipRefs] = React.useState<ClipRef[]>([]);
  const [selectedClipPath, setSelectedClipPath] = React.useState(
    () => initialPersistedState?.selectedClipPath ?? ""
  );
  const [clipData, setClipData] = React.useState<ClipData>({
    name: "clip",
    channels: {},
    durationSec: DEFAULT_EMPTY_CLIP_DURATION_SEC,
    sampleCount: 0,
    liveSampleRateHz: 0,
    clipRevision: "0",
    dirty: false,
  });
  const clipDataRef = React.useRef(clipData);
  const [animTelemetryServiceId, setAnimTelemetryServiceId] = React.useState("");
  const [activeTool, setActiveTool] = React.useState<AnimToolName | null>(
    () => initialPersistedState?.activeTool ?? null
  );
  const [selectedTimeRange, setSelectedTimeRange] = React.useState<TimeSelectionRange | null>(
    () => sanitizePersistedTimeRange(initialPersistedState?.selectedTimeRange)
  );
  const [lineSnapStart, setLineSnapStart] = React.useState(
    () => initialPersistedState?.lineSnapStart ?? true
  );
  const [lineSnapEnd, setLineSnapEnd] = React.useState(
    () => initialPersistedState?.lineSnapEnd ?? true
  );
  const [rangeFalloffSec, setRangeFalloffSec] = React.useState(
    () => initialPersistedState?.rangeFalloffSec ?? DEFAULT_RANGE_FALLOFF_SEC
  );
  const [rangeSizeDraft, setRangeSizeDraft] = React.useState(() => DEFAULT_RANGE_SIZE_SEC.toFixed(3));
  const [rangeFalloffDraft, setRangeFalloffDraft] = React.useState(() => DEFAULT_RANGE_FALLOFF_SEC.toFixed(3));
  const [rangeFalloffCurve, setRangeFalloffCurve] = React.useState(
    () => initialPersistedState?.rangeFalloffCurve ?? DEFAULT_FALLOFF_CURVE
  );
  const [rangeFalloffCurveDraft, setRangeFalloffCurveDraft] = React.useState(() => DEFAULT_FALLOFF_CURVE.toFixed(2));
  const [smoothFalloffSec, setSmoothFalloffSec] = React.useState(
    () => initialPersistedState?.smoothFalloffSec ?? DEFAULT_SMOOTH_FALLOFF_SEC
  );
  const [smoothFalloffDraft, setSmoothFalloffDraft] = React.useState(() => DEFAULT_SMOOTH_FALLOFF_SEC.toFixed(3));
  const [smoothFalloffCurve, setSmoothFalloffCurve] = React.useState(
    () => initialPersistedState?.smoothFalloffCurve ?? DEFAULT_FALLOFF_CURVE
  );
  const [smoothFalloffCurveDraft, setSmoothFalloffCurveDraft] = React.useState(() => DEFAULT_FALLOFF_CURVE.toFixed(2));
  const [smoothStrength, setSmoothStrength] = React.useState(
    () => initialPersistedState?.smoothStrength ?? DEFAULT_SMOOTH_STRENGTH
  );
  const [smoothStrengthDraft, setSmoothStrengthDraft] = React.useState(() => DEFAULT_SMOOTH_STRENGTH.toFixed(2));
  const [smoothApplyRateHz, setSmoothApplyRateHz] = React.useState(
    () => initialPersistedState?.smoothApplyRateHz ?? DEFAULT_SMOOTH_APPLY_RATE_HZ
  );
  const [smoothApplyRateDraft, setSmoothApplyRateDraft] = React.useState(() => DEFAULT_SMOOTH_APPLY_RATE_HZ.toFixed(0));
  const [smoothRangeSec, setSmoothRangeSec] = React.useState(
    () => initialPersistedState?.smoothRangeSec ?? DEFAULT_SMOOTH_RANGE_SEC
  );
  const [smoothRangeDraft, setSmoothRangeDraft] = React.useState(() => DEFAULT_SMOOTH_RANGE_SEC.toFixed(3));
  const animationTools = React.useMemo(() => listAnimationTools(), []);
  const [smoothBrushPreview, setSmoothBrushPreview] = React.useState<{ channel: string; centerSec: number } | null>(null);
  const [channelVisible, setChannelVisible] = React.useState<Record<string, boolean>>(
    () => initialPersistedState?.channelVisible ?? {}
  );
  const [channelColor, setChannelColor] = React.useState<Record<string, string>>(
    () => initialPersistedState?.channelColor ?? {}
  );
  const [hoveredChannel, setHoveredChannel] = React.useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = React.useState<string | null>(
    () => initialPersistedState?.selectedChannel ?? null
  );
  const [recordArmByChannel, setRecordArmByChannel] = React.useState<Record<string, boolean>>(
    () => initialPersistedState?.channelRecordArm ?? {}
  );
  const [laneRange, setLaneRange] = React.useState<Record<string, LaneRange>>(
    () => initialPersistedState?.laneRange ?? {}
  );
  const timelineRef = React.useRef<HTMLDivElement | null>(null);
  const topRulerRef = React.useRef<HTMLDivElement | null>(null);
  const bottomRulerRef = React.useRef<HTMLDivElement | null>(null);
  const playheadViewportRef = React.useRef<HTMLDivElement | null>(null);
  const firstLaneSvgRef = React.useRef<SVGSVGElement | null>(null);
  const [playheadViewportInsetsPx, setPlayheadViewportInsetsPx] = React.useState({ left: 77, right: 14 });
  const [playheadOverlayMetrics, setPlayheadOverlayMetrics] = React.useState({
    width: LANE_VIEWBOX_WIDTH,
    height: 100,
    topRulerHeight: 24,
    bottomRulerTop: 76,
    bottomRulerHeight: 24,
    topBlobCenterY: 18,
    bottomBlobCenterY: 82,
  });
  const [timelineViewportRangeNorm, setTimelineViewportRangeNorm] = React.useState(() =>
    sanitizePersistedViewportRangeNorm(initialPersistedState?.timelineViewportRangeNorm)
  );
  const [localScrubTimeSec, setLocalScrubTimeSec] = React.useState<number | null>(null);
  const [pendingScrubAdoptSec, setPendingScrubAdoptSec] = React.useState<number | null>(null);
  const [pendingActiveClipIndex, setPendingActiveClipIndex] = React.useState<number | null>(null);
  const heldSuppressedAnimControlFieldsRef = React.useRef<Set<string>>(new Set());
  const pendingClipDataRenderRef = React.useRef<ClipData | null>(null);
  const pendingClipDataRafRef = React.useRef<number | null>(null);
  const rangeOffsetStateRef = React.useRef<{
    active: boolean;
    clipIndex: number;
    channel: string;
    mode: "Range" | "Smooth" | null;
    coreRange: { startSampleIndex: number; endSampleIndex: number } | null;
    writeRange: { startSampleIndex: number; endSampleIndex: number } | null;
    baseSamples: Float32Array | null;
    baseDirty: boolean;
    startClientY: number;
    laneHeightPx: number;
    laneValueSpan: number;
    startStrength: number;
  }>({
    active: false,
    clipIndex: -1,
    channel: "",
    mode: null,
    coreRange: null,
    writeRange: null,
    baseSamples: null,
    baseDirty: false,
    startClientY: 0,
    laneHeightPx: 1,
    laneValueSpan: 1,
    startStrength: DEFAULT_SMOOTH_STRENGTH,
  });
  const linePreviewStateRef = React.useRef<{
    active: boolean;
    clipIndex: number;
    channel: string;
    baseSamples: Float32Array | null;
    baseDirty: boolean;
    startPoint: Point | null;
    touchedRange: { startSampleIndex: number; endSampleIndex: number } | null;
  }>({
    active: false,
    clipIndex: -1,
    channel: "",
    baseSamples: null,
    baseDirty: false,
    startPoint: null,
    touchedRange: null,
  });
  React.useEffect(() => {
    clipDataRef.current = clipData;
  }, [clipData]);

  const reportAnimLoadStatus = React.useCallback((level: AnimLoadStatusLevel, message: string) => {
    const rank: Record<AnimLoadStatusLevel, number> = { ok: 0, warning: 1, error: 2 };
    setAnimLoadStatus((prev) => (rank[level] >= rank[prev.level] ? { level, message } : prev));
  }, []);

  const flushPendingClipDataRender = React.useCallback(() => {
    if (pendingClipDataRafRef.current !== null) {
      cancelAnimationFrame(pendingClipDataRafRef.current);
      pendingClipDataRafRef.current = null;
    }
    const pending = pendingClipDataRenderRef.current;
    if (!pending) return;
    pendingClipDataRenderRef.current = null;
    clipDataRef.current = pending;
    setClipData(pending);
  }, []);

  const scheduleClipDataRender = React.useCallback((nextClipData: ClipData) => {
    clipDataRef.current = nextClipData;
    pendingClipDataRenderRef.current = nextClipData;
    if (pendingClipDataRafRef.current !== null) {
      return;
    }
    pendingClipDataRafRef.current = requestAnimationFrame(() => {
      pendingClipDataRafRef.current = null;
      const pending = pendingClipDataRenderRef.current;
      if (!pending) return;
      pendingClipDataRenderRef.current = null;
      clipDataRef.current = pending;
      setClipData(pending);
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function loadRegistry() {
      if (!projectPath) return;
      try {
        const response = await launcherService.fetchProjectWorkloadsRegistry(projectPath, "linux");
        if (cancelled) return;
        setAnimCompatibleWorkloadTypes(collectAnimCompatibleWorkloadTypes(response));
      } catch {
        if (cancelled) return;
        setAnimCompatibleWorkloadTypes(new Set());
      }
    }
    void loadRegistry();
    return () => {
      cancelled = true;
    };
  }, [launcherService, projectPath]);

  const compatibleSources = React.useMemo(() => {
    if (animCompatibleWorkloadTypes.size === 0) {
      return [] as CompatibleSourceRef[];
    }
    const refs: CompatibleSourceRef[] = [];
    projectModels.data.forEach((model) => {
      const modelData =
        model.data && typeof model.data === "object"
          ? (model.data as Record<string, unknown>)
          : null;
      const workloads = Array.isArray(modelData?.workloads) ? modelData.workloads : [];
      workloads.forEach((entry, index) => {
        if (!entry || typeof entry !== "object") return;
        const obj = entry as Record<string, unknown>;
        const type = String((entry as Record<string, unknown>).type ?? "").trim();
        if (!type || !animCompatibleWorkloadTypes.has(type)) return;
        const workloadName = String(obj.name ?? obj.id ?? type).trim();
        const modelName = model.modelName || model.modelPath;
        refs.push({
          id: `${model.modelPath}::${String(obj.id ?? obj.name ?? `${type}#${index}`)}`,
          type,
          label: `${modelName} | ${workloadName}`,
          modelName,
          modelPath: model.modelPath,
          telemetryBaseUrl: model.telemetryBaseUrl ?? "",
          workloadName,
        });
      });
    });
    return refs;
  }, [animCompatibleWorkloadTypes, projectModels.data]);

  React.useEffect(() => {
    if (!compatibleSources.length) {
      setSelectedSourceId("");
      return;
    }
    if (!selectedSourceId || !compatibleSources.some((s) => s.id === selectedSourceId)) {
      setSelectedSourceId(compatibleSources[0].id);
    }
  }, [compatibleSources, selectedSourceId]);

  const selectedSource = React.useMemo(
    () => compatibleSources.find((source) => source.id === selectedSourceId) ?? null,
    [compatibleSources, selectedSourceId]
  );
  const telemetryBaseUrl = selectedSource?.telemetryBaseUrl ?? "";
  const buildAnimServiceUrl = React.useCallback(
    (suffix = "", params?: Record<string, string | number | undefined>) => {
      if (!telemetryBaseUrl || !animTelemetryServiceId) return "";
      return buildUrl(
        telemetryBaseUrl,
        `/api/telemetry/services/${animTelemetryServiceId}${suffix}`,
        params
      );
    },
    [animTelemetryServiceId, telemetryBaseUrl]
  );
  const { model: telemetryModel } = useTelemetryStream(telemetryBaseUrl, 20);
  const selectedTelemetryWorkload = React.useMemo(() => {
    if (!telemetryModel || !selectedSource?.workloadName) return null;
    return (
      telemetryModel.workloads.find((workload) => workload.name === selectedSource.workloadName) ?? null
    );
  }, [selectedSource?.workloadName, telemetryModel]);
  const selectedWorkloadName = selectedTelemetryWorkload?.name ?? "";

  const readFieldValue = React.useCallback(
    (fieldPath: string) => telemetryModel?.getField?.(fieldPath)?.getValue?.(),
    [telemetryModel]
  );

  const resolveWritableField = React.useCallback(
    (fieldPath: string): ITelemetryField | null => {
      const field = telemetryModel?.getField?.(fieldPath);
      if (!field) return null;
      if (typeof field.writable_input_handle !== "number") return null;
      return field;
    },
    [telemetryModel]
  );

  const playbackStateRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.playback_state`)
    : null;
  const playheadTimeRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.playhead_time_sec`)
    : null;
  const isLoopResetActiveRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.is_loop_reset_active`)
    : null;
  const loopResetProgressRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.loop_reset_progress_norm`)
    : null;
  const activeClipIndexRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.active_clip_index`)
    : null;

  const reloadAnimsetClipRefs = React.useCallback(async () => {
    const url = buildAnimServiceUrl("/animset");
    if (!url) return;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load animset: ${response.status}`);
    }
    const payload = (await response.json()) as AnimTelemetryAnimsetResponse;
    const parsed = clipRefsFromAnimsetResponse(payload);
    setClipRefs(parsed);
    if (Array.isArray(payload.animset_options)) {
      setAnimsetOptionsFromEngine(payload.animset_options.filter((v) => typeof v === "string" && v.length > 0));
    }
    if (payload.animset_path) {
      setAnimsetPath(payload.animset_path);
    }
    if (payload.channelset_path) {
      setChannelsetPath(payload.channelset_path);
    }
    if (payload.channelset_id) {
      setChannelsetId(payload.channelset_id);
    }
    setSelectedClipPath((prev) => {
      if (prev && parsed.some((clip) => clip.animclipPath === prev)) {
        return prev;
      }
      if (typeof activeClipIndexRaw === "number") {
        const activeIndex = Math.floor(activeClipIndexRaw);
        if (activeIndex >= 0 && activeIndex < parsed.length) {
          return parsed[activeIndex].animclipPath;
        }
      }
      return parsed.length > 0 ? parsed[0].animclipPath : "";
    });
  }, [activeClipIndexRaw, buildAnimServiceUrl]);

  const applyLoadedClipData = React.useCallback((nextClipData: ClipData) => {
    if (pendingClipDataRafRef.current !== null) {
      cancelAnimationFrame(pendingClipDataRafRef.current);
      pendingClipDataRafRef.current = null;
    }
    pendingClipDataRenderRef.current = null;
    clipDataRef.current = nextClipData;
    setClipData(nextClipData);
    const names = Object.keys(nextClipData.channels);
    setChannelVisible((prev) => {
      const next: Record<string, boolean> = {};
      names.forEach((n) => (next[n] = prev[n] ?? true));
      return next;
    });
    setChannelColor((prev) => {
      const palette = ["#77ceff", "#7ef9a9", "#ffd166", "#ff7b72", "#d9a3ff", "#7afcff", "#fcbf49", "#f07167"];
      const next: Record<string, string> = {};
      names.forEach((n, i) => (next[n] = prev[n] ?? palette[i % palette.length]));
      return next;
    });
    setLaneRange(() => {
      const next: Record<string, LaneRange> = {};
      names.forEach((n) => {
        next[n] = defaultLaneRangeForChannel(n, nextClipData.channels[n] ?? []);
      });
      return next;
    });
    setSelectedChannel((prev) => (prev && names.includes(prev) ? prev : names[0] ?? null));
  }, []);

  const loadLiveClipData = React.useCallback(
    async (clipIndex: number, clipName?: string) => {
      if (!animTelemetryServiceId || clipIndex < 0) return null;
      const clipUrl = buildAnimServiceUrl("/clip", {
        clip_index: clipIndex,
      });
      if (!clipUrl) return null;
      const clipResponse = await fetch(clipUrl, { cache: "no-store" });
      if (!clipResponse.ok) {
        throw new Error(`Failed to load clip metadata: ${clipResponse.status}`);
      }
      const clipPayload = (await clipResponse.json()) as AnimTelemetryClipResponse;
      const metadata = clipDataFromTelemetryMetadata(clipPayload);
      const channelEntries = await Promise.all(
        Object.keys(metadata.channels).map(async (channel) => {
          const channelUrl = buildAnimServiceUrl("/samples", {
            clip_index: clipIndex,
            channel,
          });
          if (!channelUrl) {
            throw new Error("Missing samples URL");
          }
          const response = await fetch(channelUrl, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`Failed to load samples for '${channel}': ${response.status}`);
          }
          const sampleValues = new Float32Array(await response.arrayBuffer());
          return [channel, sampleValues] as const;
        })
      );
      const nextClipData: ClipData = {
        ...metadata,
        name: clipName?.trim() || metadata.name,
        channels: Object.fromEntries(channelEntries),
      };
      applyLoadedClipData(nextClipData);
      return nextClipData;
    },
    [animTelemetryServiceId, applyLoadedClipData, buildAnimServiceUrl]
  );
  const {
    drawWriteStateRef,
    clearDrawFlushTimer,
    beginDrawStrokeSession,
    flushDrawStroke,
    queueDrawStrokeRange,
  } = useClipWriteQueue({
    clipDataRef,
    clipRefs,
    loadLiveClipData,
    buildAnimServiceUrl,
    scheduleClipDataRender,
  });

  React.useEffect(() => {
    setAnimLoadStatus({ level: "ok", message: "OK" });
  }, [selectedSourceId, selectedWorkloadName, animTelemetryServiceId]);

  React.useEffect(() => {
    let cancelled = false;
    async function discoverAnimService() {
      if (!telemetryBaseUrl) {
        setAnimTelemetryServiceId("");
        setClipRefs([]);
        setClipData({
          name: "clip",
          channels: {},
          durationSec: DEFAULT_EMPTY_CLIP_DURATION_SEC,
          sampleCount: 0,
          liveSampleRateHz: 0,
          clipRevision: "0",
          dirty: false,
        });
        return;
      }
      try {
        const response = await fetch(buildUrl(telemetryBaseUrl, "/api/telemetry/services"), {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Failed to load services: ${response.status}`);
        }
        const payload = (await response.json()) as AnimTelemetryServicesResponse;
        if (cancelled) return;
        const services = (payload.services ?? []).filter((service) => service.service_type === "anim");
        const exactDisplay = services.find((service) => service.display_name === selectedWorkloadName);
        const exactServiceId = services.find((service) => service.service_id === `anim:${selectedWorkloadName}`);
        const fallback = services[0];
        setAnimTelemetryServiceId(exactDisplay?.service_id ?? exactServiceId?.service_id ?? fallback?.service_id ?? "");
        if ((exactDisplay?.service_id ?? exactServiceId?.service_id ?? fallback?.service_id ?? "").length === 0) {
          reportAnimLoadStatus("warning", "No anim telemetry service found. Check Terminal logs.");
        }
      } catch {
        if (cancelled) return;
        setAnimTelemetryServiceId("");
        reportAnimLoadStatus("error", "Failed to discover anim telemetry services. Check Terminal logs.");
      }
    }
    void discoverAnimService();
    return () => {
      cancelled = true;
    };
  }, [reportAnimLoadStatus, selectedWorkloadName, telemetryBaseUrl]);

  React.useEffect(() => {
    if (!animTelemetryServiceId) return;
    void reloadAnimsetClipRefs().catch(() => {
      reportAnimLoadStatus("error", "Failed to load Anim Set metadata. Check Terminal logs.");
    });
  }, [animTelemetryServiceId, reloadAnimsetClipRefs, reportAnimLoadStatus]);

  React.useEffect(() => {
    if (!animTelemetryServiceId) return;
    if (clipRefs.length > 0 && selectedClipPath) return;
    const timer = setTimeout(() => {
      void reloadAnimsetClipRefs().catch(() => {
        reportAnimLoadStatus("warning", "Anim Set data not ready yet. Check Terminal logs if this persists.");
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [animTelemetryServiceId, clipRefs.length, reloadAnimsetClipRefs, reportAnimLoadStatus, selectedClipPath]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadSelectedClip() {
      if (!animTelemetryServiceId || !selectedClipPath) return;
      const selectedClip = clipRefs.find((clip) => clip.animclipPath === selectedClipPath) ?? null;
      const clipIndex = selectedClip ? clipRefs.findIndex((clip) => clip.animclipPath === selectedClip.animclipPath) : -1;
      if (clipIndex < 0) return;
      const parsed = await loadLiveClipData(clipIndex, selectedClip?.name);
      if (cancelled) return;
      if (!parsed) return;
    }
    void loadSelectedClip().catch(() => {
      if (cancelled) return;
      reportAnimLoadStatus("error", "Failed to load clip samples. Check Terminal logs.");
    });
    return () => {
      cancelled = true;
    };
  }, [animTelemetryServiceId, clipRefs, loadLiveClipData, reportAnimLoadStatus, selectedClipPath]);

  const setAnimControlConnectionState = React.useCallback(
    async (fieldName: string, enabled: boolean) => {
      if (!telemetryBaseUrl || !telemetryModel?.schemaSessionId || !selectedWorkloadName) return false;
      const fieldPath = `${selectedWorkloadName}.inputs.anim_controls.${fieldName}`;
      const result = await telemetryService.setWorkloadInputConnectionState(telemetryBaseUrl, {
        engine_session_id: telemetryModel.schemaSessionId,
        updates: [{ field_path: fieldPath, enabled }],
      });
      if (!result.ok) {
        console.warn("Anim control connection state update rejected", {
          fieldPath,
          enabled,
          status: result.status,
          body: result.body,
        });
      }
      return result.ok;
    },
    [selectedWorkloadName, telemetryBaseUrl, telemetryModel, telemetryService]
  );

  const writeAnimControlFieldRaw = React.useCallback(
    async (fieldName: string, value: unknown) => {
      if (!telemetryBaseUrl || !telemetryModel?.schemaSessionId || !selectedWorkloadName) return false;
      const fieldPath = `${selectedWorkloadName}.inputs.anim_controls.${fieldName}`;
      const result = await telemetryService.setWorkloadInputFieldsData(telemetryBaseUrl, {
        engine_session_id: telemetryModel.schemaSessionId,
        writes: [{ field_path: fieldPath, value }],
      });
      if (!result.ok) {
        console.warn("Anim control write rejected", {
          fieldPath,
          value,
          status: result.status,
          body: result.body,
        });
      }
      return result.ok;
    },
    [selectedWorkloadName, telemetryBaseUrl, telemetryModel, telemetryService]
  );

  const writeAnimControlField = React.useCallback(
    async (fieldName: string, value: unknown) => {
      if (!telemetryBaseUrl || !telemetryModel?.schemaSessionId || !selectedWorkloadName) return;
      const fieldPath = `${selectedWorkloadName}.inputs.anim_controls.${fieldName}`;
      const field = resolveWritableField(fieldPath);
      if (!field) return;

      const incomingConnectionHandle = field.incoming_connection_handle;
      const incomingConnectionEnabled = field.incoming_connection_enabled !== false;
      if (typeof incomingConnectionHandle === "number" && incomingConnectionEnabled) {
        await telemetryService.setWorkloadInputConnectionState(telemetryBaseUrl, {
          engine_session_id: telemetryModel.schemaSessionId,
          updates: [{ field_handle: field.writable_input_handle, field_path: fieldPath, enabled: false }],
        });
      }

      await telemetryService.setWorkloadInputFieldsData(telemetryBaseUrl, {
        engine_session_id: telemetryModel.schemaSessionId,
        writes: [{ field_handle: field.writable_input_handle, field_path: fieldPath, value }],
      });

      if (typeof incomingConnectionHandle === "number" && incomingConnectionEnabled) {
        await telemetryService.setWorkloadInputConnectionState(telemetryBaseUrl, {
          engine_session_id: telemetryModel.schemaSessionId,
          updates: [{ field_handle: field.writable_input_handle, field_path: fieldPath, enabled: true }],
        });
      }
    },
    [resolveWritableField, selectedWorkloadName, telemetryBaseUrl, telemetryModel, telemetryService]
  );

  const ensureAnimControlSuppressed = React.useCallback(
    async (fieldName: string): Promise<boolean> => {
      if (!telemetryBaseUrl || !telemetryModel?.schemaSessionId || !selectedWorkloadName) return false;
      if (heldSuppressedAnimControlFieldsRef.current.has(fieldName)) return true;
      const fieldPath = `${selectedWorkloadName}.inputs.anim_controls.${fieldName}`;
      const field = resolveWritableField(fieldPath);
      if (!field || typeof field.writable_input_handle !== "number") return false;
      if (typeof field.incoming_connection_handle !== "number") return false;
      const result = await telemetryService.setWorkloadInputConnectionState(telemetryBaseUrl, {
        engine_session_id: telemetryModel.schemaSessionId,
        updates: [{ field_handle: field.writable_input_handle, field_path: fieldPath, enabled: false }],
      });
      if (!result.ok) return false;
      heldSuppressedAnimControlFieldsRef.current.add(fieldName);
      return true;
    },
    [resolveWritableField, selectedWorkloadName, telemetryBaseUrl, telemetryModel, telemetryService]
  );

  const { beginScrubSession, queueScrubTimeOverride, endScrubSession } = usePlayheadScrubSession({
    setAnimControlConnectionState,
    writeAnimControlFieldRaw,
    localScrubTimeSec,
    setPendingScrubAdoptSec,
    setLocalScrubTimeSec,
    heldSuppressedAnimControlFieldsRef,
  });

  React.useEffect(
    () => () => {
      if (pendingClipDataRafRef.current !== null) {
        cancelAnimationFrame(pendingClipDataRafRef.current);
        pendingClipDataRafRef.current = null;
      }
      clearDrawFlushTimer();
    },
    [clearDrawFlushTimer]
  );

  React.useEffect(() => {
    if (!selectedWorkloadName) return;
    const runtimeAnimsetPath = readFieldValue(`${selectedWorkloadName}.inputs.animset_path`);
    if (typeof runtimeAnimsetPath === "string" && runtimeAnimsetPath.length > 0) {
      setAnimsetPath(runtimeAnimsetPath);
    }
    const runtimeChannelsetPath = readFieldValue(`${selectedWorkloadName}.config.channelset_path`);
    if (typeof runtimeChannelsetPath === "string" && runtimeChannelsetPath.length > 0) {
      setChannelsetPath(runtimeChannelsetPath);
    }
  }, [readFieldValue, selectedWorkloadName]);

  const channelNames = Object.keys(clipData.channels);
  const visibleChannels = channelNames.filter((n) => channelVisible[n] !== false);
  const allChannelsVisible = channelNames.length > 0 && visibleChannels.length === channelNames.length;
  const armedChannels = channelNames.filter((n) => recordArmByChannel[n] === true);
  const allChannelsArmed = channelNames.length > 0 && armedChannels.length === channelNames.length;
  const hasClipSamples = React.useMemo(
    () => Object.values(clipData.channels).some((samples) => (samples?.length ?? 0) > 0),
    [clipData.channels]
  );
  const durationSec = Math.max(DEFAULT_EMPTY_CLIP_DURATION_SEC, clipData.durationSec);
  const runtimePlayheadSec = typeof playheadTimeRaw === "number" ? Math.max(0, playheadTimeRaw) : null;
  const playheadSec = localScrubTimeSec ?? runtimePlayheadSec ?? 0;
  const playbackState = typeof playbackStateRaw === "number" ? playbackStateRaw : null;
  const isLoopResetActive = Boolean(isLoopResetActiveRaw);
  const loopResetProgressNorm =
    typeof loopResetProgressRaw === "number"
      ? Math.min(1, Math.max(0, loopResetProgressRaw))
      : 0;
  const loopResetSlugRangeNorm = (() => {
    if (!isLoopResetActive) return { left: 1, right: 1 };
    if (loopResetProgressNorm <= 0.5) {
      const widthNorm = loopResetProgressNorm / 0.5;
      return { left: 1 - widthNorm, right: 1 };
    }
    const collapse = (loopResetProgressNorm - 0.5) / 0.5;
    return { left: 0, right: 1 - collapse };
  })();
  const normalizedSelectedTimeRange = React.useMemo(
    () => normalizeTimeRange(durationSec, selectedTimeRange),
    [durationSec, selectedTimeRange]
  );
  const activeSelectionFalloffSec = rangeFalloffSec;
  const normalizedSelectionFalloff = React.useMemo(
    () => (durationSec > 0 ? Math.min(1, Math.max(0, activeSelectionFalloffSec / durationSec)) : 0),
    [activeSelectionFalloffSec, durationSec]
  );
  const rulerMarks = React.useMemo(
    () => [0, 0.2, 0.4, 0.6, 0.8, 1].map((norm) => ({ norm, label: `${(durationSec * norm).toFixed(1)}s` })),
    [durationSec]
  );
  const animsetOptions = React.useMemo(
    () => {
      const ordered = [...animsetOptionsFromEngine];
      if (animsetPath && !ordered.includes(animsetPath)) {
        ordered.push(animsetPath);
      }
      if (DEFAULT_ANIMSET && !ordered.includes(DEFAULT_ANIMSET)) {
        ordered.push(DEFAULT_ANIMSET);
      }
      return ordered;
    },
    [animsetOptionsFromEngine, animsetPath]
  );
  const overlayWidth = playheadOverlayMetrics.width;
  const rangeFalloffStepSec = React.useMemo(
    () => Math.min(0.1, Math.max(0.005, durationSec * 0.005)),
    [durationSec]
  );
  const smoothRangeStepSec = React.useMemo(
    () => Math.min(0.08, Math.max(0.0025, durationSec * 0.0025)),
    [durationSec]
  );
  const playheadSampleStepSec = React.useMemo(
    () =>
      clipData.liveSampleRateHz > 0
        ? Math.max(0.001, 1 / clipData.liveSampleRateHz)
        : 0.01,
    [clipData.liveSampleRateHz]
  );
  const rangeSizeSec = React.useMemo(
    () =>
      selectedTimeRange
        ? Math.max(0.01, Math.abs(selectedTimeRange.endSec - selectedTimeRange.startSec))
        : DEFAULT_RANGE_SIZE_SEC,
    [selectedTimeRange]
  );

  const setSelectedTimeRangeDurationSec = React.useCallback(
    (nextDurationSec: number) => {
      if (!(durationSec > 0)) return;
      const clampedDuration = Math.min(durationSec, Math.max(0.01, nextDurationSec));
      setSelectedTimeRange((current) => {
        const centerSec = current ? (current.startSec + current.endSec) * 0.5 : Math.min(durationSec, Math.max(0, playheadSec));
        let startSec = centerSec - clampedDuration * 0.5;
        let endSec = centerSec + clampedDuration * 0.5;
        if (startSec < 0) {
          endSec = Math.min(durationSec, endSec - startSec);
          startSec = 0;
        }
        if (endSec > durationSec) {
          const overshoot = endSec - durationSec;
          startSec = Math.max(0, startSec - overshoot);
          endSec = durationSec;
        }
        return { startSec, endSec };
      });
    },
    [durationSec, playheadSec]
  );

  const seekPlayheadToTimeSec = React.useCallback(
    (nextTimeSec: number) => {
      const clamped = Math.min(durationSec, Math.max(0, nextTimeSec));
      setLocalScrubTimeSec(clamped);
      setPendingScrubAdoptSec(clamped);
      void writeAnimControlField("time_override_sec", clamped);
    },
    [durationSec, writeAnimControlField]
  );

  React.useEffect(() => {
    if (pendingScrubAdoptSec === null || runtimePlayheadSec === null) return;
    const adoptToleranceSec = Math.max(0.0005, Math.min(0.005, playheadSampleStepSec * 0.25));
    if (Math.abs(runtimePlayheadSec - pendingScrubAdoptSec) <= adoptToleranceSec) {
      setPendingScrubAdoptSec(null);
      setLocalScrubTimeSec(null);
    }
  }, [pendingScrubAdoptSec, playheadSampleStepSec, runtimePlayheadSec]);

  React.useEffect(() => {
    if (playbackState === null) return;
    setIsPlaying(playbackState === 2 || playbackState === 3);
  }, [playbackState]);

  React.useEffect(() => {
    setRangeSizeDraft(rangeSizeSec.toFixed(3));
  }, [rangeSizeSec]);

  React.useEffect(() => {
    setRangeFalloffDraft(rangeFalloffSec.toFixed(3));
  }, [rangeFalloffSec]);

  React.useEffect(() => {
    setRangeFalloffCurveDraft(rangeFalloffCurve.toFixed(2));
  }, [rangeFalloffCurve]);

  React.useEffect(() => {
    setSmoothFalloffDraft(smoothFalloffSec.toFixed(3));
  }, [smoothFalloffSec]);

  React.useEffect(() => {
    setSmoothFalloffCurveDraft(smoothFalloffCurve.toFixed(2));
  }, [smoothFalloffCurve]);

  React.useEffect(() => {
    setSmoothStrengthDraft(smoothStrength.toFixed(2));
  }, [smoothStrength]);

  React.useEffect(() => {
    setSmoothApplyRateDraft(smoothApplyRateHz.toFixed(0));
  }, [smoothApplyRateHz]);

  React.useEffect(() => {
    setSmoothRangeDraft(smoothRangeSec.toFixed(3));
  }, [smoothRangeSec]);

  React.useEffect(() => {
    if (!selectedWorkloadName) return;
    const loopValue = readFieldValue(`${selectedWorkloadName}.inputs.anim_controls.loop`);
    if (typeof loopValue === "boolean") {
      setLoopEnabled(loopValue);
    }
  }, [readFieldValue, selectedWorkloadName]);

  React.useEffect(() => {
    if (activeTool === "Smooth") return;
    setSmoothBrushPreview(null);
  }, [activeTool]);

  const applyActiveClipPath = React.useCallback(
    (nextPath: string) => {
      setSelectedClipPath(nextPath);
      const selectedIndex = clipRefs.findIndex((clip) => clip.animclipPath === nextPath);
      if (selectedIndex >= 0) {
        setPendingActiveClipIndex(selectedIndex);
        setTimeout(() => {
          setPendingActiveClipIndex((current) => (current === selectedIndex ? null : current));
        }, 1200);
        void (async () => {
          await ensureAnimControlSuppressed("active_clip_index");
          await writeAnimControlFieldRaw("active_clip_index", selectedIndex);
        })();
      }
    },
    [clipRefs, ensureAnimControlSuppressed, writeAnimControlFieldRaw]
  );

  const applyAnimsetPath = React.useCallback(
    (nextPath: string) => {
      if (!nextPath) return;
      setAnimsetPath(nextPath);
      if (!telemetryBaseUrl || !telemetryModel?.schemaSessionId || !selectedWorkloadName) return;
      const fieldPath = `${selectedWorkloadName}.inputs.animset_path`;
      const field = resolveWritableField(fieldPath);
      if (!field || typeof field.writable_input_handle !== "number") return;
      void telemetryService.setWorkloadInputFieldsData(telemetryBaseUrl, {
        engine_session_id: telemetryModel.schemaSessionId,
        writes: [{ field_handle: field.writable_input_handle, field_path: fieldPath, value: nextPath }],
      });
    },
    [resolveWritableField, selectedWorkloadName, telemetryBaseUrl, telemetryModel, telemetryService]
  );

  const persistStateTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (persistStateTimeoutRef.current !== null) {
        clearTimeout(persistStateTimeoutRef.current);
        persistStateTimeoutRef.current = null;
      }
    },
    []
  );
  React.useEffect(() => {
    const persisted: PersistedAnimEditorState = {
      selectedSourceId,
      selectedClipPath,
      activeTool,
      selectedTimeRange,
      lineSnapStart,
      lineSnapEnd,
      rangeFalloffSec,
      rangeFalloffCurve,
      smoothFalloffSec,
      smoothFalloffCurve,
      smoothStrength,
      smoothApplyRateHz,
      smoothRangeSec,
      channelVisible,
      channelRecordArm: recordArmByChannel,
      channelColor,
      selectedChannel,
      laneRange,
      timelineViewportRangeNorm,
    };
    if (persistStateTimeoutRef.current !== null) {
      clearTimeout(persistStateTimeoutRef.current);
    }
    persistStateTimeoutRef.current = setTimeout(() => {
      persistStateTimeoutRef.current = null;
      setStorageValue(panelStorageKey, JSON.stringify(persisted));
    }, 120);
  }, [
    activeTool,
    channelColor,
    channelVisible,
    laneRange,
    lineSnapEnd,
    lineSnapStart,
    panelStorageKey,
    rangeFalloffCurve,
    rangeFalloffSec,
    recordArmByChannel,
    selectedChannel,
    selectedClipPath,
    selectedSourceId,
    selectedTimeRange,
    smoothFalloffCurve,
    smoothFalloffSec,
    smoothApplyRateHz,
    smoothRangeSec,
    smoothStrength,
    timelineViewportRangeNorm,
  ]);


  React.useEffect(() => {
    if (!selectedWorkloadName || clipRefs.length === 0) return;
    if (typeof activeClipIndexRaw !== "number") return;
    const idx = Math.floor(activeClipIndexRaw);
    if (pendingActiveClipIndex !== null) {
      if (idx === pendingActiveClipIndex) {
        setPendingActiveClipIndex(null);
      } else {
        return;
      }
    }
    if (idx < 0 || idx >= clipRefs.length) return;
    const matched = clipRefs[idx];
    if (matched.animclipPath !== selectedClipPath) {
      setSelectedClipPath(matched.animclipPath);
    }
  }, [activeClipIndexRaw, clipRefs, pendingActiveClipIndex, selectedClipPath, selectedWorkloadName]);

  React.useLayoutEffect(() => {
    const timeline = timelineRef.current;
    const viewport = playheadViewportRef.current;
    const topRuler = topRulerRef.current;
    const bottomRuler = bottomRulerRef.current;
    if (!timeline || !viewport) return;

    const measure = () => {
      const timelineRect = timeline.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      // During layout transitions/HMR, transient tiny measurements can occur and
      // cause the SVG viewBox to collapse, which blows up ruler text rendering.
      if (timelineRect.height < 80 || viewportRect.width < 80 || viewportRect.height < 80) {
        return;
      }
      const laneSvg = firstLaneSvgRef.current;
      if (laneSvg) {
        const laneRect = laneSvg.getBoundingClientRect();
        if (laneRect.width >= 40) {
          const left = Math.max(0, laneRect.left - timelineRect.left);
          const right = Math.max(0, timelineRect.right - laneRect.right);
          setPlayheadViewportInsetsPx({ left, right });
        }
      }
      const overlayWidth = Math.max(1, viewportRect.width);
      const overlayHeight = Math.max(1, viewportRect.height);
      const topRulerRect = topRuler?.getBoundingClientRect();
      const bottomRulerRect = bottomRuler?.getBoundingClientRect();
      const topRulerHeight = Math.max(1, topRulerRect?.height ?? 24);
      const bottomRulerTop = Math.max(0, bottomRulerRect ? bottomRulerRect.top - viewportRect.top : overlayHeight - 24);
      const bottomRulerHeight = Math.max(1, bottomRulerRect?.height ?? 24);
      const topBlobCenterY = topRulerRect ? Math.max(6, topRulerRect.height - 8) : 18;
      const bottomBlobCenterY = bottomRulerRect
        ? Math.max(6, bottomRulerRect.top - viewportRect.top + 8)
        : Math.max(12, overlayHeight - 18);
      setPlayheadOverlayMetrics({
        width: overlayWidth,
        height: overlayHeight,
        topRulerHeight,
        bottomRulerTop,
        bottomRulerHeight,
        topBlobCenterY,
        bottomBlobCenterY,
      });
    };

    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(timeline);
    observer.observe(viewport);
    if (topRuler) observer.observe(topRuler);
    if (bottomRuler) observer.observe(bottomRuler);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [visibleChannels.join("|"), channelNames.join("|")]);

  function seekFromClientX(clientX: number): number | undefined {
    const element = playheadViewportRef.current;
    if (!element) return undefined;
    const rect = element.getBoundingClientRect();
    const ratio = normalizedFromClientX(clientX, rect.left, rect.width);
    setLocalScrubTimeSec(ratio * durationSec);
    return ratio;
  }

  const beginPlayheadDragFromClientX = React.useCallback(
    (clientX: number) => {
      const startRatio = seekFromClientX(clientX);
      void beginScrubSession();
      const startTimeSec =
        (startRatio ??
          (durationSec > 0
            ? Math.min(1, Math.max(0, playheadSec / durationSec))
            : 0)) * durationSec;
      queueScrubTimeOverride(startTimeSec);
      const onMove = (moveEvent: PointerEvent) => {
        const ratio = seekFromClientX(moveEvent.clientX);
        if (ratio === undefined) return;
        queueScrubTimeOverride(ratio * durationSec);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        void endScrubSession();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [beginScrubSession, durationSec, endScrubSession, playheadSec, queueScrubTimeOverride]
  );

  function beginPlayheadDrag(event: React.PointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    beginPlayheadDragFromClientX(event.clientX);
  }

  const beginRangeSelection = React.useCallback(
    (event: React.PointerEvent<Element>) => {
      beginRangeSelectionBehavior({
        activeTool,
        durationSec,
        viewportElement: playheadViewportRef.current,
        event,
        mutations: {
          setSelectedTimeRange,
        },
      });
    },
    [activeTool, durationSec]
  );

  const pointerToDrawPoint = React.useCallback(
    (svg: SVGSVGElement, clientX: number, clientY: number, minV: number, maxV: number): Point | null => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const xNorm = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const viewboxY = ((clientY - rect.top) / rect.height) * LANE_VIEWBOX_HEIGHT;
      const clampedCurveY = Math.min(LANE_CURVE_DRAW_HEIGHT, Math.max(0, viewboxY));
      const yNorm = clampedCurveY / LANE_CURVE_DRAW_HEIGHT;
      const span = Math.max(1e-6, maxV - minV);
      return {
        t: xNorm * durationSec,
        v: maxV - yNorm * span,
      };
    },
    [durationSec]
  );

  const beginRangeOffset = React.useCallback(
    (
      event: React.PointerEvent<SVGCircleElement>,
      channel: string,
      channelSamples: Float32Array,
      minV: number,
      maxV: number
    ) => {
      runBeginRangeOffsetBehavior({
        event,
        activeTool,
        channel,
        channelSamples,
        minV,
        maxV,
        selectedTimeRange,
        clipRefs,
        selectedClipPath,
        durationSec,
        rangeFalloffSec,
        rangeFalloffCurve,
        defaultSmoothStrength: DEFAULT_SMOOTH_STRENGTH,
        clipDataRef,
        rangeOffsetStateRef,
        drawWriteStateRef,
        beginDrawStrokeSession,
        scheduleClipDataRender,
        queueDrawStrokeRange,
        clearDrawFlushTimer,
        flushPendingClipDataRender,
        flushDrawStroke,
      });
    },
    [
      activeTool,
      beginDrawStrokeSession,
      clearDrawFlushTimer,
      clipRefs,
      durationSec,
      flushDrawStroke,
      flushPendingClipDataRender,
      queueDrawStrokeRange,
      rangeFalloffCurve,
      scheduleClipDataRender,
      selectedClipPath,
      rangeFalloffSec,
      selectedTimeRange,
    ]
  );

  const beginDrawStroke = React.useCallback(
    (
      event: React.PointerEvent<SVGSVGElement>,
      channel: string,
      channelSamples: Float32Array,
      minV: number,
      maxV: number
    ) => {
      runBeginDrawStrokeBehavior({
        event,
        activeTool,
        channel,
        channelSamples,
        minV,
        maxV,
        clipRefs,
        selectedClipPath,
        durationSec,
        lineSnapStart,
        lineSnapEnd,
        smoothRangeSec,
        smoothStrength,
        smoothApplyRateHz,
        smoothFalloffSec,
        smoothFalloffCurve,
        defaultSmoothStrength: DEFAULT_SMOOTH_STRENGTH,
        clipDataRef,
        linePreviewStateRef,
        drawWriteStateRef,
        beginDrawStrokeSession,
        scheduleClipDataRender,
        queueDrawStrokeRange,
        clearDrawFlushTimer,
        flushPendingClipDataRender,
        flushDrawStroke,
        setSelectedChannel,
        setSmoothBrushPreview,
        pointerToDrawPoint,
        closestSamplePointToClientPoint,
      });
    },
    [
      activeTool,
      beginDrawStrokeSession,
      clearDrawFlushTimer,
      clipRefs,
      flushDrawStroke,
      durationSec,
      flushPendingClipDataRender,
      pointerToDrawPoint,
      queueDrawStrokeRange,
      scheduleClipDataRender,
      selectedClipPath,
      lineSnapEnd,
      lineSnapStart,
      smoothFalloffSec,
      smoothFalloffCurve,
      smoothRangeSec,
      smoothStrength,
      smoothApplyRateHz,
    ]
  );

  const setLaneRangeForChannel = React.useCallback((channel: string, nextRange: LaneRange) => {
    setLaneRange((prev) => ({ ...prev, [channel]: nextRange }));
  }, []);

  const fitLaneRangeForChannel = React.useCallback(
    (channel: string) => {
      const samples = clipDataRef.current.channels[channel] ?? new Float32Array(0);
      setLaneRange((prev) => ({ ...prev, [channel]: defaultLaneRangeForChannel(channel, samples) }));
    },
    []
  );

  const handleLaneHoverChange = React.useCallback((channel: string, hovered: boolean) => {
    handleLaneHoverBehavior(channel, hovered, {
      setHoveredChannel,
    });
  }, []);

  const handleLaneSelect = React.useCallback((channel: string) => {
    handleLaneSelectBehavior(channel, {
      setSelectedChannel,
    });
  }, []);

  const handleSmoothBrushPreviewChange = React.useCallback(
    (channel: string, timeSec: number | null) => {
      handleSmoothBrushPreviewBehavior({
        activeTool,
        channel,
        timeSec,
        durationSec,
        mutations: {
          setSmoothBrushPreview,
        },
      });
    },
    [activeTool, durationSec]
  );
  const toolSettingsContext: AnimationToolSettingsContext = {
    durationSec,
    lineSnapStart,
    lineSnapEnd,
    setLineSnapStart,
    setLineSnapEnd,
    rangeSizeSec,
    rangeSizeDraft,
    setRangeSizeDraft,
    setSelectedTimeRangeDurationSec,
    rangeFalloffSec,
    rangeFalloffDraft,
    setRangeFalloffDraft,
    setRangeFalloffSec,
    rangeFalloffCurve,
    rangeFalloffCurveDraft,
    setRangeFalloffCurveDraft,
    setRangeFalloffCurve,
    smoothRangeSec,
    smoothRangeDraft,
    setSmoothRangeDraft,
    setSmoothRangeSec,
    smoothFalloffSec,
    smoothFalloffDraft,
    setSmoothFalloffDraft,
    setSmoothFalloffSec,
    smoothFalloffCurve,
    smoothFalloffCurveDraft,
    setSmoothFalloffCurveDraft,
    setSmoothFalloffCurve,
    smoothStrength,
    smoothStrengthDraft,
    setSmoothStrengthDraft,
    setSmoothStrength,
    smoothApplyRateHz,
    smoothApplyRateDraft,
    setSmoothApplyRateDraft,
    setSmoothApplyRateHz,
    smoothRangeStepSec,
    rangeFalloffStepSec,
  };

  return (
    <div className={styles.root} data-testid="animation-editor-panel">
      <div className={styles.mainGrid}>
        <aside className={styles.animationInspector}>
          <section className={styles.panelCard}>
            <div className={styles.toolButtons}>
              <button className={styles.toolButton} type="button" title="Auto-save is not implemented yet." disabled>
                Auto-save
              </button>
              <button className={styles.toolButton} type="button" title="Save is not implemented yet." disabled>
                Save
              </button>
            </div>
            <div className={styles.sectionHeaderRow}>
              <h3>Target</h3>
              <span
                className={[
                  styles.animStatusLed,
                  animLoadStatus.level === "ok"
                    ? styles.animStatusLedOk
                    : animLoadStatus.level === "warning"
                      ? styles.animStatusLedWarning
                      : styles.animStatusLedError,
                ].join(" ")}
                title={`Anim Status: ${animLoadStatus.message}`}
                aria-label={`Anim status ${animLoadStatus.level}`}
              />
            </div>
            <select
              value={selectedSourceId}
              onChange={(e) => setSelectedSourceId(e.target.value)}
              className={styles.selectControl}
            >
              {compatibleSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
            <h3>Channel Set</h3>
            <div
              className={`${styles.assetNameField} ${styles.assetNameFieldReadOnly}`}
              title={`Read-only: channel set is workload config-defined (${channelsetId || "unknown"})`}
              aria-readonly="true"
            >
              {`${channelsetPath.split("/").pop() || channelsetPath} (read-only)`}
            </div>
            <h3>Anim Set</h3>
            <AnimSetFieldMenu
              animsetOptions={animsetOptions}
              animsetPath={animsetPath}
              onSelectAnimsetPath={applyAnimsetPath}
            />
            <h3>Active Clip</h3>
            <ActiveClipFieldMenu
              clipRefs={clipRefs.map((clip) => ({ name: clip.name, animclipPath: clip.animclipPath }))}
              selectedClipPath={selectedClipPath}
              onReload={() => void reloadAnimsetClipRefs()}
              onSelectClipPath={applyActiveClipPath}
            />
          </section>
          <section className={styles.panelCard}>
            <div className={styles.channelsHeader}>
              <h3>Channels</h3>
              <button
                className={`${styles.recordArmToggle} ${allChannelsArmed ? styles.recordArmToggleActive : ""}`}
                type="button"
                title={allChannelsArmed ? "Disarm all channels (stub)." : "Arm all channels (stub)."}
                aria-label={allChannelsArmed ? "Disarm all channels" : "Arm all channels"}
                onClick={() =>
                  setRecordArmByChannel((prev) => {
                    const next: Record<string, boolean> = { ...prev };
                    for (const name of channelNames) {
                      next[name] = !allChannelsArmed;
                    }
                    return next;
                  })
                }
              >
                ●
              </button>
              <button
                className={`${styles.eyeToggle} ${allChannelsVisible ? styles.eyeToggleActive : ""}`}
                type="button"
                title={allChannelsVisible ? "Hide all channels" : "Show all channels"}
                aria-label={allChannelsVisible ? "Hide all channels" : "Show all channels"}
                onClick={() =>
                  setChannelVisible((prev) => {
                    const next: Record<string, boolean> = { ...prev };
                    for (const name of channelNames) {
                      next[name] = !allChannelsVisible;
                    }
                    return next;
                  })
                }
              >
                👁
              </button>
            </div>
            <ul className={styles.list}>
              {channelNames.map((channel) => (
                <li
                  key={channel}
                  className={[
                    styles.channelKeyRow,
                    hoveredChannel === channel ? styles.channelKeyRowHovered : "",
                    selectedChannel === channel ? styles.channelKeyRowSelected : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setHoveredChannel(channel)}
                  onMouseLeave={() => setHoveredChannel((prev) => (prev === channel ? null : prev))}
                  onClick={() => setSelectedChannel(channel)}
                >
                  <input
                    type="color"
                    value={channelColor[channel] ?? "#77ceff"}
                    onChange={(e) => setChannelColor((p) => ({ ...p, [channel]: e.target.value }))}
                    title="Set channel color"
                  />
                  <span className={styles.channelLabel} title={channel}>{channel}</span>
                  <button
                    className={`${styles.recordArmToggle} ${recordArmByChannel[channel] ? styles.recordArmToggleActive : ""}`}
                    type="button"
                    title={recordArmByChannel[channel] ? "Disarm recording for this channel (stub)." : "Arm recording for this channel (stub)."}
                    aria-label={recordArmByChannel[channel] ? "Disarm recording for this channel" : "Arm recording for this channel"}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRecordArmByChannel((prev) => ({ ...prev, [channel]: !prev[channel] }));
                    }}
                  >
                    ●
                  </button>
                  <button
                    className={`${styles.eyeToggle} ${channelVisible[channel] !== false ? styles.eyeToggleActive : ""}`}
                    type="button"
                    title={channelVisible[channel] !== false ? "Hide channel" : "Show channel"}
                    aria-label={channelVisible[channel] !== false ? "Hide channel" : "Show channel"}
                    onClick={(event) =>
                      setChannelVisible((p) => {
                        if (event.shiftKey) {
                          const currentlyVisible = channelNames.filter((name) => p[name] !== false);
                          const isSolo = currentlyVisible.length === 1 && currentlyVisible[0] === channel;
                          if (isSolo) {
                            const showAll: Record<string, boolean> = { ...p };
                            for (const name of channelNames) {
                              showAll[name] = true;
                            }
                            return showAll;
                          }
                          const solo: Record<string, boolean> = { ...p };
                          for (const name of channelNames) {
                            solo[name] = name === channel;
                          }
                          return solo;
                        }
                        return {
                          ...p,
                          [channel]: p[channel] === false,
                        };
                      })
                    }
                  >
                    👁
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <AnimationTimelineViewport
          timelineRef={timelineRef}
          topRulerRef={topRulerRef}
          bottomRulerRef={bottomRulerRef}
          playheadViewportRef={playheadViewportRef}
          firstLaneSvgRef={firstLaneSvgRef}
          visibleChannels={visibleChannels}
          clipDataChannels={clipData.channels}
          durationSec={durationSec}
          laneRange={laneRange}
          defaultLaneRangeForChannel={defaultLaneRangeForChannel}
          channelColor={channelColor}
          hoveredChannel={hoveredChannel}
          selectedChannel={selectedChannel}
          activeTool={activeTool}
          selectedTimeRange={selectedTimeRange}
          rangeFalloffSec={rangeFalloffSec}
          smoothBrushPreview={smoothBrushPreview}
          smoothRangeSec={smoothRangeSec}
          smoothFalloffSec={smoothFalloffSec}
          handleLaneHoverChange={handleLaneHoverChange}
          handleLaneSelect={handleLaneSelect}
          setLaneRangeForChannel={setLaneRangeForChannel}
          fitLaneRangeForChannel={fitLaneRangeForChannel}
          beginDrawStroke={beginDrawStroke}
          beginRangeOffset={beginRangeOffset}
          handleSmoothBrushPreviewChange={handleSmoothBrushPreviewChange}
          playheadViewportInsetsPx={playheadViewportInsetsPx}
          overlayWidth={overlayWidth}
          playheadOverlayMetrics={playheadOverlayMetrics}
          beginRangeSelection={beginRangeSelection}
          normalizedSelectedTimeRange={normalizedSelectedTimeRange}
          normalizedSelectionFalloff={normalizedSelectionFalloff}
          isLoopResetActive={isLoopResetActive}
          loopResetSlugRangeNorm={loopResetSlugRangeNorm}
          rulerMarks={rulerMarks}
          playheadTimeSec={playheadSec}
          beginPlayheadDragFromClientX={beginPlayheadDragFromClientX}
          viewportRangeNorm={timelineViewportRangeNorm}
          onViewportRangeNormChange={setTimelineViewportRangeNorm}
        />

        <AnimationToolBar
          tools={animationTools}
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          settingsContext={toolSettingsContext}
          durationSec={durationSec}
          rangeFalloffStepSec={rangeFalloffStepSec}
          smoothRangeStepSec={smoothRangeStepSec}
          rangeSizeSec={rangeSizeSec}
          setSelectedTimeRangeDurationSec={setSelectedTimeRangeDurationSec}
          setRangeFalloffSec={setRangeFalloffSec}
          setSmoothFalloffSec={setSmoothFalloffSec}
          setSmoothRangeSec={setSmoothRangeSec}
          setSmoothStrength={setSmoothStrength}
          setLineSnapStart={setLineSnapStart}
          setLineSnapEnd={setLineSnapEnd}
        />
      </div>
      <TransportBar
        isPlaying={isPlaying}
        loopEnabled={loopEnabled}
        durationSec={durationSec}
        playheadSec={playheadSec}
        playheadSampleStepSec={playheadSampleStepSec}
        setLocalScrubTimeSec={setLocalScrubTimeSec}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={setLoopEnabled}
        seekPlayheadToTimeSec={seekPlayheadToTimeSec}
      />
    </div>
  );
}
