export type ClipRef = { name: string; animclipPath: string; durationSec?: number; channels?: string[] };

export type ClipData = {
  name: string;
  channels: Record<string, Float32Array>;
  durationSec: number;
  loopResetDurationSec: number;
  sampleCount: number;
  liveSampleRateHz: number;
  clipRevision: string;
  dirty: boolean;
};

export type LaneRange = { min: number; max: number };

export type AnimTelemetryServiceDescriptor = {
  service_id: string;
  service_type: string;
  display_name: string;
  capabilities?: string[];
};

export type AnimTelemetryServicesResponse = {
  services?: AnimTelemetryServiceDescriptor[];
};

export type TelemetryWorkloadRef = {
  name: string;
};

export type AnimTelemetryAnimsetClip = {
  clip_index: number;
  clip_name: string;
  animclip_path: string;
  channelset_id?: string;
  loop_reset_duration_sec?: number;
  duration_sec?: number;
  channels?: string[];
};

export type AnimTelemetryAnimsetResponse = {
  service_id: string;
  anim_project_path?: string;
  animset_path: string;
  animset_options?: string[];
  channelset_path?: string;
  channelset_id?: string;
  animset_name?: string;
  animset_revision?: number;
  dirty?: boolean;
  clips?: AnimTelemetryAnimsetClip[];
};

export type AnimTelemetryClipIdentity = {
  anim_project_path?: string;
  channelset_path?: string;
  channelset_id?: string;
  animset_path?: string;
  clip_name?: string;
  animclip_path?: string;
};

export type AnimTelemetryClipResponse = {
  service_id: string;
  clip_identity?: AnimTelemetryClipIdentity;
  clip_revision?: string;
  anim_project_path?: string;
  animset_path?: string;
  channelset_path?: string;
  channelset_id?: string;
  loop_reset_duration_sec?: number;
  duration_sec?: number;
  dirty?: boolean;
  live_sample_rate_hz?: number;
  sample_count?: number;
  channels?: string[];
  channel_names?: string[];
};

export type AnimAuthoringActionResponse = {
  action?: string;
  service_id?: string;
  anim_project_path?: string;
  animset_path?: string;
  clip_index?: number;
  clip_identity?: {
    clip_name?: string;
    animclip_path?: string;
  };
};

export type AnimSaveResponse = {
  service_id?: string;
  saved_clip_count?: number;
  saved_metadata_count?: number;
  dirty?: boolean;
};

export type TimeSelectionRange = { startSec: number; endSec: number };

export type AnimLoadStatusLevel = "ok" | "warning" | "error";

export type AnimLoadStatus = {
  level: AnimLoadStatusLevel;
  message: string;
};

export type SaveUiState = "clean" | "dirty" | "saving" | "failed";
export type SaveButtonTone = "neutral" | "dirty" | "failed";
export type SaveButtonPresentation = {
  label: string;
  title: string;
  disabled: boolean;
  tone: SaveButtonTone;
  showDirtyDot: boolean;
};

export const DEFAULT_EMPTY_CLIP_DURATION_SEC = 1;

export function selectTelemetryWorkload(
  workloads: TelemetryWorkloadRef[] | undefined,
  preferredWorkloadName: string,
  fallbackWorkloadName: string
): TelemetryWorkloadRef | null {
  if (!workloads?.length) return null;
  const preferredNames = [preferredWorkloadName, fallbackWorkloadName].filter(
    (name, idx, arr) => name.length > 0 && arr.indexOf(name) === idx
  );
  for (const preferredName of preferredNames) {
    const match = workloads.find((workload) => workload.name === preferredName);
    if (match) return match;
  }
  return workloads[0] ?? null;
}

export function clipRefsFromAnimsetResponse(response: AnimTelemetryAnimsetResponse): ClipRef[] {
  return (response.clips ?? []).map((clip) => ({
    name: clip.clip_name || clip.animclip_path || "clip",
    animclipPath: clip.animclip_path,
    durationSec: typeof clip.duration_sec === "number" ? clip.duration_sec : undefined,
    channels: Array.isArray(clip.channels) ? clip.channels.filter(Boolean) : undefined,
  }));
}

export function clipDataFromTelemetryMetadata(payload: AnimTelemetryClipResponse | undefined): ClipData {
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
  const channelNames = Array.isArray(payload?.channels) && payload.channels.length > 0 ? payload.channels : payload?.channel_names ?? [];
  for (const channelName of channelNames) {
    const parsed = String(channelName ?? "").trim();
    if (!parsed) continue;
    channels[parsed] = new Float32Array(0);
  }
  return {
    name,
    channels,
    durationSec,
    loopResetDurationSec:
      typeof payload?.loop_reset_duration_sec === "number" && Number.isFinite(payload.loop_reset_duration_sec)
        ? Math.max(0.01, payload.loop_reset_duration_sec)
        : 1,
    sampleCount,
    liveSampleRateHz:
      typeof payload?.live_sample_rate_hz === "number" && Number.isFinite(payload.live_sample_rate_hz)
        ? payload.live_sample_rate_hz
        : 0,
    clipRevision: typeof payload?.clip_revision === "string" ? payload.clip_revision : "0",
    dirty: Boolean(payload?.dirty),
  };
}

export function labelFromAssetPath(path: string, suffix: string): string {
  const filename = path.split("/").pop() || path;
  return filename.endsWith(suffix) ? filename.slice(0, -suffix.length) : filename;
}

export function saveButtonPresentation(dirty: boolean, saveStatus: SaveUiState): SaveButtonPresentation {
  const label =
    saveStatus === "saving"
      ? "Saving..."
      : saveStatus === "failed"
        ? "Save Failed"
        : "Save";
  const title =
    saveStatus === "saving"
      ? "Saving animation changes."
      : dirty
        ? "Save dirty animation changes."
        : saveStatus === "failed"
          ? "Retry saving animation changes."
          : "No unsaved animation changes.";
  const disabled = saveStatus === "saving" || (!dirty && saveStatus !== "failed");
  const tone = saveStatus === "failed" ? "failed" : dirty ? "dirty" : "neutral";
  const showDirtyDot = dirty && saveStatus !== "saving" && saveStatus !== "failed";
  return { label, title, disabled, tone, showDirtyDot };
}
