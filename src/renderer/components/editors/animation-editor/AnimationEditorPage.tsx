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
type AnimToolName = "Pencil" | "Line" | "Range" | "Smooth";
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
  duration_sec?: number;
  channels?: string[];
};
type AnimTelemetryAnimsetResponse = {
  service_id: string;
  animset_path: string;
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
  smoothRangeSec?: number;
  channelVisible?: Record<string, boolean>;
  channelColor?: Record<string, string>;
  selectedChannel?: string | null;
  laneRange?: Record<string, LaneRange>;
};
const DEFAULT_ANIMSET = "content/animsets/barr_e_expression_mvp.animset.yaml";
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
const DEFAULT_SMOOTH_RANGE_SEC = 0.45;
const TOOL_SECTIONS = [
  { title: "Sculpting", items: ["Pencil", "Line", "Range", "Smooth", "Flatten", "Push/Pull"] },
];

const TOOL_TIPS: Record<string, string> = {
  Pencil: "Paint values freely across a time window toward the cursor path.",
  Line: "Preview and place a straight line across a sample range. Esc cancels; mouse-up applies.",
  Range: "Select a time range in the ruler, then offset that span per channel with the handle. [ / ] adjust size, Shift+[ / ] adjust falloff.",
  Smooth: "Brush over the curve to smooth it locally. [ / ] adjust size, Shift+[ / ] adjust falloff, + / - adjust strength.",
  Flatten: "Collapse local variance toward a flatter profile.",
  "Push/Pull": "Nudge values up or down without changing timing.",
  Select: "Select one or more keys/points.",
  Move: "Move selected keys in time and/or value.",
  "Add Point": "Insert a new key at the cursor time/value.",
  "Delete Point": "Delete selected keys.",
  Scale: "Scale amplitude over a selected time span.",
  Offset: "Apply a constant value offset over the selected span.",
  "Ramp Up": "Apply an increasing linear offset over the selected span.",
  "Ramp Down": "Apply a decreasing linear offset over the selected span.",
};

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

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
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

type ToolSettingNumberControlProps = {
  label: string;
  value: string;
  numericValue: number;
  title: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  onReset: () => void;
  onDelta: (delta: number) => void;
  onScrubValue: (next: number) => void;
  stepSize: number;
};

