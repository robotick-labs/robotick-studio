// viewer-streaming-image.ts

import type { ViewerConfig } from "../viewer-schema";
import { decode as decodePng } from "fast-png";
import {
  subscribeTelemetry,
  ITelemetryModel,
} from "../../../data-sources/telemetry";
import { ProjectData } from "../../../data-sources/launcher";
import {
  buildNamespacedKey,
  readStorageValue,
  setStorageValue,
} from "../../../services/storage";
import { summarizeCadence } from "./streaming-image-metrics";

interface StreamingImageViewerConfig extends ViewerConfig {
  sourceModel?: string; // legacy
  modelName?: string;
  telemetryModelName?: string;
  sourceField?: string;
  telemetryBaseUrl?: string;
  selectedStream?: string;
  streams?: Record<string, unknown>;
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
let streamSelectorContainerElement: HTMLLabelElement | null = null;
let streamSelectorElement: HTMLSelectElement | null = null;
let activeStreamingConfig: StreamingImageViewerConfig | null = null;
let activeStreamSources: StreamingImageSource[] = [];
let activeSelectedStreamStorageKey: string | null = null;
let decodeInFlight = false;
let monitorIntervalId: number | null = null;
let presentTimerId: number | null = null;
let pendingFrame: PendingFrame | null = null;
let metricsWindow: MetricsWindow | null = null;
let metricsEnabled = true;
let metricsWindowMs = DEFAULT_METRICS_WINDOW_MS;
let frameStallTimeoutMs = DEFAULT_FRAME_STALL_TIMEOUT_MS;
let maxPresentIntervalMs = Math.floor(1000 / DEFAULT_FRAME_RATE_HZ);
let activeFrameRateHz = DEFAULT_FRAME_RATE_HZ;
let activeTelemetrySamplingRateHz =
  DEFAULT_FRAME_RATE_HZ * TELEMETRY_SAMPLING_MULTIPLIER;
let surfaceRecycleIntervalMs = DEFAULT_SURFACE_RECYCLE_INTERVAL_MS;
let metricsSourceLabel = "";
let lastFrameReceivedAtMs = 0;
let lastFramePresentedAtMs = 0;
let stallStateActive = false;
let viewerSessionId = 0;
let surfaceCreatedAtMs = 0;
let transformScratchCanvas: HTMLCanvasElement | null = null;
let transformScratchContext: CanvasRenderingContext2D | null = null;

type PendingFrame = {
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
  receivedAtMs: number;
  transform: StreamingImageTransform;
};

type StreamingImageTransform = "none" | "depth-preview";

type StreamingImageSourceInput = {
  id?: string;
  source?: string;
  sourceModel?: string;
  modelName?: string;
  telemetryModelName?: string;
  sourceField?: string;
  telemetryBaseUrl?: string;
  transform?: StreamingImageTransform;
};

type StreamingImageSource = Required<Pick<StreamingImageSourceInput, "id">> & {
  label: string;
  sourceField: string;
  transform: StreamingImageTransform;
  sourceModel?: string;
  modelName?: string;
  telemetryModelName?: string;
  telemetryBaseUrl?: string;
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

type DepthPreviewImageData = {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
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
  activeStreamingConfig = null;
  activeStreamSources = [];
  activeSelectedStreamStorageKey = null;
  lastFrameReceivedAtMs = 0;
  lastFramePresentedAtMs = 0;
  stallStateActive = false;
  decodeInFlight = false;
  surfaceCreatedAtMs = 0;
  transformScratchCanvas = null;
  transformScratchContext = null;
  activeFrameRateHz = DEFAULT_FRAME_RATE_HZ;
  activeTelemetrySamplingRateHz =
    DEFAULT_FRAME_RATE_HZ * TELEMETRY_SAMPLING_MULTIPLIER;
  if (monitorIntervalId !== null && typeof clearInterval === "function") {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
  }
  if (presentTimerId !== null && typeof clearTimeout === "function") {
    clearTimeout(presentTimerId);
    presentTimerId = null;
  }
  cleanupStreamSelector();
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

function cleanupStreamSelector() {
  if (streamSelectorContainerElement?.parentElement) {
    streamSelectorContainerElement.parentElement.removeChild(
      streamSelectorContainerElement
    );
  } else if (streamSelectorElement?.parentElement) {
    streamSelectorElement.parentElement.removeChild(streamSelectorElement);
  }
  streamSelectorContainerElement = null;
  streamSelectorElement = null;
}

function ensureStreamSelector(
  sources: StreamingImageSource[],
  selectedStreamId: string
) {
  if (!viewerContainerElement || sources.length <= 1) {
    cleanupStreamSelector();
    return;
  }

  if (
    streamSelectorElement &&
    streamSelectorElement.isConnected &&
    streamSelectorContainerElement?.parentElement === viewerContainerElement
  ) {
    streamSelectorElement.value = selectedStreamId;
    return;
  }

  cleanupStreamSelector();
  const container = document.createElement("label");
  container.title = "Image stream";
  Object.assign(container.style, {
    position: "absolute",
    top: "8px",
    right: "8px",
    zIndex: "1000",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "0.3rem",
    minWidth: "9.5rem",
    maxWidth: "190px",
    padding: "0.5rem 0.75rem",
    borderRadius: "10px",
    background: "rgba(15, 19, 31, 0.55)",
    color: "rgba(255, 255, 255, 0.88)",
    fontSize: "0.85rem",
    fontFamily: "system-ui, sans-serif",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  });

  const labelText = document.createElement("span");
  labelText.textContent = "Image Stream";
  Object.assign(labelText.style, {
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    fontSize: "0.72rem",
    opacity: "0.85",
  });

  const selector = document.createElement("select");
  selector.setAttribute("aria-label", "Image stream");
  selector.title = "Image stream";
  Object.assign(selector.style, {
    width: "100%",
    minHeight: "2rem",
    padding: "0.4rem 0.6rem",
    border: "1px solid rgba(255, 255, 255, 0.18)",
    borderRadius: "8px",
    background: "rgba(13, 18, 29, 0.9)",
    color: "white",
    fontSize: "0.85rem",
  });

  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.label;
    selector.appendChild(option);
  }

  selector.value = selectedStreamId;
  selector.addEventListener("change", () => {
    void switchStreamingImageSource(selector.value);
  });
  container.appendChild(labelText);
  container.appendChild(selector);
  streamSelectorContainerElement = container;
  streamSelectorElement = selector;
  viewerContainerElement.appendChild(container);
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
  receivedAtMs: number,
  transform: StreamingImageTransform
) {
  if (pendingFrame && metricsWindow) {
    metricsWindow.supersededFrames += 1;
  }
  pendingFrame = {
    mime,
    bytes,
    receivedAtMs,
    transform,
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
    decodeInFlight
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

    if (frame.transform === "depth-preview") {
      const preview = createDepthPreviewImageDataFromPngBytes(safeBytes);
      if (preview) {
        if (
          sessionId !== viewerSessionId ||
          !activeCanvas ||
          !activeCanvasContext
        ) {
          return;
        }
        drawDepthPreviewImageData(activeCanvas, activeCanvasContext, preview);
        notePresentedFrame(frame);
        return;
      }
    }

    if (typeof createImageBitmap !== "function") {
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
      drawBitmapWithTransform(
        activeCanvas,
        activeCanvasContext,
        bitmap,
        frame.transform
      );

      notePresentedFrame(frame);
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

function notePresentedFrame(frame: PendingFrame) {
  if (metricsWindow) {
    if (lastFramePresentedAtMs > 0) {
      metricsWindow.intervalsMs.push(frame.receivedAtMs - lastFramePresentedAtMs);
    }
    metricsWindow.presentedFrames += 1;
  }
  lastFramePresentedAtMs = frame.receivedAtMs;
}

function drawDepthPreviewImageData(
  targetCanvas: HTMLCanvasElement,
  targetContext: CanvasRenderingContext2D,
  preview: DepthPreviewImageData
) {
  if (
    targetCanvas.width !== preview.width ||
    targetCanvas.height !== preview.height
  ) {
    targetCanvas.width = preview.width;
    targetCanvas.height = preview.height;
  }
  targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetContext.putImageData(
    new ImageData(preview.data, preview.width, preview.height),
    0,
    0
  );
}

function drawBitmapWithTransform(
  targetCanvas: HTMLCanvasElement,
  targetContext: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  transform: StreamingImageTransform
) {
  if (transform === "none") {
    targetContext.drawImage(bitmap, 0, 0);
    return;
  }

  if (!transformScratchCanvas) {
    transformScratchCanvas = document.createElement("canvas");
  }
  const scratchCanvas = transformScratchCanvas;
  if (scratchCanvas.width !== bitmap.width) {
    scratchCanvas.width = bitmap.width;
    transformScratchContext = null;
  }
  if (scratchCanvas.height !== bitmap.height) {
    scratchCanvas.height = bitmap.height;
    transformScratchContext = null;
  }

  transformScratchContext =
    transformScratchContext ?? scratchCanvas.getContext("2d", { alpha: false });
  const scratchContext = transformScratchContext;
  if (!scratchContext) {
    targetContext.drawImage(bitmap, 0, 0);
    return;
  }

  scratchContext.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
  scratchContext.drawImage(bitmap, 0, 0);
  const imageData = scratchContext.getImageData(
    0,
    0,
    scratchCanvas.width,
    scratchCanvas.height
  );

  if (transform === "depth-preview") {
    applyDepthPreviewTransformToImageData(imageData);
  }

  targetCanvas.width = scratchCanvas.width;
  targetCanvas.height = scratchCanvas.height;
  targetContext.putImageData(imageData, 0, 0);
}

export function applyDepthPreviewTransformToImageData(
  imageData: ImageData
): ImageData {
  const data = imageData.data;
  let min = 255;
  let max = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      continue;
    }
    const luminance = Math.round(
      data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722
    );
    if (luminance <= 0) {
      continue;
    }
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
  }

  const hasRange = max > min;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = Math.round(
      data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722
    );
    const preview =
      luminance <= 0
        ? 0
        : hasRange
          ? Math.round(255 * (1 - (luminance - min) / (max - min)))
          : 255;
    data[i] = preview;
    data[i + 1] = preview;
    data[i + 2] = preview;
  }

  return imageData;
}

export function createDepthPreviewImageDataFromPngBytes(
  bytes: Uint8Array<ArrayBuffer>
): DepthPreviewImageData | null {
  try {
    const decoded = decodePng(bytes);
    if (decoded.depth !== 16 || decoded.channels < 1) {
      return null;
    }

    return createDepthPreviewImageDataFromSamples(
      decoded.width,
      decoded.height,
      decoded.channels,
      decoded.data
    );
  } catch (err) {
    console.warn("[streaming-image] Failed to decode depth PNG", err);
    return null;
  }
}

export function createDepthPreviewImageDataFromSamples(
  width: number,
  height: number,
  channels: number,
  samples: Uint8Array | Uint8ClampedArray | Uint16Array
): DepthPreviewImageData | null {
  if (
    width <= 0 ||
    height <= 0 ||
    channels <= 0 ||
    samples.length < width * height * channels
  ) {
    return null;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const depth = samples[pixelIndex * channels];
    if (depth <= 0) {
      continue;
    }
    min = Math.min(min, depth);
    max = Math.max(max, depth);
  }

  const rgba = new Uint8ClampedArray(
    width * height * 4
  ) as Uint8ClampedArray<ArrayBuffer>;
  const hasRange = Number.isFinite(min) && max > min;
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const depth = samples[pixelIndex * channels];
    const preview =
      depth <= 0
        ? 0
        : hasRange
          ? Math.round(255 * (1 - (depth - min) / (max - min)))
          : 255;
    const outputIndex = pixelIndex * 4;
    rgba[outputIndex] = preview;
    rgba[outputIndex + 1] = preview;
    rgba[outputIndex + 2] = preview;
    rgba[outputIndex + 3] = 255;
  }

  return { width, height, data: rgba };
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function prettifyStreamLabel(streamId: string): string {
  return streamId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function splitQualifiedFieldPath(
  sourceField: string,
  explicitSourceModel?: string
): { sourceModel?: string; sourceField: string } {
  const trimmedField = sourceField.trim();
  const trimmedModel = explicitSourceModel?.trim();
  if (trimmedModel) {
    const qualifiedPrefix = `${trimmedModel}.`;
    return {
      sourceModel: trimmedModel,
      sourceField: trimmedField.startsWith(qualifiedPrefix)
        ? trimmedField.slice(qualifiedPrefix.length)
        : trimmedField,
    };
  }

  const firstDotIndex = trimmedField.indexOf(".");
  if (firstDotIndex <= 0 || firstDotIndex === trimmedField.length - 1) {
    return { sourceField: trimmedField };
  }

  return {
    sourceModel: trimmedField.slice(0, firstDotIndex),
    sourceField: trimmedField.slice(firstDotIndex + 1),
  };
}

function normalizeStreamingImageSource(
  streamId: string,
  rawSource: unknown
): StreamingImageSource | null {
  const sourceInput: StreamingImageSourceInput =
    typeof rawSource === "string"
      ? { sourceField: rawSource }
      : isPlainObject(rawSource)
        ? {
            sourceModel:
              typeof rawSource.sourceModel === "string"
                ? rawSource.sourceModel
                : undefined,
            modelName:
              typeof rawSource.modelName === "string"
                ? rawSource.modelName
                : undefined,
            telemetryModelName:
              typeof rawSource.telemetryModelName === "string"
                ? rawSource.telemetryModelName
                : undefined,
            source:
              typeof rawSource.source === "string"
                ? rawSource.source
                : undefined,
            sourceField:
              typeof rawSource.sourceField === "string"
                ? rawSource.sourceField
                : undefined,
            telemetryBaseUrl:
              typeof rawSource.telemetryBaseUrl === "string"
                ? rawSource.telemetryBaseUrl
                : undefined,
            transform:
              rawSource.transform === "depth-preview"
                ? "depth-preview"
                : "none",
          }
        : {};

  const sourceField = (sourceInput.sourceField ?? sourceInput.source)?.trim();
  if (!sourceField) {
    return null;
  }

  const explicitModel =
    sourceInput.telemetryModelName ??
    sourceInput.modelName ??
    sourceInput.sourceModel;
  const qualified = splitQualifiedFieldPath(sourceField, explicitModel);
  return {
    id: streamId,
    label: prettifyStreamLabel(streamId),
    sourceField: qualified.sourceField,
    transform: sourceInput.transform ?? "none",
    sourceModel: sourceInput.sourceModel ?? qualified.sourceModel,
    modelName: sourceInput.modelName,
    telemetryModelName: sourceInput.telemetryModelName,
    telemetryBaseUrl: sourceInput.telemetryBaseUrl,
  };
}

function getStreamingImageSources(
  config: StreamingImageViewerConfig
): StreamingImageSource[] {
  const streamEntries = isPlainObject(config.streams)
    ? Object.entries(config.streams)
    : [];
  const configuredSources = streamEntries
    .map(([streamId, rawSource]) => {
      const trimmedStreamId = streamId.trim();
      return trimmedStreamId
        ? normalizeStreamingImageSource(trimmedStreamId, rawSource)
        : null;
    })
    .filter((source): source is StreamingImageSource => source !== null);

  if (configuredSources.length > 0) {
    return configuredSources;
  }

  const legacySource = normalizeStreamingImageSource("default", {
    sourceModel: config.sourceModel,
    modelName: config.modelName,
    telemetryModelName: config.telemetryModelName,
    sourceField: config.sourceField,
    telemetryBaseUrl: config.telemetryBaseUrl,
  });
  return legacySource ? [legacySource] : [];
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(16);
}

function buildStreamingImageSourcesStorageSignature(
  sources: StreamingImageSource[]
): string {
  return hashString(
    JSON.stringify(
      sources.map((source) => ({
        id: source.id,
        sourceModel: source.sourceModel ?? "",
        modelName: source.modelName ?? "",
        telemetryModelName: source.telemetryModelName ?? "",
        sourceField: source.sourceField,
        telemetryBaseUrl: source.telemetryBaseUrl ?? "",
        transform: source.transform,
      }))
    )
  );
}

function buildSelectedStreamStorageKey(
  config: StreamingImageViewerConfig,
  sources: StreamingImageSource[]
): string | null {
  if (sources.length <= 1) {
    return null;
  }
  return buildNamespacedKey(
    "robotick.streaming-image.selected-stream",
    config.projectPath || "default-project",
    buildStreamingImageSourcesStorageSignature(sources)
  );
}

function readStoredSelectedStream(
  storageKey: string | null,
  sources: StreamingImageSource[]
): string | null {
  if (!storageKey) {
    return null;
  }
  const stored = readStorageValue(storageKey)?.trim();
  if (!stored || !sources.some((source) => source.id === stored)) {
    return null;
  }
  return stored;
}

function writeStoredSelectedStream(streamId: string): void {
  if (!activeSelectedStreamStorageKey) {
    return;
  }
  setStorageValue(activeSelectedStreamStorageKey, streamId);
}

export function resolveStreamingImageSource(
  config: StreamingImageViewerConfig,
  selectedStreamOverride?: string
): StreamingImageSource | null {
  const sources = getStreamingImageSources(config);
  if (sources.length === 0) {
    return null;
  }

  const selectedStream =
    selectedStreamOverride?.trim() || config.selectedStream?.trim();
  return (
    (selectedStream
      ? sources.find((source) => source.id === selectedStream)
      : null) ?? sources[0]
  );
}

function resetSourceRuntimeState() {
  pendingFrame = null;
  lastFrameReceivedAtMs = 0;
  lastFramePresentedAtMs = 0;
  stallStateActive = false;
  if (presentTimerId !== null && typeof clearTimeout === "function") {
    clearTimeout(presentTimerId);
    presentTimerId = null;
  }
  metricsWindow = metricsEnabled ? createMetricsWindow(Date.now()) : null;
  setBlackFrame();
}

async function switchStreamingImageSource(streamId: string) {
  const config = activeStreamingConfig;
  if (!config) {
    return;
  }

  const source = resolveStreamingImageSource(config, streamId);
  if (!source) {
    return;
  }

  writeStoredSelectedStream(source.id);
  viewerSessionId += 1;
  await subscribeToStreamingImageSource(source);
}

async function subscribeToStreamingImageSource(source: StreamingImageSource) {
  const sessionId = viewerSessionId;
  const telemetryBase = await resolveTelemetryBaseUrl(source);
  if (sessionId !== viewerSessionId) {
    return;
  }

  telemetryDispose?.();
  telemetryDispose = null;
  resetSourceRuntimeState();
  ensureStreamSelector(activeStreamSources, source.id);

  if (!telemetryBase) {
    console.warn(
      "[streaming-image] Unable to resolve telemetry base URL for viewer"
    );
    publishDebugState({ fieldPath: source.sourceField, streamId: source.id });
    return;
  }

  metricsSourceLabel = `${telemetryBase} :: ${source.sourceField}`;
  publishDebugState({
    telemetryBase,
    fieldPath: source.sourceField,
    streamId: source.id,
    frameRateHz: activeFrameRateHz,
    telemetrySamplingRateHz: activeTelemetrySamplingRateHz,
  });

  console.info(
    `[streaming-image] Subscribing to telemetry ${telemetryBase} field ${source.sourceField} @ ${activeTelemetrySamplingRateHz}Hz, presenting @ ${activeFrameRateHz}Hz`
  );
  telemetryDispose = subscribeTelemetry(
    telemetryBase,
    activeTelemetrySamplingRateHz,
    {
      callback: (model) =>
        handleTelemetryFrame(model, source.sourceField, source.transform),
      error: (err) => {
        console.warn(
          `[streaming-image] Telemetry error for ${telemetryBase} (${source.sourceField})`,
          err
        );
        noteTransportError();
      },
    }
  );
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
  activeStreamingConfig = streamingConfig;
  activeStreamSources = getStreamingImageSources(streamingConfig);
  activeSelectedStreamStorageKey = buildSelectedStreamStorageKey(
    streamingConfig,
    activeStreamSources
  );
  const activeSource = resolveStreamingImageSource(
    streamingConfig,
    readStoredSelectedStream(activeSelectedStreamStorageKey, activeStreamSources) ??
      undefined
  );
  if (!activeSource) {
    console.warn(
      "[streaming-image] Missing sourceField in viewer configuration"
    );
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
  activeFrameRateHz = frameRateHz;
  activeTelemetrySamplingRateHz = telemetrySamplingRateHz;
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
  metricsWindow = metricsEnabled ? createMetricsWindow(Date.now()) : null;
  publishDebugState({
    fieldPath: activeSource.sourceField,
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
  ensureStreamSelector(activeStreamSources, activeSource.id);
  writeStoredSelectedStream(activeSource.id);
  await subscribeToStreamingImageSource(activeSource);
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
function handleTelemetryFrame(
  model: ITelemetryModel,
  fieldPath: string,
  transform: StreamingImageTransform
) {
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
  queueFrame(mime, bytes, Date.now(), transform);
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
  config: StreamingImageSourceInput
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
