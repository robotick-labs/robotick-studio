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
import { useProjectContext } from "../../../data-sources/launcher/internal/ProjectContext";
import { buildUrl } from "../../../data-sources/launcher/internal/launcher-interface";
import { normalizedFromClientX } from "./playhead-math";
import styles from "./AnimationEditorPage.module.css";

type Point = { t: number; v: number };
type ClipRef = { name: string; animclipPath: string; durationSec?: number; channels?: string[] };
type ClipData = { name: string; channels: Record<string, Point[]>; durationSec: number };
type LaneRange = { min: number; max: number };
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
type AnimTelemetryClipPayload = {
  name?: string;
  duration_sec?: number;
  channels?: Array<{
    channel?: string;
    keys?: Array<{ time_sec?: number; value?: number }>;
  }>;
};
type AnimTelemetryClipResponse = {
  service_id: string;
  revision?: number;
  clip?: AnimTelemetryClipPayload;
};
type AnimTelemetrySampleResponse = {
  service_id: string;
  revision?: number;
  duration_sec?: number;
  channels?: Array<{
    channel?: string;
    samples?: Array<{ time_sec?: number; value?: number }>;
  }>;
};

const DEFAULT_ANIMSET = "content/animsets/barr_e_expression_mvp.animset.yaml";
const TOOL_SECTIONS = [
  { title: "Sculpting", items: ["Draw", "Smooth", "Flatten", "Push/Pull"] },
  { title: "Keying", items: ["Select", "Move", "Add Point", "Delete Point"] },
  { title: "Scaling", items: ["Scale", "Offset", "Ramp Up", "Ramp Down"] },
];

