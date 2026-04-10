// viewer-streaming-image.ts

import type { ViewerConfig } from "../viewer-schema";
import {
  subscribeTelemetry,
  ITelemetryModel,
} from "../../../data-sources/telemetry";
import { ProjectData } from "../../../data-sources/launcher";
import { summarizeCadence } from "./streaming-image-metrics";

interface StreamingImageViewerConfig extends ViewerConfig {
  sourceModel?: string; // legacy
  modelName?: string;
  telemetryModelName?: string;
  sourceField?: string;
  telemetryBaseUrl?: string;
  samplingRateHz?: number;
  telemetryMetricsEnabled?: boolean;
  telemetryMetricsWindowMs?: number;
  frameStallTimeoutMs?: number;
}

const BLACK_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
const DEFAULT_METRICS_WINDOW_MS = 60_000;
const DEFAULT_FRAME_STALL_TIMEOUT_MS = 2_500;
const MAX_METRICS_HISTORY = 20;

let telemetryDispose: (() => void) | null = null;
let lastFrameBlobUrl: string | null = null;
let activeImg: HTMLImageElement | null = null;
let viewerContainerElement: HTMLElement | null = null;
let renderLoopRafId: number | null = null;
let pendingFrame: PendingFrame | null = null;
let metricsWindow: MetricsWindow | null = null;
let metricsEnabled = true;
let metricsWindowMs = DEFAULT_METRICS_WINDOW_MS;
let frameStallTimeoutMs = DEFAULT_FRAME_STALL_TIMEOUT_MS;
let metricsSourceLabel = "";
let lastFrameReceivedAtMs = 0;
let lastFramePresentedAtMs = 0;
let stallStateActive = false;

type PendingFrame = {
  mime: string;
  buffer: ArrayBuffer;
  receivedAtMs: number;
};

type MetricsWindow = {
  startedAtMs: number;
  receivedFrames: number;
  presentedFrames: number;
  supersededFrames: number;
  transportErrors: number;
  stallEvents: number;
  intervalsMs: number[];
};

type StreamingImageMetricsSummary = {
  source: string;
  startedAtMs: number;
  endedAtMs: number;
  windowMs: number;
  receivedFrames: number;
  presentedFrames: number;
  supersededFrames: number;
  transportErrors: number;
  stallEvents: number;
  cadence: ReturnType<typeof summarizeCadence>;
};

function createMetricsWindow(startedAtMs: number): MetricsWindow {
  return {
    startedAtMs,
    receivedFrames: 0,
    presentedFrames: 0,
    supersededFrames: 0,
    transportErrors: 0,
    stallEvents: 0,
    intervalsMs: [],
  };
}

function resetRuntimeState() {
  pendingFrame = null;
  metricsWindow = null;
  metricsSourceLabel = "";
  lastFrameReceivedAtMs = 0;
  lastFramePresentedAtMs = 0;
  stallStateActive = false;
  if (renderLoopRafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(renderLoopRafId);
    renderLoopRafId = null;
  }
}

function publishMetricsSummary(summary: StreamingImageMetricsSummary) {
  const globalHost = globalThis as typeof globalThis & {
    __robotickTelemetryMetrics?: StreamingImageMetricsSummary[];
  };
  const existing = Array.isArray(globalHost.__robotickTelemetryMetrics)
    ? globalHost.__robotickTelemetryMetrics
    : [];
  const nextHistory = [...existing, summary];
  globalHost.__robotickTelemetryMetrics = nextHistory.slice(
    Math.max(0, nextHistory.length - MAX_METRICS_HISTORY)
  );
}

function flushMetricsWindow(nowMs: number, force = false) {
  if (!metricsEnabled || !metricsWindow) {
    return;
  }
  const windowAge = nowMs - metricsWindow.startedAtMs;
  if (!force && windowAge < metricsWindowMs) {
    return;
  }

  const summary: StreamingImageMetricsSummary = {
    source: metricsSourceLabel,
    startedAtMs: metricsWindow.startedAtMs,
    endedAtMs: nowMs,
    windowMs: Math.max(0, windowAge),
    receivedFrames: metricsWindow.receivedFrames,
    presentedFrames: metricsWindow.presentedFrames,
    supersededFrames: metricsWindow.supersededFrames,
    transportErrors: metricsWindow.transportErrors,
    stallEvents: metricsWindow.stallEvents,
    cadence: summarizeCadence(metricsWindow.intervalsMs),
  };

  console.info("[streaming-image][metrics]", summary);
  publishMetricsSummary(summary);
  metricsWindow = createMetricsWindow(nowMs);
}

