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
  frameRateHz?: number;
  samplingRateHz?: number; // legacy
  maxPresentRateHz?: number; // legacy
  surfaceRecycleIntervalMs?: number;
  telemetryMetricsEnabled?: boolean;
  telemetryMetricsWindowMs?: number;
  frameStallTimeoutMs?: number;
}

const DEFAULT_METRICS_WINDOW_MS = 60_000;
const DEFAULT_FRAME_STALL_TIMEOUT_MS = 2_500;
const MAX_METRICS_HISTORY = 20;
const DEFAULT_FRAME_RATE_HZ = 30;
const DEFAULT_SURFACE_RECYCLE_INTERVAL_MS = 30_000;
const TELEMETRY_SAMPLING_MULTIPLIER = 4;

let telemetryDispose: (() => void) | null = null;
let activeCanvas: HTMLCanvasElement | null = null;
let activeCanvasContext: CanvasRenderingContext2D | null = null;
let viewerContainerElement: HTMLElement | null = null;
let statsOverlayElement: HTMLDivElement | null = null;
let decodeInFlight = false;
let monitorIntervalId: number | null = null;
let presentTimerId: number | null = null;
let pendingFrame: PendingFrame | null = null;
let metricsWindow: MetricsWindow | null = null;
let metricsEnabled = true;
let metricsWindowMs = DEFAULT_METRICS_WINDOW_MS;
let frameStallTimeoutMs = DEFAULT_FRAME_STALL_TIMEOUT_MS;
let maxPresentIntervalMs = Math.floor(1000 / DEFAULT_FRAME_RATE_HZ);
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

export function extractStreamingImageBytes(
  value: unknown
): Uint8Array<ArrayBuffer> | null {
  if (value instanceof Uint8Array) {
    return value as Uint8Array<ArrayBuffer>;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeCountedBytes = value as {
    data_buffer?: unknown;
    count?: unknown;
  };
  if (!(maybeCountedBytes.data_buffer instanceof Uint8Array)) {
    return null;
  }

  const raw = maybeCountedBytes.data_buffer as Uint8Array<ArrayBuffer>;
  if (
    typeof maybeCountedBytes.count !== "number" ||
    !Number.isFinite(maybeCountedBytes.count)
  ) {
    return raw;
  }

  const count = Math.max(
    0,
    Math.min(raw.byteLength, Math.trunc(maybeCountedBytes.count))
  );
  return count > 0 ? raw.subarray(0, count) as Uint8Array<ArrayBuffer> : null;
}

export function resolveStreamingImageMime(
  configuredMime: string | undefined,
  bytes: Uint8Array<ArrayBuffer>
): string {
  if (configuredMime?.trim()) {
    return configuredMime;
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }

  return "image/jpeg";
}

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
  publishDebugState();
}

function publishDebugState(extra: Record<string, unknown> = {}) {
  const globalHost = globalThis as typeof globalThis & {
    __robotickStreamingImageDebug?: Record<string, unknown>;
  };
  globalHost.__robotickStreamingImageDebug = {
    metricsEnabled,
    hasOverlay: Boolean(statsOverlayElement),
    hasCanvas: Boolean(activeCanvas),
    hasContainer: Boolean(viewerContainerElement),
    childCount: viewerContainerElement?.children.length ?? null,
    pendingFrame: Boolean(pendingFrame),
    decodeInFlight,
    monitorIntervalActive: monitorIntervalId !== null,
    presentTimerActive: presentTimerId !== null,
    lastFrameReceivedAtMs,
    lastFramePresentedAtMs,
    ...extra,
  };
}

function ensureStatsOverlay() {
  if (!viewerContainerElement || !metricsEnabled) {
    return;
  }
  if (
    statsOverlayElement &&
    statsOverlayElement.isConnected &&
    statsOverlayElement.parentElement === viewerContainerElement
  ) {
    return;
  }
  cleanupStatsOverlay();

  if (typeof window !== "undefined") {
    const computed = window.getComputedStyle(viewerContainerElement).position;
    if (!computed || computed === "static") {
      viewerContainerElement.style.position = "relative";
    }
  }

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "absolute",
    top: "8px",
    left: "8px",
    padding: "4px 8px",
    background: "rgba(0, 0, 0, 0.65)",
    color: "#f4f4f4",
    fontSize: "0.75rem",
    lineHeight: "1.2",
    borderRadius: "4px",
    pointerEvents: "none",
    zIndex: "999",
    whiteSpace: "pre",
    fontFamily: "Menlo, Consolas, monospace",
  });
  statsOverlayElement = overlay;
  viewerContainerElement.appendChild(overlay);
  publishDebugState({ overlayCreated: true });
}

function cleanupStatsOverlay() {
  if (statsOverlayElement?.parentElement) {
    statsOverlayElement.parentElement.removeChild(statsOverlayElement);
  }
  statsOverlayElement = null;
  publishDebugState({ overlayCreated: false });
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

  publishMetricsSummary(summary);
  metricsWindow = createMetricsWindow(nowMs);
}

