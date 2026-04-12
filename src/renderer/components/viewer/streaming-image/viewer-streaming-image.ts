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
  maxPresentRateHz?: number;
  surfaceRecycleIntervalMs?: number;
  telemetryMetricsEnabled?: boolean;
  telemetryMetricsWindowMs?: number;
  frameStallTimeoutMs?: number;
}

const DEFAULT_METRICS_WINDOW_MS = 60_000;
const DEFAULT_FRAME_STALL_TIMEOUT_MS = 2_500;
const MAX_METRICS_HISTORY = 20;
const DEFAULT_MAX_PRESENT_RATE_HZ = 6;
const DEFAULT_SURFACE_RECYCLE_INTERVAL_MS = 30_000;

let telemetryDispose: (() => void) | null = null;
let activeCanvas: HTMLCanvasElement | null = null;
let activeCanvasContext: CanvasRenderingContext2D | null = null;
let viewerContainerElement: HTMLElement | null = null;
let decodeInFlight = false;
let monitorIntervalId: number | null = null;
let presentTimerId: number | null = null;
let pendingFrame: PendingFrame | null = null;
let metricsWindow: MetricsWindow | null = null;
let metricsEnabled = true;
let metricsWindowMs = DEFAULT_METRICS_WINDOW_MS;
let frameStallTimeoutMs = DEFAULT_FRAME_STALL_TIMEOUT_MS;
let maxPresentIntervalMs = Math.floor(1000 / DEFAULT_MAX_PRESENT_RATE_HZ);
let surfaceRecycleIntervalMs = DEFAULT_SURFACE_RECYCLE_INTERVAL_MS;
let metricsSourceLabel = "";
let lastFrameReceivedAtMs = 0;
let lastFramePresentedAtMs = 0;
let stallStateActive = false;
let viewerSessionId = 0;
let surfaceCreatedAtMs = 0;

