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
let activeCanvasStackElement: HTMLDivElement | null = null;
let viewerContainerElement: HTMLElement | null = null;
let statsOverlayElement: HTMLDivElement | null = null;
let detectionsOverlayElement: HTMLDivElement | null = null;
let streamSelectorContainerElement: HTMLLabelElement | null = null;
let streamSelectorElement: HTMLSelectElement | null = null;
let activeStreamingConfig: StreamingImageViewerConfig | null = null;
let activeStreamSources: StreamingImageStream[] = [];
let activeStreamingStream: StreamingImageStream | null = null;
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
let detectionsTelemetryDispose: (() => void) | null = null;
let latestDetections: ObjectDetectionOverlay[] = [];
let surfaceRecycleIntervalMs = DEFAULT_SURFACE_RECYCLE_INTERVAL_MS;
let metricsSourceLabel = "";
let lastFrameReceivedAtMs = 0;
let lastFramePresentedAtMs = 0;
let stallStateActive = false;
let viewerSessionId = 0;
let surfaceCreatedAtMs = 0;
let transformScratchCanvas: HTMLCanvasElement | null = null;
let transformScratchContext: CanvasRenderingContext2D | null = null;
let createImageBitmapUnavailableReported = false;
let activeCompositeStreamMode = false;

type PendingFrame = {
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
  receivedAtMs: number;
  transform: StreamingImageTransform;
  detections: ObjectDetectionOverlay[];
};

type StreamingImageTransform = "none" | "depth-preview" | "mask-preview";
type StreamingImageBlendMode = "normal" | "screen" | "multiply" | "plus-lighter";

export type ObjectDetectionOverlay = {
  className: string;
  confidence: number;
  boxX1Norm: number;
  boxY1Norm: number;
  boxX2Norm: number;
  boxY2Norm: number;
};

type StreamingImageSourceInput = {
  id?: string;
  source?: string;
  detectionsSource?: string;
  detections?: string;
  sourceModel?: string;
  modelName?: string;
  telemetryModelName?: string;
  sourceField?: string;
  telemetryBaseUrl?: string;
  transform?: StreamingImageTransform;
};

type StreamingImageLayerInput = StreamingImageSourceInput & {
  blendMode?: StreamingImageBlendMode;
  opacity?: number;
  visible?: boolean;
};

type StreamingImageLayer = Required<Pick<StreamingImageLayerInput, "id">> & {
  index: number;
  label: string;
  sourceField: string;
  transform: StreamingImageTransform;
  blendMode: StreamingImageBlendMode;
  opacity: number;
  visible: boolean;
  detectionsSourceField?: string;
  detectionsSourceModel?: string;
  detectionsTelemetryModelName?: string;
  detectionsTelemetryBaseUrl?: string;
  sourceModel?: string;
  modelName?: string;
  telemetryModelName?: string;
  telemetryBaseUrl?: string;
};

type StreamingImageStreamInput = StreamingImageLayerInput & {
  layers?: unknown[];
};

type StreamingImageStream = {
  id: string;
  label: string;
  layers: StreamingImageLayer[];
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

type MaskPreviewImageData = {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
};

const MASK_PREVIEW_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [255, 82, 82],
  [77, 208, 225],
  [255, 213, 79],
  [129, 199, 132],
  [179, 136, 255],
  [255, 138, 101],
  [79, 195, 247],
  [240, 98, 146],
  [174, 213, 129],
  [186, 104, 200],
  [255, 241, 118],
  [100, 181, 246],
];

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
  latestDetections = [];
  metricsWindow = null;
  metricsSourceLabel = "";
  activeStreamingConfig = null;
  activeStreamSources = [];
  activeStreamingStream = null;
  activeSelectedStreamStorageKey = null;
  lastFrameReceivedAtMs = 0;
  lastFramePresentedAtMs = 0;
  stallStateActive = false;
  decodeInFlight = false;
  surfaceCreatedAtMs = 0;
  transformScratchCanvas = null;
  transformScratchContext = null;
  createImageBitmapUnavailableReported = false;
  activeCompositeStreamMode = false;
  activeCanvasStackElement = null;
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
    hasDetectionsOverlay: Boolean(detectionsOverlayElement),
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

  ensureViewerContainerPositioned();

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

function ensureViewerContainerPositioned() {
  if (!viewerContainerElement || typeof window === "undefined") {
    return;
  }

  const computed = window.getComputedStyle(viewerContainerElement).position;
  if (!computed || computed === "static") {
    viewerContainerElement.style.position = "relative";
  }
}