const TOOL_TIPS: Record<string, string> = {
  Draw: "Paint values across a time window toward the cursor path.",
  Smooth: "Reduce local jitter by smoothing points in the selected region.",
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

function clipRefsFromAnimsetResponse(response: AnimTelemetryAnimsetResponse): ClipRef[] {
  return (response.clips ?? []).map((clip) => ({
    name: clip.clip_name || clip.animclip_path || "clip",
    animclipPath: clip.animclip_path,
    durationSec: typeof clip.duration_sec === "number" ? clip.duration_sec : undefined,
    channels: Array.isArray(clip.channels) ? clip.channels.filter(Boolean) : undefined,
  }));
}

function clipDataFromTelemetryPayload(payload: AnimTelemetryClipPayload | undefined): ClipData {
  const channels: Record<string, Point[]> = {};
  let durationSec = 0;
  for (const channel of payload?.channels ?? []) {
    const channelName = String(channel?.channel ?? "").trim();
    if (!channelName) continue;
    const keys: Point[] = [];
    for (const key of channel?.keys ?? []) {
      const t = Number(key?.time_sec);
      const v = Number(key?.value);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      keys.push({ t, v });
      durationSec = Math.max(durationSec, t);
    }
    channels[channelName] = keys;
  }
  if (typeof payload?.duration_sec === "number" && Number.isFinite(payload.duration_sec)) {
    durationSec = Math.max(durationSec, payload.duration_sec);
  }
  return {
    name: String(payload?.name ?? "clip").trim() || "clip",
    channels,
    durationSec: Math.max(0.01, durationSec),
  };
}

function sampledCurvesFromTelemetryResponse(response: AnimTelemetrySampleResponse): Record<string, Point[]> {
  const out: Record<string, Point[]> = {};
  for (const channel of response.channels ?? []) {
    const channelName = String(channel?.channel ?? "").trim();
    if (!channelName) continue;
    const samples: Point[] = [];
    for (const sample of channel?.samples ?? []) {
      const t = Number(sample?.time_sec);
      const v = Number(sample?.value);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      samples.push({ t, v });
    }
    out[channelName] = samples;
  }
  return out;
}

function curvePath(points: Point[], durationSec: number, width: number, height: number, minV: number, maxV: number) {
  if (!points.length || durationSec <= 0) return "";
  const span = Math.max(1e-6, maxV - minV);
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = (p.t / durationSec) * width;
    const y = height - ((p.v - minV) / span) * height;
    d += `${i === 0 ? "M" : " L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

function areaPath(points: Point[], durationSec: number, width: number, height: number, minV: number, maxV: number) {
  if (!points.length || durationSec <= 0) return "";
  const span = Math.max(1e-6, maxV - minV);
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = (p.t / durationSec) * width;
    const y = height - ((p.v - minV) / span) * height;
    d += `${i === 0 ? "M" : " L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  const last = points[points.length - 1];
  const first = points[0];
  const xLast = (last.t / durationSec) * width;
  const xFirst = (first.t / durationSec) * width;
  d += ` L ${xLast.toFixed(2)} ${height.toFixed(2)} L ${xFirst.toFixed(2)} ${height.toFixed(2)} Z`;
  return d;
}

function fitRangeWithPadding(points: Point[]): LaneRange {
  if (!points.length) return { min: -1, max: 1 };
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
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
    return { min: quantMin - step, max: quantMax + step };
  }
  return { min: quantMin, max: quantMax };
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
  const launcherService = useLauncherService();
  const telemetryService = useTelemetryService();
  const { projectPath } = useProjectContext();
  const { projectModels } = ProjectData.use();
  const [playhead, setPlayhead] = React.useState(280);
  const [isPlaying, setIsPlaying] = React.useState(true);
  const [loopEnabled, setLoopEnabled] = React.useState(true);
  const [animCompatibleWorkloadTypes, setAnimCompatibleWorkloadTypes] = React.useState<Set<string>>(new Set());
  const [selectedSourceId, setSelectedSourceId] = React.useState("");
  const [animsetPath, setAnimsetPath] = React.useState(DEFAULT_ANIMSET);
  const [clipRefs, setClipRefs] = React.useState<ClipRef[]>([]);
  const [selectedClipPath, setSelectedClipPath] = React.useState("");
  const [clipData, setClipData] = React.useState<ClipData>({ name: "clip", channels: {}, durationSec: 10 });
  const [sampledCurvesByChannel, setSampledCurvesByChannel] = React.useState<Record<string, Point[]>>({});
  const [animTelemetryServiceId, setAnimTelemetryServiceId] = React.useState("");
  const [channelVisible, setChannelVisible] = React.useState<Record<string, boolean>>({});
  const [channelColor, setChannelColor] = React.useState<Record<string, string>>({});
  const [hoveredChannel, setHoveredChannel] = React.useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = React.useState<string | null>(null);
  const [laneRange, setLaneRange] = React.useState<Record<string, LaneRange>>({});
  const timelineRef = React.useRef<HTMLDivElement | null>(null);
  const playheadViewportRef = React.useRef<HTMLDivElement | null>(null);
  const firstLaneSvgRef = React.useRef<SVGSVGElement | null>(null);
  const [playheadViewportInsetsPx, setPlayheadViewportInsetsPx] = React.useState({ left: 77, right: 14 });
  const [localScrubTimeSec, setLocalScrubTimeSec] = React.useState<number | null>(null);
  const [pendingScrubAdoptSec, setPendingScrubAdoptSec] = React.useState<number | null>(null);
  const [pendingActiveClipIndex, setPendingActiveClipIndex] = React.useState<number | null>(null);
  const heldSuppressedAnimControlFieldsRef = React.useRef<Set<string>>(new Set());

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
      return parsed.length > 0 ? parsed[0].animclipPath : "";
    });
  }, [buildAnimServiceUrl]);

  React.useEffect(() => {
    let cancelled = false;
    async function discoverAnimService() {
      if (!telemetryBaseUrl) {
        setAnimTelemetryServiceId("");
        setClipRefs([]);
        setSampledCurvesByChannel({});
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
    async function loadClip() {
      if (!animTelemetryServiceId || !selectedClipPath) return;
      const selectedClip = clipRefs.find((clip) => clip.animclipPath === selectedClipPath) ?? null;
      const url = buildAnimServiceUrl("/clip", {
        clip_name: selectedClip?.name,
      });
      if (!url) return;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load clip: ${response.status}`);
      }
      const payload = (await response.json()) as AnimTelemetryClipResponse;
      const parsed = clipDataFromTelemetryPayload(payload.clip);
      if (cancelled) return;
      setClipData(parsed);
      setPlayhead((p) => Math.min(p, 1000));
      const names = Object.keys(parsed.channels);
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
          next[n] = fitRangeWithPadding(parsed.channels[n] ?? []);
        });
        return next;
      });
      setSelectedChannel((prev) => (prev && names.includes(prev) ? prev : names[0] ?? null));
    }
    void loadClip();
    return () => {
      cancelled = true;
    };
  }, [animTelemetryServiceId, buildAnimServiceUrl, clipRefs, selectedClipPath]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadSamples() {
      if (!animTelemetryServiceId || !selectedClipPath) {
        setSampledCurvesByChannel({});
        return;
      }
      const selectedClip = clipRefs.find((clip) => clip.animclipPath === selectedClipPath) ?? null;
      const url = buildAnimServiceUrl("/sample", {
        clip_name: selectedClip?.name,
        samples_per_channel: 256,
      });
      if (!url) return;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load sampled curves: ${response.status}`);
      }
      const payload = (await response.json()) as AnimTelemetrySampleResponse;
      if (cancelled) return;
      setSampledCurvesByChannel(sampledCurvesFromTelemetryResponse(payload));
    }
    void loadSamples();
    return () => {
      cancelled = true;
    };
  }, [animTelemetryServiceId, buildAnimServiceUrl, clipRefs, selectedClipPath]);

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

  React.useEffect(() => {
    if (!selectedWorkloadName) return;
    const runtimeAnimsetPath = readFieldValue(`${selectedWorkloadName}.config.animset_path`);
    if (typeof runtimeAnimsetPath === "string" && runtimeAnimsetPath.length > 0) {
      setAnimsetPath(runtimeAnimsetPath);
    }
  }, [readFieldValue, selectedWorkloadName]);

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
  const recordedSampleCountRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.recorded_sample_count`)
    : null;
  const lastRecordedClipPathRaw = selectedWorkloadName
    ? readFieldValue(`${selectedWorkloadName}.outputs.anim_state.last_recorded_clip_path`)
    : null;

  const channelNames = Object.keys(clipData.channels);
  const visibleChannels = channelNames.filter((n) => channelVisible[n] !== false);
  const allChannelsVisible = channelNames.length > 0 && visibleChannels.length === channelNames.length;
  const durationSec = Math.max(0.01, clipData.durationSec);
  const runtimePlayheadSec = typeof playheadTimeRaw === "number" ? Math.max(0, playheadTimeRaw) : null;
  const playheadSec = localScrubTimeSec ?? runtimePlayheadSec ?? (playhead / 1000) * durationSec;
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
  const recordedSampleCount = typeof recordedSampleCountRaw === "number" ? recordedSampleCountRaw : null;
  const lastRecordedClipPath = typeof lastRecordedClipPathRaw === "string" ? lastRecordedClipPathRaw : "";
  const animsetOptions = React.useMemo(() => Array.from(new Set([animsetPath, DEFAULT_ANIMSET].filter(Boolean))), [animsetPath]);

  React.useEffect(() => {
    if (localScrubTimeSec !== null || playheadSec === null || durationSec <= 0) return;
    const ratio = Math.min(1, Math.max(0, playheadSec / durationSec));
    setPlayhead(Math.round(ratio * 1000));
  }, [durationSec, localScrubTimeSec, playheadSec]);

  React.useEffect(() => {
    if (pendingScrubAdoptSec === null || runtimePlayheadSec === null) return;
    if (Math.abs(runtimePlayheadSec - pendingScrubAdoptSec) <= 0.02) {
      setPendingScrubAdoptSec(null);
      setLocalScrubTimeSec(null);
    }
  }, [pendingScrubAdoptSec, runtimePlayheadSec]);

  React.useEffect(() => {
    if (playbackState === null) return;
    setIsPlaying(playbackState === 2 || playbackState === 3);
  }, [playbackState]);

  React.useEffect(() => {
    if (!selectedWorkloadName) return;
    const loopValue = readFieldValue(`${selectedWorkloadName}.inputs.anim_controls.loop`);
    if (typeof loopValue === "boolean") {
      setLoopEnabled(loopValue);
    }
  }, [readFieldValue, selectedWorkloadName]);

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
    const laneSvg = firstLaneSvgRef.current;
    if (!timeline || !laneSvg) return;

    const measure = () => {
      const timelineRect = timeline.getBoundingClientRect();
      const laneRect = laneSvg.getBoundingClientRect();
      const left = Math.max(0, laneRect.left - timelineRect.left);
      const right = Math.max(0, timelineRect.right - laneRect.right);
      setPlayheadViewportInsetsPx({ left, right });
    };

    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(timeline);
    observer.observe(laneSvg);
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
    setPlayhead(Math.round(ratio * 1000));
    setLocalScrubTimeSec(ratio * durationSec);
    return ratio;
  }

  function beginPlayheadDrag(event: React.PointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startRatio = seekFromClientX(event.clientX);
    void beginScrubSession();
    const startTimeSec = (startRatio ?? Math.min(1, Math.max(0, playhead / 1000))) * durationSec;
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
  }

  function formatAxisValue(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 10) return value.toFixed(1);
    if (abs >= 1) return value.toFixed(2);
    return value.toFixed(3);
  }

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
            <div className={styles.metaLine}>Read-only</div>
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

        <main className={styles.timelineArea}>
          <section ref={timelineRef} className={styles.timelineCanvas} aria-label="Animation timeline">
            <div className={styles.timeRuler}>
              <div className={styles.loopResetRuler} aria-hidden="true">
                {isLoopResetActive ? (
                  <div
                    className={styles.loopResetSlug}
                    style={{
                      left: `${Math.max(0, Math.min(100, loopResetSlugRangeNorm.left * 100))}%`,
                      right: `${Math.max(0, Math.min(100, (1 - loopResetSlugRangeNorm.right) * 100))}%`,
                    }}
                  />
                ) : null}
              </div>
              <span className={styles.rulerMark}>0.0s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.2).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.4).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.6).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.8).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{durationSec.toFixed(1)}s</span>
            </div>
            <div className={styles.lanes}>
              {visibleChannels.map((channel) => {
                const points = clipData.channels[channel] ?? [];
                const sampledPoints = sampledCurvesByChannel[channel] ?? [];
                const range = laneRange[channel] ?? fitRangeWithPadding(points);
                const minV = range.min;
                const maxV = range.max;
                return (
                  <div
                    key={channel}
                    className={[
                      styles.laneRow,
                      hoveredChannel === channel ? styles.laneRowHovered : "",
                      selectedChannel === channel ? styles.laneRowSelected : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseEnter={() => setHoveredChannel(channel)}
                    onMouseLeave={() => setHoveredChannel((prev) => (prev === channel ? null : prev))}
                    onClick={() => setSelectedChannel(channel)}
                  >
                    <div className={styles.laneAxis}>
                      <input
                        className={styles.laneAxisInput}
                        value={formatAxisValue(maxV)}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value)) return;
                          setLaneRange((prev) => {
                            const current = prev[channel] ?? { min: minV, max: maxV };
                            if (value <= current.min) return prev;
                            return { ...prev, [channel]: { ...current, max: value } };
                          });
                        }}
                        title="Channel Y max"
                      />
                      <input
                        className={styles.laneAxisInput}
                        value={formatAxisValue(minV)}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value)) return;
                          setLaneRange((prev) => {
                            const current = prev[channel] ?? { min: minV, max: maxV };
                            if (value >= current.max) return prev;
                            return { ...prev, [channel]: { ...current, min: value } };
                          });
                        }}
                        title="Channel Y min"
                      />
                    </div>
                    <div className={styles.laneTrack}>
                      <div className={styles.laneChannelOverlay}>{channel}</div>
                      <button
                        className={styles.laneFitButton}
                        type="button"
                        title="Fit Y for this channel"
                        onClick={() =>
                          setLaneRange((prev) => ({
                            ...prev,
                            [channel]: fitRangeWithPadding(points),
                          }))
                        }
                      >
                        Fit Y
                      </button>
                      <svg
                        ref={visibleChannels[0] === channel ? firstLaneSvgRef : undefined}
                        className={styles.laneSvg}
                        viewBox="0 0 1000 40"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path
                          d={areaPath(sampledPoints, durationSec, 1000, 34, minV, maxV)}
                          className={styles.laneArea}
                          style={{ fill: channelColor[channel] ?? "#77ceff" }}
                        />
                        <path
                          d={curvePath(sampledPoints, durationSec, 1000, 34, minV, maxV)}
                          className={styles.laneCurve}
                          style={{ stroke: channelColor[channel] ?? "#77ceff" }}
                        />
                      </svg>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={styles.timeRulerBottom}>
              <span className={styles.rulerMark}>0.0s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.2).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.4).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.6).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.8).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{durationSec.toFixed(1)}s</span>
            </div>
            <div
              ref={playheadViewportRef}
              className={styles.playheadViewport}
              style={{
                left: `${playheadViewportInsetsPx.left}px`,
                right: `${playheadViewportInsetsPx.right}px`,
              }}
            >
              <div className={styles.rulerBottomPip} style={{ left: `${playhead / 10}%` }} />
              <div className={styles.playhead} style={{ left: `${playhead / 10}%` }}>
                <button
                  className={styles.playheadGrab}
                  type="button"
                  onPointerDown={beginPlayheadDrag}
                  title="Drag playhead"
                  aria-label="Drag playhead"
                />
                <div className={styles.playheadPip} />
              </div>
            </div>
          </section>
        </main>

        <aside className={styles.tools}>
          {TOOL_SECTIONS.map((section) => (
            <section key={section.title} className={styles.panelCard}>
              <h3>{section.title}</h3>
              <div className={styles.toolButtons}>
                {section.items.map((item) => (
                  <button
                    key={item}
                    className={styles.toolButton}
                    type="button"
                    title={`${item} is not implemented yet.`}
                    disabled
                  >
                    {/*
                      Tooltips are explicit per tool so behavior intent remains clear
                      while this remains a mock-up.
                    */}
                    <span title={TOOL_TIPS[item] ?? `Activate ${item} tool`}>{item}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
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
            title="Toggle loop playback."
            onClick={() => void writeAnimControlField("loop", !loopEnabled)}
          >
            {loopEnabled ? "Loop" : "Once"}
          </button>
            <div className={styles.transportCluster} role="group" aria-label="Playback controls">
              <button
                className={`${styles.transportIconButton} ${styles.iconStop}`}
                type="button"
                aria-label="Stop"
                onClick={() => void writeAnimControlField("playback_state", 0)}
              >
                <span className={styles.iconStopGlyph}>⏹</span>
              </button>
              <button
                className={`${styles.transportIconButton} ${styles.iconPlayPause}`}
                type="button"
                aria-label={isPlaying ? "Pause" : "Play"}
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
                    setPlayhead(Math.round((clamped / durationSec) * 1000));
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