function queueFrame(mime: string, buffer: ArrayBuffer, receivedAtMs: number) {
  if (pendingFrame && metricsWindow) {
    metricsWindow.supersededFrames += 1;
  }
  pendingFrame = {
    mime,
    buffer,
    receivedAtMs,
  };
  lastFrameReceivedAtMs = receivedAtMs;
  stallStateActive = false;
  if (metricsWindow) {
    metricsWindow.receivedFrames += 1;
  }
}

function presentPendingFrame(nowMs: number) {
  if (!activeImg || !pendingFrame) {
    return;
  }

  const frame = pendingFrame;
  pendingFrame = null;
  const blob = new Blob([frame.buffer], { type: frame.mime });
  const blobUrl = URL.createObjectURL(blob);
  activeImg.src = blobUrl;
  if (lastFrameBlobUrl) {
    URL.revokeObjectURL(lastFrameBlobUrl);
  }
  lastFrameBlobUrl = blobUrl;

  if (metricsWindow) {
    if (lastFramePresentedAtMs > 0) {
      metricsWindow.intervalsMs.push(nowMs - lastFramePresentedAtMs);
    }
    metricsWindow.presentedFrames += 1;
  }
  lastFramePresentedAtMs = nowMs;
}

function noteTransportError() {
  if (metricsWindow) {
    metricsWindow.transportErrors += 1;
  }
}

function maybeHandleStall(nowMs: number) {
  if (!activeImg || frameStallTimeoutMs <= 0 || pendingFrame) {
    return;
  }
  const lastActivityAtMs = Math.max(lastFrameReceivedAtMs, lastFramePresentedAtMs);
  if (lastActivityAtMs <= 0) {
    return;
  }

  const isStalled = nowMs - lastActivityAtMs >= frameStallTimeoutMs;
  if (!isStalled || stallStateActive) {
    return;
  }

  stallStateActive = true;
  if (metricsWindow) {
    metricsWindow.stallEvents += 1;
  }
  setBlackFrame();
}

function runRenderLoop() {
  renderLoopRafId = null;
  const nowMs = Date.now();
  presentPendingFrame(nowMs);
  maybeHandleStall(nowMs);
  flushMetricsWindow(nowMs);
  if (activeImg && typeof requestAnimationFrame === "function") {
    renderLoopRafId = requestAnimationFrame(runRenderLoop);
  }
}

function startRenderLoop() {
  if (renderLoopRafId !== null || typeof requestAnimationFrame !== "function") {
    return;
  }
  renderLoopRafId = requestAnimationFrame(runRenderLoop);
}

export async function init(viewerConfig: ViewerConfig, instanceId?: number): Promise<void> {
  resetRuntimeState();
  console.log("Streaming Image Viewer initialized", viewerConfig);

  const viewerContainer =
    (viewerConfig.container instanceof HTMLElement
      ? viewerConfig.container
      : document.getElementById("viewer-container")) ?? null;
  if (!viewerContainer) {
    console.warn("No viewer container element found");
    return;
  }
  viewerContainerElement = viewerContainer;

  const cameraImg = document.createElement("img");
  cameraImg.id = "camera-stream";
  cameraImg.src = BLACK_PIXEL;
  viewerContainer.appendChild(cameraImg);
  activeImg = cameraImg;

  const streamingConfig = viewerConfig as StreamingImageViewerConfig;
  const fieldPath = streamingConfig.sourceField?.trim();
  if (!fieldPath) {
    console.warn(
      "[streaming-image] Missing sourceField in viewer configuration"
    );
    return;
  }

  const telemetryBase = await resolveTelemetryBaseUrl(streamingConfig);
  if (!telemetryBase) {
    console.warn(
      "[streaming-image] Unable to resolve telemetry base URL for viewer"
    );
    setBlackFrame();
    return;
  }

  const samplingRateHz = streamingConfig.samplingRateHz ?? 20;
  metricsEnabled = streamingConfig.telemetryMetricsEnabled ?? true;
  metricsWindowMs = Math.max(
    5_000,
    Math.floor(streamingConfig.telemetryMetricsWindowMs ?? DEFAULT_METRICS_WINDOW_MS)
  );
  frameStallTimeoutMs = Math.max(
    250,
    Math.floor(streamingConfig.frameStallTimeoutMs ?? DEFAULT_FRAME_STALL_TIMEOUT_MS)
  );
  metricsSourceLabel = `${telemetryBase} :: ${fieldPath}`;
  metricsWindow = metricsEnabled ? createMetricsWindow(Date.now()) : null;
  startRenderLoop();

  console.info(
    `[streaming-image] Subscribing to telemetry ${telemetryBase} field ${fieldPath} @ ${samplingRateHz}Hz`
  );
  telemetryDispose = subscribeTelemetry(telemetryBase, samplingRateHz, {
    callback: (model) => handleTelemetryFrame(model, fieldPath),
    error: (err) => {
      console.warn(
        `[streaming-image] Telemetry error for ${telemetryBase} (${fieldPath})`,
        err
      );
      noteTransportError();
    },
  });
}