function ensureDetectionsOverlay() {
  if (!viewerContainerElement) {
    return null;
  }
  if (
    detectionsOverlayElement &&
    detectionsOverlayElement.isConnected &&
    detectionsOverlayElement.parentElement === viewerContainerElement
  ) {
    return detectionsOverlayElement;
  }

  cleanupDetectionsOverlay();
  ensureViewerContainerPositioned();

  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.dataset.role = "object-detections-overlay";
  Object.assign(overlay.style, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "998",
    fontFamily: "var(--font-family-base, Inter, Segoe UI, system-ui, sans-serif)",
    letterSpacing: "0",
  });

  detectionsOverlayElement = overlay;
  viewerContainerElement.appendChild(overlay);
  syncDetectionsOverlayBounds();
  publishDebugState({ detectionsOverlayCreated: true });
  return overlay;
}

function cleanupDetectionsOverlay() {
  if (detectionsOverlayElement?.parentElement) {
    detectionsOverlayElement.parentElement.removeChild(detectionsOverlayElement);
  }
  detectionsOverlayElement = null;
  publishDebugState({ detectionsOverlayCreated: false });
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
  sources: StreamingImageStream[],
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
    switchStreamingImageSource(selector.value).catch((error) => {
      console.warn("[streaming-image] Failed to switch stream", error);
    });
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
  transform: StreamingImageTransform,
  detections: ObjectDetectionOverlay[] = []
) {
  if (pendingFrame && metricsWindow) {
    metricsWindow.supersededFrames += 1;
  }
  pendingFrame = {
    mime,
    bytes,
    receivedAtMs,
    transform,
    detections,
  };
  lastFrameReceivedAtMs = receivedAtMs;
  stallStateActive = false;
  if (metricsWindow) {
    metricsWindow.receivedFrames += 1;
  }
  schedulePendingFramePresentation();
}

function getLayerCanvas(layerIndex: number): HTMLCanvasElement | null {
  if (!activeCompositeStreamMode) {
    return layerIndex === 0 ? activeCanvas : null;
  }
  const canvas = activeCanvasStackElement?.children.item(layerIndex);
  return canvas instanceof HTMLCanvasElement ? canvas : null;
}

function getLayerCanvasContext(
  layerIndex: number
): CanvasRenderingContext2D | null {
  const canvas = getLayerCanvas(layerIndex);
  return canvas?.getContext("2d", { alpha: false }) ?? null;
}

async function renderFrameToCanvas(
  targetCanvas: HTMLCanvasElement,
  targetContext: CanvasRenderingContext2D,
  frame: PendingFrame,
  sessionId: number
) : Promise<boolean> {
  const safeBytes = sanitizeImageBytes(frame.mime, frame.bytes);
  if (!safeBytes) {
    noteTransportError();
    return false;
  }

  if (frame.transform === "depth-preview") {
    const preview = createDepthPreviewImageDataFromPngBytes(safeBytes);
    if (preview) {
      if (
        sessionId !== viewerSessionId ||
        !targetCanvas ||
        !targetContext
      ) {
        return false;
      }
      drawDepthPreviewImageData(targetCanvas, targetContext, preview);
      return true;
    }
  }

  if (frame.transform === "mask-preview") {
    const preview = createMaskPreviewImageDataFromPngBytes(safeBytes);
    if (preview) {
      if (
        sessionId !== viewerSessionId ||
        !targetCanvas ||
        !targetContext
      ) {
        return false;
      }
      drawMaskPreviewImageData(targetCanvas, targetContext, preview);
      return true;
    }
  }

  if (typeof createImageBitmap !== "function") {
    noteCreateImageBitmapUnavailable();
    return false;
  }

  const blob = new Blob([safeBytes], { type: frame.mime });
  const bitmap = await createImageBitmap(blob);
  try {
    if (
      sessionId !== viewerSessionId ||
      !targetCanvas ||
      !targetContext
    ) {
      return false;
    }

    if (
      targetCanvas.width !== bitmap.width ||
      targetCanvas.height !== bitmap.height
    ) {
      targetCanvas.width = bitmap.width;
      targetCanvas.height = bitmap.height;
    }

    targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    drawBitmapWithTransform(
      targetCanvas,
      targetContext,
      bitmap,
      frame.transform
    );
    return true;
  } finally {
    bitmap.close();
  }
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
    const rendered = await renderFrameToCanvas(
      activeCanvas,
      activeCanvasContext,
      frame,
      sessionId
    );
    if (!rendered) {
      return;
    }
    updateObjectDetectionsOverlay(frame.detections);
    notePresentedFrame(frame);
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

function drawMaskPreviewImageData(
  targetCanvas: HTMLCanvasElement,
  targetContext: CanvasRenderingContext2D,
  preview: MaskPreviewImageData
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
  } else if (transform === "mask-preview") {
    applyMaskPreviewTransformToImageData(imageData);
  }

  targetCanvas.width = scratchCanvas.width;
  targetCanvas.height = scratchCanvas.height;
  targetContext.putImageData(imageData, 0, 0);
}