function ToolSettingNumberControl({
  label,
  value,
  numericValue,
  title,
  onChange,
  onCommit,
  onReset,
  onDelta,
  onScrubValue,
  stepSize,
}: ToolSettingNumberControlProps) {
  const scrubRef = React.useRef<{
    onMove: (event: MouseEvent) => void;
    onUp: () => void;
    previousUserSelect: string;
  } | null>(null);

  const beginScrub = React.useCallback(
    (startX: number) => {
      const existing = scrubRef.current;
      if (existing) {
        window.removeEventListener("mousemove", existing.onMove);
        window.removeEventListener("mouseup", existing.onUp);
        document.body.style.userSelect = existing.previousUserSelect;
      }
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const pixelsPerStep = 6;
      const startValue = numericValue;
      const scrubState = {
        previousUserSelect,
        onMove: (moveEvent: MouseEvent) => {
          moveEvent.preventDefault();
          const multiplier = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
          const deltaUnits = ((moveEvent.clientX - startX) / pixelsPerStep) * stepSize * multiplier;
          onScrubValue(startValue + deltaUnits);
        },
        onUp: () => {
          window.removeEventListener("mousemove", scrubState.onMove);
          window.removeEventListener("mouseup", scrubState.onUp);
          document.body.style.userSelect = scrubState.previousUserSelect;
          scrubRef.current = null;
        },
      };
      scrubRef.current = scrubState;
      window.addEventListener("mousemove", scrubState.onMove);
      window.addEventListener("mouseup", scrubState.onUp);
    },
    [numericValue, onScrubValue, stepSize]
  );

  return (
    <div className={styles.toolSettingRow} title={title}>
      <span>{label}</span>
      <div className={styles.toolSettingControl}>
        <button
          type="button"
          className={styles.toolSettingScrubHotspot}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            beginScrub(event.clientX);
          }}
          title={`${title} (drag horizontally to scrub, Shift x10, Alt /10)`}
          aria-label={`Scrub ${label}`}
        >
          <span className={styles.toolSettingScrubDot} />
        </button>
        <input
          className={styles.toolSettingInput}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              onReset();
              event.currentTarget.blur();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              onDelta(stepSize * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1));
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              onDelta(-stepSize * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1));
            }
          }}
          title={title}
        />
        <button
          type="button"
          className={styles.toolSettingStepperButton}
          onClick={(event) => onDelta(-stepSize * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1))}
          title={`Decrease ${label} (Shift x10, Alt /10)`}
        >
          -
        </button>
        <button
          type="button"
          className={styles.toolSettingStepperButton}
          onClick={(event) => onDelta(stepSize * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1))}
          title={`Increase ${label} (Shift x10, Alt /10)`}
        >
          +
        </button>
      </div>
    </div>
  );
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
  const [smoothRangeSec, setSmoothRangeSec] = React.useState(
    () => initialPersistedState?.smoothRangeSec ?? DEFAULT_SMOOTH_RANGE_SEC
  );
  const [smoothRangeDraft, setSmoothRangeDraft] = React.useState(() => DEFAULT_SMOOTH_RANGE_SEC.toFixed(3));
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
  const drawWriteStateRef = React.useRef<{
    clipIndex: number;
    channel: string;
    queuedStartSampleIndex: number | null;
    queuedEndSampleIndex: number | null;
    inFlight: boolean;
    timerId: ReturnType<typeof setTimeout> | null;
    acceptedClipRevision: string;
  }>({
    clipIndex: -1,
    channel: "",
    queuedStartSampleIndex: null,
    queuedEndSampleIndex: null,
    inFlight: false,
    timerId: null,
    acceptedClipRevision: "0",
  });

  React.useEffect(() => {
    clipDataRef.current = clipData;
  }, [clipData]);

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
    if (payload.animset_path) {
      setAnimsetPath(payload.animset_path);
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
      } catch {
        if (cancelled) return;
        setAnimTelemetryServiceId("");
      }
    }
    void discoverAnimService();
    return () => {
      cancelled = true;
    };
  }, [selectedWorkloadName, telemetryBaseUrl]);

  React.useEffect(() => {
    if (!animTelemetryServiceId) return;
    void reloadAnimsetClipRefs();
  }, [animTelemetryServiceId, reloadAnimsetClipRefs]);

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
    void loadSelectedClip();
    return () => {
      cancelled = true;
    };
  }, [animTelemetryServiceId, clipRefs, loadLiveClipData, selectedClipPath]);

  const scrubWriteStateRef = React.useRef<{
    active: boolean;
    pendingValueSec: number | null;
    inFlight: boolean;
    lastSentAtMs: number;
    timerId: ReturnType<typeof setTimeout> | null;
    connectionSuppressed: boolean;
  }>({
    active: false,
    pendingValueSec: null,
    inFlight: false,
    lastSentAtMs: 0,
    timerId: null,
    connectionSuppressed: false,
  });
  const SCRUB_MIN_SEND_INTERVAL_MS = 50;

  const clearScrubTimer = React.useCallback(() => {
    const state = scrubWriteStateRef.current;
    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

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

  const toggleLoopEnabled = React.useCallback(() => {
    const nextLoopEnabled = !loopEnabled;
    setLoopEnabled(nextLoopEnabled);
    void writeAnimControlField("loop", nextLoopEnabled);
  }, [loopEnabled, writeAnimControlField]);

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

  const flushScrubTimeOverride = React.useCallback(
    async (force: boolean) => {
      const state = scrubWriteStateRef.current;
      if (!state.active && !force) return;
      if (state.inFlight) return;
      if (state.pendingValueSec === null) return;

      const now = Date.now();
      const elapsed = now - state.lastSentAtMs;
      if (!force && elapsed < SCRUB_MIN_SEND_INTERVAL_MS) {
        if (state.timerId === null) {
          state.timerId = setTimeout(() => {
            state.timerId = null;
            void flushScrubTimeOverride(false);
          }, SCRUB_MIN_SEND_INTERVAL_MS - elapsed);
        }
        return;
      }

      const valueToSend = state.pendingValueSec;
      state.pendingValueSec = null;
      state.inFlight = true;
      const ok = await writeAnimControlFieldRaw("time_override_sec", valueToSend);
      if (ok) {
        state.lastSentAtMs = Date.now();
      }
      state.inFlight = false;

      if (state.pendingValueSec !== null) {
        void flushScrubTimeOverride(false);
      }
    },
    [writeAnimControlFieldRaw]
  );

  const beginScrubSession = React.useCallback(async () => {
    const state = scrubWriteStateRef.current;
    state.active = true;
    state.pendingValueSec = null;
    clearScrubTimer();
    if (!state.connectionSuppressed) {
      const suppressed = await setAnimControlConnectionState("time_override_sec", false);
      state.connectionSuppressed = suppressed;
    }
  }, [clearScrubTimer, setAnimControlConnectionState]);

  const queueScrubTimeOverride = React.useCallback(
    (valueSec: number) => {
      const state = scrubWriteStateRef.current;
      state.pendingValueSec = valueSec;
      void flushScrubTimeOverride(false);
    },
    [flushScrubTimeOverride]
  );

  const endScrubSession = React.useCallback(async () => {
    const state = scrubWriteStateRef.current;
    state.active = false;
    clearScrubTimer();
    await flushScrubTimeOverride(true);
    if (state.connectionSuppressed) {
      await setAnimControlConnectionState("time_override_sec", true);
      state.connectionSuppressed = false;
    }
    if (localScrubTimeSec !== null) {
      setPendingScrubAdoptSec(localScrubTimeSec);
      setTimeout(() => {
        setPendingScrubAdoptSec((current) => {
          if (current !== null) {
            setLocalScrubTimeSec(null);
          }
          return null;
        });
      }, 900);
    } else {
      setLocalScrubTimeSec(null);
    }
  }, [clearScrubTimer, flushScrubTimeOverride, localScrubTimeSec, setAnimControlConnectionState]);

  React.useEffect(
    () => () => {
      const state = scrubWriteStateRef.current;
      state.active = false;
      clearScrubTimer();
      if (state.connectionSuppressed) {
        void setAnimControlConnectionState("time_override_sec", true);
        state.connectionSuppressed = false;
      }
      const heldFields = Array.from(heldSuppressedAnimControlFieldsRef.current);
      heldSuppressedAnimControlFieldsRef.current.clear();
      heldFields.forEach((fieldName) => {
        void setAnimControlConnectionState(fieldName, true);
      });
    },
    [clearScrubTimer, setAnimControlConnectionState]
  );

  React.useEffect(
    () => () => {
      if (pendingClipDataRafRef.current !== null) {
        cancelAnimationFrame(pendingClipDataRafRef.current);
        pendingClipDataRafRef.current = null;
      }
      const state = drawWriteStateRef.current;
      if (state.timerId !== null) {
        clearTimeout(state.timerId);
        state.timerId = null;
      }
    },
    []
  );

  React.useEffect(() => {
    if (!selectedWorkloadName) return;
    const runtimeAnimsetPath = readFieldValue(`${selectedWorkloadName}.config.animset_path`);
    if (typeof runtimeAnimsetPath === "string" && runtimeAnimsetPath.length > 0) {
      setAnimsetPath(runtimeAnimsetPath);
    }
  }, [readFieldValue, selectedWorkloadName]);

  const channelNames = Object.keys(clipData.channels);
  const visibleChannels = channelNames.filter((n) => channelVisible[n] !== false);
  const allChannelsVisible = channelNames.length > 0 && visibleChannels.length === channelNames.length;
  const hasClipSamples = React.useMemo(
    () => Object.values(clipData.channels).some((samples) => (samples?.length ?? 0) > 0),
    [clipData.channels]
  );
  const durationSec = hasClipSamples
    ? Math.max(DEFAULT_EMPTY_CLIP_DURATION_SEC, clipData.durationSec)
    : DEFAULT_EMPTY_CLIP_DURATION_SEC;
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
  const animsetOptions = React.useMemo(() => Array.from(new Set([animsetPath, DEFAULT_ANIMSET].filter(Boolean))), [animsetPath]);
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
    setSmoothRangeDraft(smoothRangeSec.toFixed(3));
  }, [smoothRangeSec]);

  React.useEffect(() => {
    if (activeTool !== "Range" && activeTool !== "Smooth") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        event.preventDefault();
        const direction = event.code === "BracketRight" ? 1 : -1;
        if (event.shiftKey) {
          if (activeTool === "Range") {
            setRangeFalloffSec((current) => Math.min(durationSec, Math.max(0, current + direction * rangeFalloffStepSec)));
          } else {
            setSmoothFalloffSec((current) => Math.min(durationSec, Math.max(0, current + direction * rangeFalloffStepSec)));
          }
          return;
        }
        if (activeTool === "Range") {
          setSelectedTimeRangeDurationSec(rangeSizeSec + direction * smoothRangeStepSec);
        } else {
          setSmoothRangeSec((current) => Math.min(durationSec, Math.max(0.01, current + direction * smoothRangeStepSec)));
        }
        return;
      }
      if (activeTool === "Smooth" && (event.key === "-" || event.key === "_" || event.key === "=" || event.key === "+")) {
        event.preventDefault();
        const direction = event.key === "-" || event.key === "_" ? -1 : 1;
        setSmoothStrength((current) => Math.min(1, Math.max(0, current + direction * 0.02)));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTool, durationSec, rangeFalloffStepSec, rangeSizeSec, setSelectedTimeRangeDurationSec, smoothRangeStepSec]);

  React.useEffect(() => {
    if (activeTool !== "Line") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.code === "BracketLeft") {
        event.preventDefault();
        setLineSnapStart((current) => !current);
        return;
      }
      if (event.code === "BracketRight") {
        event.preventDefault();
        setLineSnapEnd((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTool]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (isPlaying) {
          void writeAnimControlField("playback_state", 1);
          return;
        }
        void writeAnimControlField("playback_state", 2);
        return;
      }
      if (event.code === "NumpadDivide" || (event.key === "/" && event.location === 3)) {
        event.preventDefault();
        toggleLoopEnabled();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying, toggleLoopEnabled, writeAnimControlField]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (isPlaying) return;
      if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.code === "ArrowRight" ? 1 : -1;
      const multiplier = event.shiftKey ? 10 : 1;
      seekPlayheadToTimeSec(playheadSec + direction * playheadSampleStepSec * multiplier);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isPlaying, playheadSampleStepSec, playheadSec, seekPlayheadToTimeSec]);

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
      smoothRangeSec,
      channelVisible,
      channelColor,
      selectedChannel,
      laneRange,
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
    selectedChannel,
    selectedClipPath,
    selectedSourceId,
    selectedTimeRange,
    smoothFalloffCurve,
    smoothFalloffSec,
    smoothRangeSec,
    smoothStrength,
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
      if (activeTool !== "Range") return;
      event.preventDefault();
      event.stopPropagation();
      const rect = playheadViewportRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return;
      const timeFromClientX = (clientX: number) =>
        Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * durationSec;

      const startSec = timeFromClientX(event.clientX);
      setSelectedTimeRange({ startSec, endSec: startSec });

      const onMove = (moveEvent: PointerEvent) => {
        setSelectedTimeRange({
          startSec,
          endSec: timeFromClientX(moveEvent.clientX),
        });
      };
      const onUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const endSec = timeFromClientX(upEvent.clientX);
        setSelectedTimeRange({
          startSec: Math.min(startSec, endSec),
          endSec: Math.max(startSec, endSec),
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [activeTool, durationSec]
  );

  const clearDrawFlushTimer = React.useCallback(() => {
    const state = drawWriteStateRef.current;
    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const beginDrawStrokeSession = React.useCallback((clipIndex: number, channel: string) => {
    const state = drawWriteStateRef.current;
    state.clipIndex = clipIndex;
    state.channel = channel;
    state.queuedStartSampleIndex = null;
    state.queuedEndSampleIndex = null;
    state.acceptedClipRevision = clipDataRef.current.clipRevision;
  }, []);

  const refreshSelectedClipFromEngine = React.useCallback(
    async (clipIndex: number) => {
      const clipRef = clipRefs[clipIndex];
      if (!clipRef) return;
      const loaded = await loadLiveClipData(clipIndex, clipRef.name);
      if (loaded) {
        drawWriteStateRef.current.acceptedClipRevision = loaded.clipRevision;
      }
    },
    [clipRefs, loadLiveClipData]
  );

  const writeSampleRange = React.useCallback(
    async (clipIndex: number, channel: string, startSampleIndex: number, endSampleIndex: number) => {
      const currentClip = clipDataRef.current;
      const channelSamples = currentClip.channels[channel] ?? new Float32Array(0);
      if (startSampleIndex < 0 || endSampleIndex < startSampleIndex || endSampleIndex >= channelSamples.length) {
        throw new Error("Invalid sample range");
      }
      const url = buildAnimServiceUrl("/samples-write-range", { clip_index: clipIndex >= 0 ? clipIndex : undefined });
      if (!url) {
        throw new Error("Missing samples-write-range URL");
      }
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_revision: drawWriteStateRef.current.acceptedClipRevision,
          channel,
          start_sample_index: startSampleIndex,
          values: Array.from(channelSamples.subarray(startSampleIndex, endSampleIndex + 1)),
        }),
      });
      const payload = (await response.json()) as { clip_revision?: string; error?: string };
      if (!response.ok) {
        if (response.status === 409 && typeof payload.clip_revision === "string") {
          drawWriteStateRef.current.acceptedClipRevision = payload.clip_revision;
        }
        throw new Error(`Failed to write live samples: ${response.status}`);
      }
      if (typeof payload.clip_revision === "string") {
        drawWriteStateRef.current.acceptedClipRevision = payload.clip_revision;
      }
      scheduleClipDataRender({
        ...clipDataRef.current,
        clipRevision: drawWriteStateRef.current.acceptedClipRevision,
        dirty: true,
      });
    },
    [buildAnimServiceUrl, scheduleClipDataRender]
  );

  const flushDrawStroke = React.useCallback(
    async (force: boolean) => {
      const state = drawWriteStateRef.current;
      if (
        state.inFlight ||
        state.queuedStartSampleIndex === null ||
        state.queuedEndSampleIndex === null ||
        !state.channel
      ) {
        return;
      }

      const clipIndex = state.clipIndex;
      const channel = state.channel;
      const startSampleIndex = state.queuedStartSampleIndex;
      const endSampleIndex = state.queuedEndSampleIndex;
      const clipRevision = state.acceptedClipRevision;
      state.queuedStartSampleIndex = null;
      state.queuedEndSampleIndex = null;
      state.inFlight = true;
      try {
        state.acceptedClipRevision = clipRevision;
        await writeSampleRange(clipIndex, channel, startSampleIndex, endSampleIndex);
      } catch (error) {
        console.warn("Live draw request failed", { clipIndex, channel, startSampleIndex, endSampleIndex, error });
        state.queuedStartSampleIndex = null;
        state.queuedEndSampleIndex = null;
        void refreshSelectedClipFromEngine(clipIndex).catch(() => undefined);
      } finally {
        state.inFlight = false;
        if (state.queuedStartSampleIndex !== null && state.queuedEndSampleIndex !== null) {
          if (force) {
            void flushDrawStroke(true);
          } else {
            state.timerId = setTimeout(() => {
              state.timerId = null;
              void flushDrawStroke(false);
            }, 40);
          }
        }
      }
    },
    [refreshSelectedClipFromEngine, writeSampleRange]
  );

  const queueDrawStrokeRange = React.useCallback(
    (clipIndex: number, channel: string, startSampleIndex: number, endSampleIndex: number) => {
      const state = drawWriteStateRef.current;
      if (state.channel !== channel || state.clipIndex !== clipIndex) {
        state.clipIndex = clipIndex;
        state.channel = channel;
        state.queuedStartSampleIndex = null;
        state.queuedEndSampleIndex = null;
      }
      if (endSampleIndex < startSampleIndex) {
        return;
      }
      state.queuedStartSampleIndex =
        state.queuedStartSampleIndex === null ? startSampleIndex : Math.min(state.queuedStartSampleIndex, startSampleIndex);
      state.queuedEndSampleIndex =
        state.queuedEndSampleIndex === null ? endSampleIndex : Math.max(state.queuedEndSampleIndex, endSampleIndex);
      if (
        state.queuedStartSampleIndex !== null &&
        state.queuedEndSampleIndex !== null &&
        state.queuedEndSampleIndex - state.queuedStartSampleIndex >= 8
      ) {
        clearDrawFlushTimer();
        void flushDrawStroke(false);
        return;
      }
      if (state.timerId === null) {
        state.timerId = setTimeout(() => {
          state.timerId = null;
          void flushDrawStroke(false);
        }, 40);
      }
    },
    [clearDrawFlushTimer, flushDrawStroke]
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
      if (activeTool !== "Range" || !selectedTimeRange) return;
      event.preventDefault();
      event.stopPropagation();
      const selectedClip = clipRefs.find((clip) => clip.animclipPath === selectedClipPath) ?? null;
      const clipIndex = selectedClip ? clipRefs.findIndex((clip) => clip.animclipPath === selectedClip.animclipPath) : -1;
      if (clipIndex < 0) return;
      const sampleRange = sampleIndexRangeFromTimes(
        channelSamples.length,
        durationSec,
        selectedTimeRange.startSec,
        selectedTimeRange.endSec
      );
      if (!sampleRange) return;
      const falloffSec = rangeFalloffSec;
      const falloffSampleCount =
        channelSamples.length > 1 && durationSec > 0
          ? Math.max(0, Math.round((falloffSec / durationSec) * (channelSamples.length - 1)))
          : 0;

      const laneTrack = (event.currentTarget.closest('[data-lane-track="true"]') as HTMLElement | null) ?? event.currentTarget.ownerSVGElement?.parentElement;
      const laneRect = laneTrack?.getBoundingClientRect();
      const laneHeightPx = Math.max(1, laneRect?.height ?? 1);
      const laneValueSpan = Math.max(1e-6, maxV - minV);

      beginDrawStrokeSession(clipIndex, channel);
      rangeOffsetStateRef.current = {
        active: true,
        clipIndex,
        channel,
        mode: "Range",
        coreRange: sampleRange,
        writeRange: sampleRange,
        baseSamples: (clipDataRef.current.channels[channel] ?? channelSamples).slice(),
        baseDirty: clipDataRef.current.dirty,
        startClientY: event.clientY,
        laneHeightPx,
        laneValueSpan,
        startStrength: DEFAULT_SMOOTH_STRENGTH,
      };

      const applyRangePreview = (clientY: number) => {
        const state = rangeOffsetStateRef.current;
        if (!state.active || !state.baseSamples || !state.coreRange) return;
        const result = applyOffsetToSampleRangeWithFalloff(
          state.baseSamples,
          state.coreRange,
          -((clientY - state.startClientY) / state.laneHeightPx) * state.laneValueSpan,
          falloffSampleCount,
          rangeFalloffCurve
        );
        state.writeRange = result.writeRange;
        scheduleClipDataRender({
          ...clipDataRef.current,
          dirty: true,
          channels: {
            ...clipDataRef.current.channels,
            [channel]: result.samples,
          },
        });
        queueDrawStrokeRange(clipIndex, channel, result.writeRange.startSampleIndex, result.writeRange.endSampleIndex);
      };

      const finishRangeOffset = (applyEdit: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("keydown", onKeyDown);
        const state = rangeOffsetStateRef.current;
        rangeOffsetStateRef.current = {
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
        };
        if (!state.baseSamples || !state.coreRange || !state.writeRange) return;

        if (!applyEdit) {
          clearDrawFlushTimer();
          drawWriteStateRef.current.queuedStartSampleIndex = null;
          drawWriteStateRef.current.queuedEndSampleIndex = null;
          scheduleClipDataRender({
            ...clipDataRef.current,
            dirty: state.baseDirty,
            channels: {
              ...clipDataRef.current.channels,
              [channel]: state.baseSamples,
            },
          });
          flushPendingClipDataRender();
          queueDrawStrokeRange(clipIndex, channel, state.writeRange.startSampleIndex, state.writeRange.endSampleIndex);
          void flushDrawStroke(true);
          return;
        }

        flushPendingClipDataRender();
        void flushDrawStroke(true);
      };

      const onMove = (moveEvent: PointerEvent) => {
        applyRangePreview(moveEvent.clientY);
      };
      const onUp = () => finishRangeOffset(true);
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          finishRangeOffset(false);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("keydown", onKeyDown);
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
      if (activeTool !== "Pencil" && activeTool !== "Line" && activeTool !== "Smooth") return;
      event.preventDefault();
      event.stopPropagation();
      const selectedClip = clipRefs.find((clip) => clip.animclipPath === selectedClipPath) ?? null;
      const clipIndex = selectedClip ? clipRefs.findIndex((clip) => clip.animclipPath === selectedClip.animclipPath) : -1;
      const svg = event.currentTarget;
      setSelectedChannel(channel);
      beginDrawStrokeSession(clipIndex, channel);

      const startPoint = pointerToDrawPoint(svg, event.clientX, event.clientY, minV, maxV);
      if (!startPoint) return;

      if (activeTool === "Smooth") {
        const baseSamples = (clipDataRef.current.channels[channel] ?? channelSamples).slice();
        const baseDirty = clipDataRef.current.dirty;
        let touchedRange: { startSampleIndex: number; endSampleIndex: number } | null = null;
        setSmoothBrushPreview({ channel, centerSec: startPoint.t });
        const commitBrushPoint = (point: Point) => {
          const currentClip = clipDataRef.current;
          const current = currentClip.channels[channel] ?? channelSamples;
          const brushRangeSec = Math.min(durationSec, Math.max(0.01, smoothRangeSec));
          setSmoothBrushPreview({ channel, centerSec: point.t });
          const result = applySmoothBrushToSamples(
            current,
            durationSec,
            point.t,
            brushRangeSec,
            smoothStrength,
            smoothFalloffSec,
            smoothFalloffCurve
          );
          if (result.writeRange.endSampleIndex < result.writeRange.startSampleIndex) return;
          touchedRange = touchedRange
            ? {
                startSampleIndex: Math.min(touchedRange.startSampleIndex, result.writeRange.startSampleIndex),
                endSampleIndex: Math.max(touchedRange.endSampleIndex, result.writeRange.endSampleIndex),
              }
            : result.writeRange;
          scheduleClipDataRender({
            ...currentClip,
            dirty: true,
            channels: {
              ...currentClip.channels,
              [channel]: result.samples,
            },
          });
          queueDrawStrokeRange(clipIndex, channel, result.writeRange.startSampleIndex, result.writeRange.endSampleIndex);
        };

        commitBrushPoint(startPoint);

        const onMove = (moveEvent: PointerEvent) => {
          const point = pointerToDrawPoint(svg, moveEvent.clientX, moveEvent.clientY, minV, maxV);
          if (!point) return;
          commitBrushPoint(point);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("keydown", onKeyDown);
          setSmoothBrushPreview(null);
          clearDrawFlushTimer();
          flushPendingClipDataRender();
          void flushDrawStroke(true);
        };
        const onKeyDown = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key !== "Escape") return;
          keyEvent.preventDefault();
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("keydown", onKeyDown);
          setSmoothBrushPreview(null);
          clearDrawFlushTimer();
          drawWriteStateRef.current.queuedStartSampleIndex = null;
          drawWriteStateRef.current.queuedEndSampleIndex = null;
          scheduleClipDataRender({
            ...clipDataRef.current,
            dirty: baseDirty,
            channels: {
              ...clipDataRef.current.channels,
              [channel]: baseSamples,
            },
          });
          if (touchedRange) {
            queueDrawStrokeRange(clipIndex, channel, touchedRange.startSampleIndex, touchedRange.endSampleIndex);
          }
          flushPendingClipDataRender();
          void flushDrawStroke(true);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("keydown", onKeyDown);
        return;
      }

      if (activeTool === "Line") {
        const baseSamples = (clipDataRef.current.channels[channel] ?? channelSamples).slice();
        const anchoredStartPoint =
          lineSnapStart
            ? closestSamplePointToClientPoint(baseSamples, durationSec, minV, maxV, event.clientX, event.clientY, svg)
            : startPoint;
        linePreviewStateRef.current = {
          active: true,
          clipIndex,
          channel,
          baseSamples,
          baseDirty: clipDataRef.current.dirty,
          startPoint: anchoredStartPoint,
          touchedRange: null,
        };

        const applyLinePreview = (point: Point, clientX: number, clientY: number) => {
          const lineState = linePreviewStateRef.current;
          const currentBase = lineState.baseSamples ?? baseSamples;
          const nextPoint =
            lineSnapEnd
              ? closestSamplePointToClientPoint(currentBase, durationSec, minV, maxV, clientX, clientY, svg)
              : point;
          const delta = buildInterpolatedDrawDelta(currentBase.length, durationSec, anchoredStartPoint, nextPoint);
          if (!delta) return;
          const nextChannel = applySampleDeltaToBuffer(currentBase, delta);
          const rangeStart = delta.startSampleIndex;
          const rangeEnd = delta.startSampleIndex + delta.values.length - 1;
          lineState.touchedRange = lineState.touchedRange
            ? {
                startSampleIndex: Math.min(lineState.touchedRange.startSampleIndex, rangeStart),
                endSampleIndex: Math.max(lineState.touchedRange.endSampleIndex, rangeEnd),
              }
            : {
                startSampleIndex: rangeStart,
                endSampleIndex: rangeEnd,
              };
          scheduleClipDataRender({
            ...clipDataRef.current,
            dirty: true,
            channels: {
              ...clipDataRef.current.channels,
              [channel]: nextChannel,
            },
          });
          queueDrawStrokeRange(clipIndex, channel, rangeStart, rangeEnd);
        };

        applyLinePreview(anchoredStartPoint, event.clientX, event.clientY);

        const finishLineSession = (applyEdit: boolean) => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("keydown", onKeyDown);
          clearDrawFlushTimer();
          flushPendingClipDataRender();

          const lineState = linePreviewStateRef.current;
          const base = lineState.baseSamples;
          const baseDirty = lineState.baseDirty;
          const touchedRange = lineState.touchedRange;
          linePreviewStateRef.current = {
            active: false,
            clipIndex: -1,
            channel: "",
            baseSamples: null,
            baseDirty: false,
            startPoint: null,
            touchedRange: null,
          };

          if (!applyEdit) {
            if (base) {
              clearDrawFlushTimer();
              drawWriteStateRef.current.queuedStartSampleIndex = null;
              drawWriteStateRef.current.queuedEndSampleIndex = null;
              scheduleClipDataRender({
                ...clipDataRef.current,
                dirty: baseDirty,
                channels: {
                  ...clipDataRef.current.channels,
                  [channel]: base,
                },
              });
              if (touchedRange) {
                queueDrawStrokeRange(clipIndex, channel, touchedRange.startSampleIndex, touchedRange.endSampleIndex);
                flushPendingClipDataRender();
                void flushDrawStroke(true);
              }
            }
            return;
          }
          if (touchedRange) {
            flushPendingClipDataRender();
            void flushDrawStroke(true);
          }
        };

        const onMove = (moveEvent: PointerEvent) => {
          const point = pointerToDrawPoint(svg, moveEvent.clientX, moveEvent.clientY, minV, maxV);
          if (!point) return;
          applyLinePreview(point, moveEvent.clientX, moveEvent.clientY);
        };
        const onUp = () => finishLineSession(true);
        const onKeyDown = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key === "Escape") {
            keyEvent.preventDefault();
            finishLineSession(false);
          }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("keydown", onKeyDown);
        return;
      }

      let previousPoint: Point | null = null;
      const previewPoint = (point: Point) => {
        const currentClip = clipDataRef.current;
        const current = currentClip.channels[channel] ?? channelSamples;
        const delta = buildInterpolatedDrawDelta(current.length, durationSec, previousPoint ?? point, point);
        if (!delta) return;
        const nextChannel = applySampleDeltaToBuffer(current, delta);
        const nextClip = {
          ...currentClip,
          dirty: true,
          channels: {
            ...currentClip.channels,
            [channel]: nextChannel,
          },
        };
        scheduleClipDataRender(nextClip);
        queueDrawStrokeRange(
          clipIndex,
          channel,
          delta.startSampleIndex,
          delta.startSampleIndex + delta.values.length - 1
        );
        previousPoint = point;
      };

      previewPoint(startPoint);

      const onMove = (moveEvent: PointerEvent) => {
        const point = pointerToDrawPoint(svg, moveEvent.clientX, moveEvent.clientY, minV, maxV);
        if (!point) return;
        previewPoint(point);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        clearDrawFlushTimer();
        flushPendingClipDataRender();
        void flushDrawStroke(true);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
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
    if (hovered) {
      setHoveredChannel(channel);
      return;
    }
    setHoveredChannel((prev) => (prev === channel ? null : prev));
  }, []);

  const handleLaneSelect = React.useCallback((channel: string) => {
    setSelectedChannel(channel);
  }, []);

  const handleSmoothBrushPreviewChange = React.useCallback(
    (channel: string, timeSec: number | null) => {
      if (activeTool !== "Smooth") return;
      if (timeSec === null) {
        setSmoothBrushPreview((current) => (current?.channel === channel ? null : current));
        return;
      }
      setSmoothBrushPreview({ channel, centerSec: Math.min(durationSec, Math.max(0, timeSec)) });
    },
    [activeTool, durationSec]
  );

  return (
    <div className={styles.root} data-testid="animation-editor-panel">
      <div className={styles.mainGrid}>
        <aside className={styles.sidebar}>
          <section className={styles.panelCard}>
            <h3>Target</h3>
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
            <h3>AnimSet</h3>
            <select
              value={animsetPath}
              className={styles.selectControl}
              title="AnimSet is currently runtime-owned and read-only."
              disabled
              aria-readonly="true"
            >
              {animsetOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <h3>Active Clip</h3>
            <select
              value={selectedClipPath}
              onFocus={() => void reloadAnimsetClipRefs()}
              onMouseDown={() => void reloadAnimsetClipRefs()}
              onChange={(e) => {
                const nextPath = e.target.value;
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
              }}
              className={styles.selectControl}
            >
              {clipRefs.map((c) => (
                <option key={c.animclipPath} value={c.animclipPath}>
                  {c.name}
                </option>
              ))}
            </select>
          </section>
          <section className={styles.panelCard}>
            <div className={styles.channelsHeader}>
              <h3>Channels</h3>
              <button
                className={styles.eyeToggle}
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
                {allChannelsVisible ? "👁" : "◌"}
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
                  <span>{channel}</span>
                  <button
                    className={styles.eyeToggle}
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
                    {channelVisible[channel] !== false ? "👁" : "◌"}
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
        />

        <aside className={styles.tools}>
          {TOOL_SECTIONS.map((section) => (
            <section key={section.title} className={styles.panelCard}>
              <h3>{section.title}</h3>
              <div className={styles.toolButtons}>
                {section.items.map((item) => (
                  <button
                    key={item}
                    className={`${styles.toolButton} ${item === activeTool ? styles.toolButtonActive : ""}`}
                    type="button"
                    title={item === "Pencil" || item === "Line" || item === "Range" || item === "Smooth" ? TOOL_TIPS[item] : `${item} is not implemented yet.`}
                    disabled={item !== "Pencil" && item !== "Line" && item !== "Range" && item !== "Smooth"}
                    onClick={() => {
                      if (item === "Pencil" || item === "Line" || item === "Range" || item === "Smooth") {
                        setActiveTool((current) => (current === item ? null : item));
                      }
                    }}
                  >
                    {/*
                      Tooltips stay explicit per tool so the intended authoring
                      semantics remain visible as the palette fills out.
                    */}
                    <span title={TOOL_TIPS[item] ?? `Activate ${item} tool`}>{item}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {activeTool === "Line" ? (
            <section className={styles.panelCard}>
              <h3>Tool Settings</h3>
              <div className={styles.toolButtons}>
                <button
                  type="button"
                  className={`${styles.toolButton} ${lineSnapStart ? styles.toolButtonActive : ""}`}
                  onClick={() => setLineSnapStart((current) => !current)}
                  title="Anchor the line start to the current curve value at its time. Shortcut: [ (BracketLeft)."
                >
                  Snap Start
                </button>
                <button
                  type="button"
                  className={`${styles.toolButton} ${lineSnapEnd ? styles.toolButtonActive : ""}`}
                  onClick={() => setLineSnapEnd((current) => !current)}
                  title="Anchor the line end to the current curve value at its time. Shortcut: ] (BracketRight)."
                >
                  Snap End
                </button>
              </div>
            </section>
          ) : null}
          {activeTool === "Range" || activeTool === "Smooth" ? (
            <section className={styles.panelCard}>
              <h3>Tool Settings</h3>
              {activeTool === "Range" ? (
                <>
                  <ToolSettingNumberControl
                    label="Size"
                    value={rangeSizeDraft}
                    numericValue={rangeSizeSec}
                    title="Selected range width in seconds ([ / ])"
                    onChange={setRangeSizeDraft}
                    onCommit={() => {
                      const parsed = Number(rangeSizeDraft);
                      if (!Number.isFinite(parsed)) {
                        setRangeSizeDraft(rangeSizeSec.toFixed(3));
                        return;
                      }
                      setSelectedTimeRangeDurationSec(parsed);
                    }}
                    onReset={() => setRangeSizeDraft(rangeSizeSec.toFixed(3))}
                    onDelta={(delta) => setSelectedTimeRangeDurationSec(rangeSizeSec + delta)}
                    onScrubValue={(next) => setSelectedTimeRangeDurationSec(next)}
                    stepSize={smoothRangeStepSec}
                  />
                  <ToolSettingNumberControl
                    label="Falloff Range"
                    value={rangeFalloffDraft}
                    numericValue={rangeFalloffSec}
                    title="Falloff range in seconds (Shift + [ / ])"
                    onChange={setRangeFalloffDraft}
                    onCommit={() => {
                      const parsed = Number(rangeFalloffDraft);
                      if (!Number.isFinite(parsed)) {
                        setRangeFalloffDraft(rangeFalloffSec.toFixed(3));
                        return;
                      }
                      setRangeFalloffSec(Math.min(durationSec, Math.max(0, parsed)));
                    }}
                    onReset={() => setRangeFalloffDraft(rangeFalloffSec.toFixed(3))}
                    onDelta={(delta) => setRangeFalloffSec((current) => Math.min(durationSec, Math.max(0, current + delta)))}
                    onScrubValue={(next) => setRangeFalloffSec(Math.min(durationSec, Math.max(0, next)))}
                    stepSize={rangeFalloffStepSec}
                  />
                  <ToolSettingNumberControl
                    label="Falloff Curve"
                    value={rangeFalloffCurveDraft}
                    numericValue={rangeFalloffCurve}
                    title="Falloff curve from 0.0 linear to 1.0 fully eased"
                    onChange={setRangeFalloffCurveDraft}
                    onCommit={() => {
                      const parsed = Number(rangeFalloffCurveDraft);
                      if (!Number.isFinite(parsed)) {
                        setRangeFalloffCurveDraft(rangeFalloffCurve.toFixed(2));
                        return;
                      }
                      setRangeFalloffCurve(Math.min(1, Math.max(0, parsed)));
                    }}
                    onReset={() => setRangeFalloffCurveDraft(rangeFalloffCurve.toFixed(2))}
                    onDelta={(delta) => setRangeFalloffCurve((current) => Math.min(1, Math.max(0, current + delta)))}
                    onScrubValue={(next) => setRangeFalloffCurve(Math.min(1, Math.max(0, next)))}
                    stepSize={0.05}
                  />
                </>
              ) : null}
              {activeTool === "Smooth" ? (
                <>
                  <ToolSettingNumberControl
                    label="Size"
                    value={smoothRangeDraft}
                    numericValue={smoothRangeSec}
                    title="Smooth brush width in seconds ([ / ])"
                    onChange={setSmoothRangeDraft}
                    onCommit={() => {
                      const parsed = Number(smoothRangeDraft);
                      if (!Number.isFinite(parsed)) {
                        setSmoothRangeDraft(smoothRangeSec.toFixed(3));
                        return;
                      }
                      setSmoothRangeSec(Math.min(durationSec, Math.max(0.01, parsed)));
                    }}
                    onReset={() => setSmoothRangeDraft(smoothRangeSec.toFixed(3))}
                    onDelta={(delta) => setSmoothRangeSec((current) => Math.min(durationSec, Math.max(0.01, current + delta)))}
                    onScrubValue={(next) => setSmoothRangeSec(Math.min(durationSec, Math.max(0.01, next)))}
                    stepSize={smoothRangeStepSec}
                  />
                  <ToolSettingNumberControl
                    label="Falloff Range"
                    value={smoothFalloffDraft}
                    numericValue={smoothFalloffSec}
                    title="Falloff range in seconds (Shift + [ / ])"
                    onChange={setSmoothFalloffDraft}
                    onCommit={() => {
                      const parsed = Number(smoothFalloffDraft);
                      if (!Number.isFinite(parsed)) {
                        setSmoothFalloffDraft(smoothFalloffSec.toFixed(3));
                        return;
                      }
                      setSmoothFalloffSec(Math.min(durationSec, Math.max(0, parsed)));
                    }}
                    onReset={() => setSmoothFalloffDraft(smoothFalloffSec.toFixed(3))}
                    onDelta={(delta) => setSmoothFalloffSec((current) => Math.min(durationSec, Math.max(0, current + delta)))}
                    onScrubValue={(next) => setSmoothFalloffSec(Math.min(durationSec, Math.max(0, next)))}
                    stepSize={rangeFalloffStepSec}
                  />
                  <ToolSettingNumberControl
                    label="Falloff Curve"
                    value={smoothFalloffCurveDraft}
                    numericValue={smoothFalloffCurve}
                    title="Falloff curve from 0.0 linear to 1.0 fully eased"
                    onChange={setSmoothFalloffCurveDraft}
                    onCommit={() => {
                      const parsed = Number(smoothFalloffCurveDraft);
                      if (!Number.isFinite(parsed)) {
                        setSmoothFalloffCurveDraft(smoothFalloffCurve.toFixed(2));
                        return;
                      }
                      setSmoothFalloffCurve(Math.min(1, Math.max(0, parsed)));
                    }}
                    onReset={() => setSmoothFalloffCurveDraft(smoothFalloffCurve.toFixed(2))}
                    onDelta={(delta) => setSmoothFalloffCurve((current) => Math.min(1, Math.max(0, current + delta)))}
                    onScrubValue={(next) => setSmoothFalloffCurve(Math.min(1, Math.max(0, next)))}
                    stepSize={0.05}
                  />
                  <ToolSettingNumberControl
                    label="Strength"
                    value={smoothStrengthDraft}
                    numericValue={smoothStrength}
                    title="Base smoothing strength (+ / -)"
                    onChange={setSmoothStrengthDraft}
                    onCommit={() => {
                      const parsed = Number(smoothStrengthDraft);
                      if (!Number.isFinite(parsed)) {
                        setSmoothStrengthDraft(smoothStrength.toFixed(2));
                        return;
                      }
                      setSmoothStrength(Math.min(1, Math.max(0, parsed)));
                    }}
                    onReset={() => setSmoothStrengthDraft(smoothStrength.toFixed(2))}
                    onDelta={(delta) => setSmoothStrength((current) => Math.min(1, Math.max(0, current + delta)))}
                    onScrubValue={(next) => setSmoothStrength(Math.min(1, Math.max(0, next)))}
                    stepSize={0.02}
                  />
                </>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>

      <footer className={styles.transportBar}>
        <div className={styles.transportLeft}>
          <button
            className={styles.transportChipButton}
            type="button"
            title="Auto-save is not implemented yet."
            disabled
          >
            Auto-save
          </button>
          <button className={styles.transportChipButton} type="button" title="Save is not implemented yet." disabled>
            Save
          </button>
        </div>
        <div className={styles.transportCenter}>
          <div className={styles.transportLauncherStrip}>
          <button
            className={styles.loopLauncherButton}
            type="button"
            title="Toggle loop playback. Shortcut: Numpad /."
            onClick={toggleLoopEnabled}
          >
            {loopEnabled ? "Loop" : "Once"}
          </button>
            <div className={styles.transportCluster} role="group" aria-label="Playback controls">
              <button
                className={`${styles.transportIconButton} ${styles.iconStop}`}
                type="button"
                aria-label="Stop"
                title="Stop playback."
                onClick={() => void writeAnimControlField("playback_state", 0)}
              >
                <span className={styles.iconStopGlyph}>⏹</span>
              </button>
              <button
                className={`${styles.transportIconButton} ${styles.iconPlayPause}`}
                type="button"
                aria-label={isPlaying ? "Pause" : "Play"}
                title={isPlaying ? "Pause playback. Shortcut: Space." : "Play playback. Shortcut: Space."}
                onClick={() => {
                  const nextPlaying = !isPlaying;
                  if (nextPlaying) {
                    void writeAnimControlField("playback_state", 2);
                    return;
                  }
                  void writeAnimControlField("playback_state", 1);
                }}
              >
                <span className={isPlaying ? styles.iconPauseGlyph : styles.iconPlayGlyph}>
                  {isPlaying ? "⏸" : "▶"}
                </span>
              </button>
              <button
                className={`${styles.transportIconButton} ${styles.iconRecord}`}
                type="button"
                aria-label="Record"
                title="Record playback."
                onClick={() => void writeAnimControlField("playback_state", 3)}
              >
                <span className={styles.iconRecordGlyph}>●</span>
              </button>
            </div>
            <div className={styles.transportNumericGroup}>
              <label className={styles.transportNumericField}>
                <span className={styles.transportNumericLabel}>Current</span>
                <input
                  type="number"
                  min={0}
                  max={durationSec}
                  step={0.1}
                  value={playheadSec.toFixed(2)}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    const clamped = Math.min(durationSec, Math.max(0, value));
                    setLocalScrubTimeSec(clamped);
                    void writeAnimControlField("time_override_sec", clamped);
                  }}
                />
              </label>
              <label className={styles.transportNumericField}>
                <span className={styles.transportNumericLabel}>Duration</span>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={durationSec.toFixed(2)}
                  readOnly
                />
              </label>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