type PendingFrame = {
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
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
  decodeInFlight = false;
  surfaceCreatedAtMs = 0;
  if (monitorIntervalId !== null && typeof clearInterval === "function") {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
  }
  if (presentTimerId !== null && typeof clearTimeout === "function") {
    clearTimeout(presentTimerId);
    presentTimerId = null;
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

function queueFrame(
  mime: string,
  bytes: Uint8Array<ArrayBuffer>,
  receivedAtMs: number
) {
  if (pendingFrame && metricsWindow) {
    metricsWindow.supersededFrames += 1;
  }
  pendingFrame = {
    mime,
    bytes,
    receivedAtMs,
  };
  lastFrameReceivedAtMs = receivedAtMs;
  stallStateActive = false;
  if (metricsWindow) {
    metricsWindow.receivedFrames += 1;
  }
  schedulePendingFramePresentation();
}

function schedulePendingFramePresentation() {
  if (!pendingFrame || decodeInFlight) {
    return;
  }
  if (presentTimerId !== null) {
    return;
  }

  const elapsedMs =
    lastFramePresentedAtMs > 0
      ? Date.now() - lastFramePresentedAtMs
      : maxPresentIntervalMs;
  const delayMs = Math.max(0, maxPresentIntervalMs - elapsedMs);
  presentTimerId = window.setTimeout(() => {
    presentTimerId = null;
    void presentPendingFrame();
  }, delayMs);
}

async function presentPendingFrame() {
  if (
    !activeCanvas ||
    !activeCanvasContext ||
    !pendingFrame ||
    decodeInFlight ||
    typeof createImageBitmap !== "function"
  ) {
    return;
  }

  const frame = pendingFrame;
  pendingFrame = null;
  const sessionId = viewerSessionId;
  decodeInFlight = true;

  try {
    const safeBytes = sanitizeImageBytes(frame.mime, frame.bytes);
    if (!safeBytes) {
      noteTransportError();
      return;
    }
    const blob = new Blob([safeBytes], { type: frame.mime });
    const bitmap = await createImageBitmap(blob);
    try {
      if (
        sessionId !== viewerSessionId ||
        !activeCanvas ||
        !activeCanvasContext
      ) {
        return;
      }

      if (
        activeCanvas.width !== bitmap.width ||
        activeCanvas.height !== bitmap.height
      ) {
        activeCanvas.width = bitmap.width;
        activeCanvas.height = bitmap.height;
      }

      activeCanvasContext.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
      activeCanvasContext.drawImage(bitmap, 0, 0);

      if (metricsWindow) {
        if (lastFramePresentedAtMs > 0) {
          metricsWindow.intervalsMs.push(frame.receivedAtMs - lastFramePresentedAtMs);
        }
        metricsWindow.presentedFrames += 1;
      }
      lastFramePresentedAtMs = frame.receivedAtMs;
    } finally {
      bitmap.close();
    }
  } catch (err) {
    console.warn("[streaming-image] Failed to decode frame", err);
    noteTransportError();
  } finally {
    decodeInFlight = false;
    if (pendingFrame) {
      schedulePendingFramePresentation();
    }
  }
}

function sanitizeImageBytes(
  mime: string,
  bytes: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> | null {
  if (!mime.toLowerCase().includes("jpeg")) {
    return bytes;
  }

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const finalIndex = bytes.length - 1;
  if (bytes[finalIndex - 1] === 0xff && bytes[finalIndex] === 0xd9) {
    return bytes;
  }

  for (let i = bytes.length - 2; i >= 0; i -= 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      return bytes.subarray(0, i + 2);
    }
  }

  return null;
}

function noteTransportError() {
  if (metricsWindow) {
    metricsWindow.transportErrors += 1;
  }
}

function maybeHandleStall(nowMs: number) {
  if (!activeCanvas || frameStallTimeoutMs <= 0 || pendingFrame || decodeInFlight) {
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

function maybeRecycleSurface(nowMs: number) {
  if (
    !viewerContainerElement ||
    !activeCanvas ||
    !activeCanvasContext ||
    decodeInFlight ||
    pendingFrame ||
    surfaceRecycleIntervalMs <= 0 ||
    lastFramePresentedAtMs <= 0 ||
    nowMs - surfaceCreatedAtMs < surfaceRecycleIntervalMs
  ) {
    return;
  }
  recreateCanvasSurface();
}

function startMonitorLoop() {
  if (monitorIntervalId !== null || typeof setInterval !== "function") {
    return;
  }
  monitorIntervalId = window.setInterval(() => {
    const nowMs = Date.now();
    maybeHandleStall(nowMs);
    maybeRecycleSurface(nowMs);
    flushMetricsWindow(nowMs);
  }, 250);
}

function recreateCanvasSurface() {
  if (!viewerContainerElement) {
    return false;
  }

  const nextCanvas = document.createElement("canvas");
  nextCanvas.id = "camera-stream";
  nextCanvas.style.width = "100%";
  nextCanvas.style.height = "100%";
  nextCanvas.style.display = "block";
  const nextContext = nextCanvas.getContext("2d", {
    alpha: false,
  });
  if (!nextContext) {
    return false;
  }

  const previousCanvas = activeCanvas;
  if (previousCanvas?.parentElement === viewerContainerElement) {
    previousCanvas.width = 1;
    previousCanvas.height = 1;
    viewerContainerElement.removeChild(previousCanvas);
  } else if (viewerContainerElement.firstChild) {
    viewerContainerElement.textContent = "";
  }

  viewerContainerElement.appendChild(nextCanvas);
  activeCanvas = nextCanvas;
  activeCanvasContext = nextContext;
  surfaceCreatedAtMs = Date.now();
  setBlackFrame();
  return true;
}

export async function init(viewerConfig: ViewerConfig): Promise<void> {
  resetRuntimeState();
  viewerSessionId += 1;
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
  if (!recreateCanvasSurface()) {
    console.warn("[streaming-image] Failed to acquire 2D canvas context");
    return;
  }

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

  const maxPresentRateHz = Math.max(
    1,
    Math.floor(
      streamingConfig.maxPresentRateHz ?? DEFAULT_MAX_PRESENT_RATE_HZ
    )
  );
  const requestedSamplingRateHz = streamingConfig.samplingRateHz ?? 20;
  const samplingRateHz = Math.min(requestedSamplingRateHz, maxPresentRateHz);
  metricsEnabled = streamingConfig.telemetryMetricsEnabled ?? true;
  metricsWindowMs = Math.max(
    5_000,
    Math.floor(streamingConfig.telemetryMetricsWindowMs ?? DEFAULT_METRICS_WINDOW_MS)
  );
  frameStallTimeoutMs = Math.max(
    250,
    Math.floor(streamingConfig.frameStallTimeoutMs ?? DEFAULT_FRAME_STALL_TIMEOUT_MS)
  );
  maxPresentIntervalMs = Math.max(16, Math.floor(1000 / maxPresentRateHz));
  surfaceRecycleIntervalMs = Math.max(
    0,
    Math.floor(
      streamingConfig.surfaceRecycleIntervalMs ??
        DEFAULT_SURFACE_RECYCLE_INTERVAL_MS
    )
  );
  metricsSourceLabel = `${telemetryBase} :: ${fieldPath}`;
  metricsWindow = metricsEnabled ? createMetricsWindow(Date.now()) : null;
  startMonitorLoop();

  console.info(
    `[streaming-image] Subscribing to telemetry ${telemetryBase} field ${fieldPath} @ ${samplingRateHz}Hz (requested ${requestedSamplingRateHz}Hz, presenting up to ${maxPresentRateHz}Hz)`
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

export async function uninit(): Promise<void> {
  flushMetricsWindow(Date.now(), true);
  telemetryDispose?.();
  telemetryDispose = null;
  viewerSessionId += 1;
  activeCanvas = null;
  activeCanvasContext = null;
  resetRuntimeState();
  if (viewerContainerElement) {
    viewerContainerElement.innerHTML = "";
    viewerContainerElement = null;
  }
  console.log("Streaming Image Viewer unmounted");
}

/**
 * Updates the active viewer canvas from a telemetry field's byte payload.
 *
 * Reads the telemetry field at `fieldPath` from `model`. If the field contains
 * a `Uint8Array` image payload, the function queues the latest bytes for
 * decode. If the field is missing or malformed, the viewer keeps its current
 * frame.
 *
 * @param model - Telemetry model to read the field from
 * @param fieldPath - Path to the telemetry field containing the image bytes
 */
function handleTelemetryFrame(model: ITelemetryModel, fieldPath: string) {
  if (!activeCanvas) {
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
  queueFrame(mime, value as Uint8Array<ArrayBuffer>, Date.now());
}

function setBlackFrame() {
  if (!activeCanvas || !activeCanvasContext) return;
  if (activeCanvas.width !== 1 || activeCanvas.height !== 1) {
    activeCanvas.width = 1;
    activeCanvas.height = 1;
  }
  activeCanvasContext.fillStyle = "#000";
  activeCanvasContext.fillRect(0, 0, 1, 1);
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