export function extractObjectDetectionOverlays(
  value: unknown
): ObjectDetectionOverlay[] {
  const rawDetections = extractRawObjectDetectionArray(value);
  const detections: ObjectDetectionOverlay[] = [];

  for (const rawDetection of rawDetections) {
    if (!isPlainObject(rawDetection)) {
      continue;
    }

    const boxX1Norm = readFiniteNumber(rawDetection.box_x1_norm);
    const boxY1Norm = readFiniteNumber(rawDetection.box_y1_norm);
    const boxX2Norm = readFiniteNumber(rawDetection.box_x2_norm);
    const boxY2Norm = readFiniteNumber(rawDetection.box_y2_norm);
    const confidence = readFiniteNumber(rawDetection.confidence) ?? 0;

    if (
      boxX1Norm === null ||
      boxY1Norm === null ||
      boxX2Norm === null ||
      boxY2Norm === null
    ) {
      continue;
    }

    detections.push({
      className: readDetectionClassName(rawDetection.class_name),
      confidence,
      boxX1Norm: clamp01(boxX1Norm),
      boxY1Norm: clamp01(boxY1Norm),
      boxX2Norm: clamp01(boxX2Norm),
      boxY2Norm: clamp01(boxY2Norm),
    });
  }

  return detections;
}

function extractRawObjectDetectionArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isPlainObject(value)) {
    return [];
  }

  const buffer = value.data_buffer;
  if (!Array.isArray(buffer)) {
    return [];
  }

  const count =
    typeof value.count === "number" && Number.isFinite(value.count)
      ? Math.max(0, Math.min(buffer.length, Math.trunc(value.count)))
      : buffer.length;
  return buffer.slice(0, count);
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function readDetectionClassName(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function updateObjectDetectionsOverlay(
  detections: readonly ObjectDetectionOverlay[]
) {
  const overlay = ensureDetectionsOverlay();
  if (!overlay) {
    return;
  }
  syncDetectionsOverlayBounds();
  renderObjectDetectionsOverlay(overlay, detections);
}

function clearObjectDetectionsOverlay() {
  if (detectionsOverlayElement) {
    syncDetectionsOverlayBounds();
    renderObjectDetectionsOverlay(detectionsOverlayElement, []);
  }
}

function syncDetectionsOverlayBounds() {
  if (!viewerContainerElement || !activeCanvas || !detectionsOverlayElement) {
    return;
  }

  const bounds = calculateContainedImageRect(
    activeCanvas.width,
    activeCanvas.height,
    activeCanvas.getBoundingClientRect(),
    viewerContainerElement.getBoundingClientRect()
  );

  Object.assign(detectionsOverlayElement.style, {
    inset: "auto",
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  });
}

export function calculateContainedImageRect(
  sourceWidth: number,
  sourceHeight: number,
  targetRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  containerRect: Pick<DOMRectReadOnly, "left" | "top">
): { left: number; top: number; width: number; height: number } {
  const targetWidth = Math.max(0, targetRect.width);
  const targetHeight = Math.max(0, targetRect.height);
  const left = targetRect.left - containerRect.left;
  const top = targetRect.top - containerRect.top;

  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    return {
      left,
      top,
      width: targetWidth,
      height: targetHeight,
    };
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    left: left + (targetWidth - width) / 2,
    top: top + (targetHeight - height) / 2,
    width,
    height,
  };
}

export function renderObjectDetectionsOverlay(
  overlay: HTMLElement,
  detections: readonly ObjectDetectionOverlay[]
) {
  overlay.replaceChildren();
  if (detections.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const detection of detections) {
    const x1 = Math.min(detection.boxX1Norm, detection.boxX2Norm);
    const y1 = Math.min(detection.boxY1Norm, detection.boxY2Norm);
    const x2 = Math.max(detection.boxX1Norm, detection.boxX2Norm);
    const y2 = Math.max(detection.boxY1Norm, detection.boxY2Norm);
    const box = document.createElement("div");
    box.dataset.role = "object-detection-box";
    box.title = formatDetectionLabel(detection);
    Object.assign(box.style, {
      position: "absolute",
      left: formatOverlayPercent(x1),
      top: formatOverlayPercent(y1),
      width: formatOverlayPercent(Math.max(0.001, x2 - x1)),
      height: formatOverlayPercent(Math.max(0.001, y2 - y1)),
      border: "2px solid var(--app-usage-positive, rgba(102, 204, 255, 1))",
      borderRadius: "3px",
      background: "rgba(102, 204, 255, 0.06)",
      boxShadow:
        "0 0 0 1px rgba(0, 0, 0, 0.45), 0 0 14px rgba(102, 204, 255, 0.22)",
    });

    const label = document.createElement("div");
    label.dataset.role = "object-detection-label";
    label.textContent = formatDetectionLabel(detection);
    const labelLeft = formatOverlayPercent(x1);
    const labelTop = formatOverlayPercent(y1);
    Object.assign(label.style, {
      position: "absolute",
      left: labelLeft,
      top: y1 > 0.06 ? `calc(${labelTop} - 1.55rem)` : labelTop,
      maxWidth: `calc(${formatOverlayPercent(1 - x1)} - 4px)`,
      minHeight: "1.25rem",
      padding: "2px 6px",
      border: "1px solid var(--app-panel-border, rgba(255, 255, 255, 0.08))",
      borderRadius: "4px",
      background: "var(--app-panel-backdrop, rgba(7, 10, 18, 0.92))",
      color: "var(--app-text-primary, rgba(245, 245, 245, 1))",
      boxShadow: "0 6px 18px rgba(0, 0, 0, 0.28)",
      backdropFilter: "var(--app-panel-blur, blur(14px))",
      WebkitBackdropFilter: "var(--app-panel-blur, blur(14px))",
      fontSize: "0.75rem",
      fontWeight: "600",
      lineHeight: "1.2",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });

    fragment.appendChild(box);
    fragment.appendChild(label);
  }

  overlay.appendChild(fragment);
}