function formatRateHz(count: number, windowMs: number): string {
  if (windowMs <= 0) {
    return "0.0";
  }
  return ((count * 1000) / windowMs).toFixed(1);
}

function updateStatsOverlay(nowMs: number) {
  if (!metricsEnabled || !statsOverlayElement || !metricsWindow) {
    publishDebugState({ updateSkippedAtMs: nowMs });
    return;
  }

  const windowMs = Math.max(1, nowMs - metricsWindow.startedAtMs);
  const receiveRateHz = formatRateHz(metricsWindow.receivedFrames, windowMs);
  const presentRateHz = formatRateHz(metricsWindow.presentedFrames, windowMs);
  const cadence = summarizeCadence(metricsWindow.intervalsMs);
  const cadenceLine =
    cadence.sampleCount > 0
      ? `Cadence: avg ${cadence.averageMs.toFixed(0)} ms  p50 ${
          cadence.p50Ms?.toFixed(0) ?? "-"
        }  p95 ${cadence.p95Ms?.toFixed(0) ?? "-"}`
      : "Cadence: –";
  statsOverlayElement.textContent =
    `Receive: ${receiveRateHz} Hz\n` +
    `Present: ${presentRateHz} Hz\n` +
    `${cadenceLine}\n` +
    `Drop: ${metricsWindow.supersededFrames}  Stall: ${metricsWindow.stallEvents}  Err: ${metricsWindow.transportErrors}`;
  publishDebugState({
    updateAtMs: nowMs,
    receiveRateHz,
    presentRateHz,
    cadenceSamples: cadence.sampleCount,
  });
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
    if (
      metricsEnabled &&
      (!statsOverlayElement ||
        !statsOverlayElement.isConnected ||
        statsOverlayElement.parentElement !== viewerContainerElement)
    ) {
      ensureStatsOverlay();
    }
    maybeHandleStall(nowMs);
    maybeRecycleSurface(nowMs);
    updateStatsOverlay(nowMs);
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
    cleanupStatsOverlay();
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
  if (metricsEnabled) {
    ensureStatsOverlay();
  } else {
    cleanupStatsOverlay();
  }
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

  const legacyFrameRateHz =
    streamingConfig.maxPresentRateHz ?? streamingConfig.samplingRateHz;
  const frameRateHz = Math.max(
    1,
    Math.floor(streamingConfig.frameRateHz ?? legacyFrameRateHz ?? DEFAULT_FRAME_RATE_HZ)
  );
  const telemetrySamplingRateHz = Math.max(
    frameRateHz,
    Math.ceil(frameRateHz * TELEMETRY_SAMPLING_MULTIPLIER)
  );
  metricsEnabled = streamingConfig.telemetryMetricsEnabled ?? true;
  metricsWindowMs = Math.max(
    5_000,
    Math.floor(streamingConfig.telemetryMetricsWindowMs ?? DEFAULT_METRICS_WINDOW_MS)
  );
  frameStallTimeoutMs = Math.max(
    250,
    Math.floor(streamingConfig.frameStallTimeoutMs ?? DEFAULT_FRAME_STALL_TIMEOUT_MS)
  );
  maxPresentIntervalMs = Math.max(16, Math.floor(1000 / frameRateHz));
  surfaceRecycleIntervalMs = Math.max(
    0,
    Math.floor(
      streamingConfig.surfaceRecycleIntervalMs ??
        DEFAULT_SURFACE_RECYCLE_INTERVAL_MS
    )
  );
  metricsSourceLabel = `${telemetryBase} :: ${fieldPath}`;
  metricsWindow = metricsEnabled ? createMetricsWindow(Date.now()) : null;
  publishDebugState({
    telemetryBase,
    fieldPath,
    frameRateHz,
    telemetrySamplingRateHz,
  });
  if (metricsEnabled) {
    ensureStatsOverlay();
    updateStatsOverlay(Date.now());
  } else {
    cleanupStatsOverlay();
  }
  startMonitorLoop();

  console.info(
    `[streaming-image] Subscribing to telemetry ${telemetryBase} field ${fieldPath} @ ${telemetrySamplingRateHz}Hz, presenting @ ${frameRateHz}Hz`
  );
  telemetryDispose = subscribeTelemetry(telemetryBase, telemetrySamplingRateHz, {
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
  cleanupStatsOverlay();
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
 * a `Uint8Array` image payload or a `{ data_buffer, count }` dynamic byte
 * struct, the function queues the latest bytes for decode. If the field is
 * missing or malformed, the viewer keeps its current frame.
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
  const bytes = extractStreamingImageBytes(value);
  if (!bytes) {
    return;
  }

  const mime = resolveStreamingImageMime(field.mime_type, bytes);
  queueFrame(mime, bytes, Date.now());
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