export async function uninit(instanceId?: number): Promise<void> {
  flushMetricsWindow(Date.now(), true);
  telemetryDispose?.();
  telemetryDispose = null;
  if (lastFrameBlobUrl) {
    URL.revokeObjectURL(lastFrameBlobUrl);
    lastFrameBlobUrl = null;
  }
  activeImg = null;
  resetRuntimeState();
  if (viewerContainerElement) {
    viewerContainerElement.innerHTML = "";
    viewerContainerElement = null;
  }
  console.log("Streaming Image Viewer unmounted");
}

/**
 * Updates the active viewer image from a telemetry field's byte payload or resets to a black frame when unavailable.
 *
 * Reads the telemetry field at `fieldPath` from `model`. If the field contains a `Uint8Array` image payload, the function sets the viewer's image source to that payload using the field's `mime_type` when present (defaults to `image/jpeg`) and revokes the previous frame URL. If the field is missing or does not contain a `Uint8Array`, the viewer is set to a black placeholder.
 *
 * @param model - Telemetry model to read the field from
 * @param fieldPath - Path to the telemetry field containing the image bytes
 */
function handleTelemetryFrame(model: ITelemetryModel, fieldPath: string) {
  if (!activeImg) {
    return;
  }
  const field = model.getField?.(fieldPath);
  if (!field) {
    return;
  }
  const value = field.getValue?.();
  if (!(value instanceof Uint8Array)) {
    return;
  }

  const mime = field.mime_type || "image/jpeg";
  const buffer = value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength
  ) as ArrayBuffer;
  queueFrame(mime, buffer, Date.now());
}

function setBlackFrame() {
  if (!activeImg) return;
  if (activeImg.src !== BLACK_PIXEL) {
    activeImg.src = BLACK_PIXEL;
  }
  if (lastFrameBlobUrl) {
    URL.revokeObjectURL(lastFrameBlobUrl);
    lastFrameBlobUrl = null;
  }
}

async function resolveTelemetryBaseUrl(
  config: StreamingImageViewerConfig
): Promise<string | null> {
  const direct = config.telemetryBaseUrl?.trim();
  if (direct) return direct;

  const sourceModelName =
    config.telemetryModelName?.trim() ??
    config.modelName?.trim() ??
    config.sourceModel?.trim();
  if (!sourceModelName) return null;

  try {
    const state = await ProjectData.waitForProjectModelsLoaded();
    const match = ProjectData.findModelDescriptorInState(
      state,
      sourceModelName
    );
    if (!match) {
      if (state.error) {
        console.warn(
          `[streaming-image] Unable to resolve telemetry model due to error: ${state.error}`
        );
      } else {
        const available = state.data.map((m) => m.modelShortName).join(", ");
        console.warn(
          `[streaming-image] Model "${sourceModelName}" not found. Available models: ${available}`
        );
      }
    } else {
      console.info(
        `[streaming-image] Using telemetry source "${match.modelName}" at ${match.telemetryBaseUrl}`
      );
    }
    return match?.telemetryBaseUrl ?? null;
  } catch (err) {
    console.warn(
      "[streaming-image] Failed to resolve telemetry base URL from model",
      err
    );
    return null;
  }
}

export default { init, uninit };