function formatOverlayPercent(value: number): string {
  const percentage = clamp01(value) * 100;
  return `${Number(percentage.toFixed(3))}%`;
}

function formatDetectionLabel(detection: ObjectDetectionOverlay): string {
  const confidence = Math.round(clamp01(detection.confidence) * 100);
  return detection.className
    ? `${detection.className} ${confidence}%`
    : `${confidence}%`;
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

export function applyMaskPreviewTransformToImageData(
  imageData: ImageData
): ImageData {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const maskId = Math.round(
      data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722
    );
    applyMaskPreviewPixel(data, i, maskId);
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

export function createMaskPreviewImageDataFromPngBytes(
  bytes: Uint8Array<ArrayBuffer>
): MaskPreviewImageData | null {
  try {
    const decoded = decodePng(bytes);
    if (decoded.channels < 1 || (decoded.depth !== 8 && decoded.depth !== 16)) {
      return null;
    }

    return createMaskPreviewImageDataFromSamples(
      decoded.width,
      decoded.height,
      decoded.channels,
      decoded.data
    );
  } catch (err) {
    console.warn("[streaming-image] Failed to decode mask PNG", err);
    return null;
  }
}

export function createMaskPreviewImageDataFromSamples(
  width: number,
  height: number,
  channels: number,
  samples: Uint8Array | Uint8ClampedArray | Uint16Array
): MaskPreviewImageData | null {
  if (
    width <= 0 ||
    height <= 0 ||
    channels <= 0 ||
    samples.length < width * height * channels
  ) {
    return null;
  }

  const rgba = new Uint8ClampedArray(
    width * height * 4
  ) as Uint8ClampedArray<ArrayBuffer>;
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const maskId = samples[pixelIndex * channels];
    applyMaskPreviewPixel(rgba, pixelIndex * 4, maskId);
  }

  return { width, height, data: rgba };
}

function applyMaskPreviewPixel(
  data: Uint8ClampedArray,
  outputIndex: number,
  rawMaskId: number
) {
  const maskId = Math.max(0, Math.round(rawMaskId));
  if (maskId === 0) {
    data[outputIndex] = 0;
    data[outputIndex + 1] = 0;
    data[outputIndex + 2] = 0;
    data[outputIndex + 3] = 255;
    return;
  }

  const color =
    MASK_PREVIEW_PALETTE[(maskId - 1) % MASK_PREVIEW_PALETTE.length];
  data[outputIndex] = color[0];
  data[outputIndex + 1] = color[1];
  data[outputIndex + 2] = color[2];
  data[outputIndex + 3] = 255;
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

function noteCreateImageBitmapUnavailable() {
  if (createImageBitmapUnavailableReported) {
    return;
  }
  createImageBitmapUnavailableReported = true;
  console.warn("[streaming-image] createImageBitmap is unavailable in this environment");
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
    decodeInFlight ||
    pendingFrame ||
    surfaceRecycleIntervalMs <= 0 ||
    lastFramePresentedAtMs <= 0 ||
    nowMs - surfaceCreatedAtMs < surfaceRecycleIntervalMs
  ) {
    return;
  }
  if (activeCompositeStreamMode && activeStreamingStream) {
    recreateCanvasSurface(activeStreamingStream.layers);
  } else {
    recreateCanvasSurface();
  }
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
    syncDetectionsOverlayBounds();
    updateStatsOverlay(nowMs);
    flushMetricsWindow(nowMs);
  }, 250);
}

function recreateCanvasSurface(layers: StreamingImageLayer[] = []) {
  if (!viewerContainerElement) {
    return false;
  }

  const isLayered = layers.length > 1;
  const previousCanvas = activeCanvas;
  const previousStack = activeCanvasStackElement;
  if (previousCanvas?.parentElement === viewerContainerElement) {
    previousCanvas.width = 1;
    previousCanvas.height = 1;
  }
  if (previousStack?.parentElement === viewerContainerElement) {
    previousStack.remove();
  } else if (viewerContainerElement.firstChild) {
    cleanupStatsOverlay();
    viewerContainerElement.textContent = "";
  }

  let nextCanvas: HTMLCanvasElement | null = null;
  let nextContext: CanvasRenderingContext2D | null = null;

  if (isLayered) {
    const stack = document.createElement("div");
    stack.dataset.role = "streaming-image-layer-stack";
    Object.assign(stack.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      isolation: "isolate",
    });
    activeCanvasStackElement = stack;
    viewerContainerElement.appendChild(stack);

    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      const canvas = document.createElement("canvas");
      canvas.dataset.role = index === 0 ? "streaming-image-base" : "streaming-image-overlay";
      canvas.id = index === 0 ? "camera-stream" : `camera-stream-layer-${index}`;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = layer.visible ? "block" : "none";
      canvas.style.objectFit = "contain";
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.zIndex = String(10 + index);
      canvas.style.opacity = index === 0 ? "1" : String(layer.opacity);
      canvas.style.mixBlendMode = index === 0 ? "normal" : layer.blendMode;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        return false;
      }
      if (index === 0) {
        nextCanvas = canvas;
        nextContext = context;
      }
      stack.appendChild(canvas);
    }
  } else {
    const canvas = document.createElement("canvas");
    canvas.id = "camera-stream";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.objectFit = "contain";
    const context = canvas.getContext("2d", {
      alpha: false,
    });
    if (!context) {
      return false;
    }
    viewerContainerElement.appendChild(canvas);
    nextCanvas = canvas;
    nextContext = context;
    activeCanvasStackElement = null;
  }

  if (!nextCanvas || !nextContext) {
    return false;
  }

  activeCanvas = nextCanvas;
  activeCanvasContext = nextContext;
  ensureDetectionsOverlay();
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

function splitOptionalQualifiedFieldPath(
  sourceField: string,
  fallbackSourceModel?: string
): { sourceModel?: string; sourceField: string } {
  const trimmedField = sourceField.trim();
  const trimmedFallback = fallbackSourceModel?.trim();
  if (trimmedFallback && trimmedField.startsWith(`${trimmedFallback}.`)) {
    return splitQualifiedFieldPath(trimmedField, trimmedFallback);
  }

  const firstDotIndex = trimmedField.indexOf(".");
  if (firstDotIndex <= 0 || firstDotIndex === trimmedField.length - 1) {
    return {
      sourceModel: trimmedFallback,
      sourceField: trimmedField,
    };
  }

  const possibleModelName = trimmedField.slice(0, firstDotIndex);
  if (possibleModelName.includes("-")) {
    return splitQualifiedFieldPath(trimmedField);
  }

  return {
    sourceModel: trimmedFallback,
    sourceField: trimmedField,
  };
}

function normalizeStreamingImageLayer(
  streamId: string,
  layerIndex: number,
  rawLayer: unknown,
  inherited?: Partial<StreamingImageLayerInput>
): StreamingImageLayer | null {
  const layerInput: StreamingImageLayerInput =
    typeof rawLayer === "string"
      ? { ...(inherited ?? {}), sourceField: rawLayer }
      : isPlainObject(rawLayer)
        ? {
            ...(inherited ?? {}),
            sourceModel:
              typeof rawLayer.sourceModel === "string"
                ? rawLayer.sourceModel
                : inherited?.sourceModel,
            modelName:
              typeof rawLayer.modelName === "string"
                ? rawLayer.modelName
                : inherited?.modelName,
            telemetryModelName:
              typeof rawLayer.telemetryModelName === "string"
                ? rawLayer.telemetryModelName
                : inherited?.telemetryModelName,
            source:
              typeof rawLayer.source === "string"
                ? rawLayer.source
                : inherited?.source,
            detectionsSource:
              typeof rawLayer.detectionsSource === "string"
                ? rawLayer.detectionsSource
                : typeof rawLayer.detections === "string"
                  ? rawLayer.detections
                  : inherited?.detectionsSource,
            sourceField:
              typeof rawLayer.sourceField === "string"
                ? rawLayer.sourceField
                : inherited?.sourceField,
            telemetryBaseUrl:
              typeof rawLayer.telemetryBaseUrl === "string"
                ? rawLayer.telemetryBaseUrl
                : inherited?.telemetryBaseUrl,
            transform:
              rawLayer.transform === "depth-preview" ||
              rawLayer.transform === "mask-preview"
                ? rawLayer.transform
                : inherited?.transform ?? "none",
            blendMode:
              rawLayer.blendMode === "screen" ||
              rawLayer.blendMode === "multiply" ||
              rawLayer.blendMode === "plus-lighter"
                ? rawLayer.blendMode
                : inherited?.blendMode ?? "normal",
            opacity:
              typeof rawLayer.opacity === "number" && Number.isFinite(rawLayer.opacity)
                ? Math.max(0, Math.min(1, rawLayer.opacity))
                : inherited?.opacity ?? 1,
            visible:
              typeof rawLayer.visible === "boolean"
                ? rawLayer.visible
                : inherited?.visible ?? true,
          }
        : {
            ...(inherited ?? {}),
          };

  const sourceField = (layerInput.sourceField ?? layerInput.source)?.trim();
  if (!sourceField) {
    return null;
  }

  const explicitModel =
    layerInput.telemetryModelName ??
    layerInput.modelName ??
    layerInput.sourceModel;
  const qualified = splitQualifiedFieldPath(sourceField, explicitModel);
  const sourceModel =
    layerInput.sourceModel ??
    layerInput.modelName ??
    layerInput.telemetryModelName ??
    qualified.sourceModel;
  const detectionsSource = layerInput.detectionsSource?.trim();
  const detectionsQualified = detectionsSource
    ? splitOptionalQualifiedFieldPath(detectionsSource, sourceModel)
    : null;
  return {
    id: `${streamId}:${layerIndex}`,
    index: layerIndex,
    label: layerIndex === 0 ? prettifyStreamLabel(streamId) : `${prettifyStreamLabel(streamId)} ${layerIndex + 1}`,
    sourceField: qualified.sourceField,
    transform: layerInput.transform ?? "none",
    blendMode: layerInput.blendMode ?? "normal",
    opacity: layerInput.opacity ?? 1,
    visible: layerInput.visible ?? true,
    detectionsSourceField: detectionsQualified?.sourceField,
    detectionsSourceModel: detectionsQualified?.sourceModel,
    detectionsTelemetryModelName: detectionsQualified?.sourceModel,
    sourceModel: layerInput.sourceModel ?? qualified.sourceModel,
    modelName: layerInput.modelName,
    telemetryModelName: layerInput.telemetryModelName,
    telemetryBaseUrl: layerInput.telemetryBaseUrl,
  };
}

function normalizeStreamingImageStream(
  streamId: string,
  rawSource: unknown
): StreamingImageStream | null {
  if (isPlainObject(rawSource) && Array.isArray(rawSource.layers)) {
    const streamInput = rawSource as StreamingImageStreamInput;
    const rawLayers = Array.isArray(streamInput.layers) ? streamInput.layers : [];
    const inherited: Partial<StreamingImageLayerInput> = {
      sourceModel:
        typeof streamInput.sourceModel === "string"
          ? streamInput.sourceModel
          : undefined,
      modelName:
        typeof streamInput.modelName === "string"
          ? streamInput.modelName
          : undefined,
      telemetryModelName:
        typeof streamInput.telemetryModelName === "string"
          ? streamInput.telemetryModelName
          : undefined,
      source:
        typeof streamInput.source === "string" ? streamInput.source : undefined,
      detectionsSource:
        typeof streamInput.detectionsSource === "string"
          ? streamInput.detectionsSource
          : typeof streamInput.detections === "string"
            ? streamInput.detections
            : undefined,
      sourceField:
        typeof streamInput.sourceField === "string"
          ? streamInput.sourceField
          : undefined,
      telemetryBaseUrl:
        typeof streamInput.telemetryBaseUrl === "string"
          ? streamInput.telemetryBaseUrl
          : undefined,
      transform:
        streamInput.transform === "depth-preview" ||
        streamInput.transform === "mask-preview"
          ? streamInput.transform
          : "none",
      blendMode:
        streamInput.blendMode === "screen" ||
        streamInput.blendMode === "multiply" ||
        streamInput.blendMode === "plus-lighter"
          ? streamInput.blendMode
          : "normal",
      opacity:
        typeof streamInput.opacity === "number" && Number.isFinite(streamInput.opacity)
          ? Math.max(0, Math.min(1, streamInput.opacity))
          : 1,
      visible:
        typeof streamInput.visible === "boolean" ? streamInput.visible : true,
    };
    const layers = rawLayers
      .map((layer, index) => normalizeStreamingImageLayer(streamId, index, layer, inherited))
      .filter((layer): layer is StreamingImageLayer => layer !== null);
    if (layers.length === 0) {
      return null;
    }
    if (layers.length === 1) {
      layers[0].id = streamId;
    }
    return { id: streamId, label: prettifyStreamLabel(streamId), layers };
  }

  const singleLayer = normalizeStreamingImageLayer(streamId, 0, rawSource);
  if (singleLayer) {
    singleLayer.id = streamId;
    return { id: streamId, label: prettifyStreamLabel(streamId), layers: [singleLayer] };
  }
  return null;
}

function getStreamingImageSources(
  config: StreamingImageViewerConfig
): StreamingImageStream[] {
  const streamEntries = isPlainObject(config.streams)
    ? Object.entries(config.streams)
    : [];
  const configuredSources = streamEntries
    .map(([streamId, rawSource]) => {
      const trimmedStreamId = streamId.trim();
      return trimmedStreamId
        ? normalizeStreamingImageStream(trimmedStreamId, rawSource)
        : null;
    })
    .filter((source): source is StreamingImageStream => source !== null);

  if (configuredSources.length > 0) {
    return configuredSources;
  }

  const legacySource = normalizeStreamingImageStream("default", {
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
  sources: StreamingImageStream[]
): string {
  return hashString(
    JSON.stringify(
      sources.flatMap((stream) =>
        stream.layers.map((source) => ({
          streamId: stream.id,
          id: source.id,
          index: source.index,
          sourceModel: source.sourceModel ?? "",
          modelName: source.modelName ?? "",
          telemetryModelName: source.telemetryModelName ?? "",
          sourceField: source.sourceField,
          detectionsSourceField: source.detectionsSourceField ?? "",
          detectionsSourceModel: source.detectionsSourceModel ?? "",
          detectionsTelemetryModelName:
            source.detectionsTelemetryModelName ?? "",
          telemetryBaseUrl: source.telemetryBaseUrl ?? "",
          detectionsTelemetryBaseUrl:
            source.detectionsTelemetryBaseUrl ?? "",
          transform: source.transform,
          blendMode: source.blendMode,
          opacity: source.opacity,
          visible: source.visible,
        }))
      )
    )
  );
}

function buildSelectedStreamStorageKey(
  config: StreamingImageViewerConfig,
  sources: StreamingImageStream[]
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
  sources: StreamingImageStream[]
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
): StreamingImageLayer | null {
  const stream = resolveStreamingImageStream(config, selectedStreamOverride);
  return stream?.layers[0] ?? null;
}

export function resolveStreamingImageStream(
  config: StreamingImageViewerConfig,
  selectedStreamOverride?: string
): StreamingImageStream | null {
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

function getSourceTelemetryModelName(source: StreamingImageLayer): string | undefined {
  return source.telemetryModelName ?? source.modelName ?? source.sourceModel;
}

function usesSeparateDetectionsTelemetry(source: StreamingImageLayer): boolean {
  if (!source.detectionsSourceField) {
    return false;
  }
  if (source.detectionsTelemetryBaseUrl) {
    return true;
  }

  const detectionsModelName = source.detectionsTelemetryModelName?.trim();
  if (!detectionsModelName) {
    return false;
  }

  return detectionsModelName !== getSourceTelemetryModelName(source)?.trim();
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

  const stream = resolveStreamingImageStream(config, streamId);
  if (!stream) {
    return;
  }

  writeStoredSelectedStream(stream.id);
  viewerSessionId += 1;
  await subscribeToStreamingImageStream(stream);
}

async function subscribeToStreamingImageStream(stream: StreamingImageStream) {
  const sessionId = viewerSessionId;
  telemetryDispose?.();
  telemetryDispose = null;
  detectionsTelemetryDispose?.();
  detectionsTelemetryDispose = null;
  latestDetections = [];
  resetSourceRuntimeState();
  activeStreamingStream = stream;

  const resolvedLayers = await Promise.all(
    stream.layers.map(async (layer) => {
      const telemetryBase = await resolveTelemetryBaseUrl(layer);
      const detectionsTelemetryBase =
        layer.detectionsSourceField && usesSeparateDetectionsTelemetry(layer)
          ? await resolveTelemetryBaseUrl({
              telemetryBaseUrl: layer.detectionsTelemetryBaseUrl,
              telemetryModelName: layer.detectionsTelemetryModelName,
              modelName: layer.detectionsSourceModel,
              sourceModel: layer.detectionsSourceModel,
            })
          : null;
      return {
        layer,
        telemetryBase,
        detectionsTelemetryBase,
      };
    })
  );
  if (sessionId !== viewerSessionId) {
    return;
  }

  const primaryLayer = stream.layers[0];
  const primaryTelemetryBase = resolvedLayers[0]?.telemetryBase ?? null;
  if (!primaryTelemetryBase) {
    console.warn(
      "[streaming-image] Unable to resolve telemetry base URL for viewer"
    );
    publishDebugState({ fieldPath: primaryLayer.sourceField, streamId: stream.id });
    return;
  }

  activeCompositeStreamMode = stream.layers.length > 1;
  recreateCanvasSurface(stream.layers);
  ensureStreamSelector(activeStreamSources, stream.id);
  metricsSourceLabel = `${primaryTelemetryBase} :: ${primaryLayer.sourceField}`;
  publishDebugState({
    telemetryBase: primaryTelemetryBase,
    fieldPath: primaryLayer.sourceField,
    streamId: stream.id,
    frameRateHz: activeFrameRateHz,
    telemetrySamplingRateHz: activeTelemetrySamplingRateHz,
  });

  resolvedLayers.forEach(({ layer, telemetryBase }) => {
    if (!telemetryBase) {
      return;
    }
    console.info(
      `[streaming-image] Subscribing to telemetry ${telemetryBase} field ${layer.sourceField} @ ${activeTelemetrySamplingRateHz}Hz, presenting @ ${activeFrameRateHz}Hz`
    );
    const dispose = subscribeTelemetry(
      telemetryBase,
      activeTelemetrySamplingRateHz,
      {
        callback: (model) => handleTelemetryFrame(model, layer),
        error: (err) => {
          console.warn(
            `[streaming-image] Telemetry error for ${telemetryBase} (${layer.sourceField})`,
            err
          );
          noteTransportError();
        },
      }
    );
    if (layer === primaryLayer) {
      telemetryDispose = dispose;
    }
  });

  resolvedLayers.forEach(({ layer, detectionsTelemetryBase }) => {
    if (
      !layer.detectionsSourceField ||
      !detectionsTelemetryBase ||
      detectionsTelemetryDispose
    ) {
      return;
    }

    console.info(
      `[streaming-image] Subscribing to detection overlays ${detectionsTelemetryBase} field ${layer.detectionsSourceField} @ ${activeTelemetrySamplingRateHz}Hz`
    );
    detectionsTelemetryDispose = subscribeTelemetry(
      detectionsTelemetryBase,
      activeTelemetrySamplingRateHz,
      {
        callback: (model) => {
          if (sessionId !== viewerSessionId) {
            return;
          }
          latestDetections = extractObjectDetectionOverlays(
            model.getField?.(layer.detectionsSourceField!)?.getValue?.()
          );
          if (lastFramePresentedAtMs > 0) {
            updateObjectDetectionsOverlay(latestDetections);
          }
        },
        error: (err) => {
          console.warn(
            `[streaming-image] Telemetry error for detection overlays ${detectionsTelemetryBase} (${layer.detectionsSourceField})`,
            err
          );
          noteTransportError();
        },
      }
    );
  });
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
  const activeStream = resolveStreamingImageStream(
    streamingConfig,
    readStoredSelectedStream(activeSelectedStreamStorageKey, activeStreamSources) ??
      undefined
  );
  if (!activeStream) {
    console.warn(
      "[streaming-image] Missing sourceField in viewer configuration"
    );
    return;
  }
  const activeSource = activeStream.layers[0];

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
    streamId: activeStream.id,
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
  ensureStreamSelector(activeStreamSources, activeStream.id);
  writeStoredSelectedStream(activeStream.id);
  await subscribeToStreamingImageStream(activeStream);
}

export async function uninit(): Promise<void> {
  flushMetricsWindow(Date.now(), true);
  telemetryDispose?.();
  telemetryDispose = null;
  viewerSessionId += 1;
  activeCanvas = null;
  activeCanvasContext = null;
  cleanupStatsOverlay();
  cleanupDetectionsOverlay();
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
  source: StreamingImageLayer
) {
  if (!activeCanvas) {
    return;
  }
  const field = model.getField?.(source.sourceField);
  if (!field) {
    return;
  }
  const value = field.getValue?.();
  const bytes = extractStreamingImageBytes(value);
  if (!bytes) {
    return;
  }

  const mime = resolveStreamingImageMime(field.mime_type, bytes);
  const detections = source.detectionsSourceField
    ? usesSeparateDetectionsTelemetry(source)
      ? latestDetections
      : extractObjectDetectionOverlays(
          model.getField?.(source.detectionsSourceField)?.getValue?.()
        )
    : [];
  const frame = {
    mime,
    bytes,
    receivedAtMs: Date.now(),
    transform: source.transform,
    detections,
  };
  lastFrameReceivedAtMs = frame.receivedAtMs;
  stallStateActive = false;
  if (metricsWindow) {
    metricsWindow.receivedFrames += 1;
  }

  if (activeCompositeStreamMode) {
    const targetCanvas = getLayerCanvas(source.index);
    const targetContext = getLayerCanvasContext(source.index);
    if (!targetCanvas || !targetContext) {
      return;
    }
    const renderSessionId = viewerSessionId;
    void renderFrameToCanvas(targetCanvas, targetContext, frame, renderSessionId)
      .then((rendered) => {
        if (!rendered) {
          return;
        }
        if (source.detectionsSourceField) {
          updateObjectDetectionsOverlay(detections);
        }
        if (source.index === 0) {
          notePresentedFrame(frame);
        }
      })
      .catch((err) => {
        console.warn("[streaming-image] Failed to decode layered frame", err);
        noteTransportError();
      });
    return;
  }

  queueFrame(mime, bytes, frame.receivedAtMs, source.transform, detections);
}

function setBlackFrame() {
  const canvases = activeCompositeStreamMode
    ? Array.from(
        activeCanvasStackElement?.querySelectorAll("canvas") ?? []
      )
    : activeCanvas
      ? [activeCanvas]
      : [];

  for (const canvas of canvases) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      continue;
    }
    if (canvas.width !== 1 || canvas.height !== 1) {
      canvas.width = 1;
      canvas.height = 1;
    }
    context.fillStyle = "#000";
    context.fillRect(0, 0, 1, 1);
  }
  clearObjectDetectionsOverlay();
}

async function resolveTelemetryBaseUrl(
  config: StreamingImageLayerInput
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
