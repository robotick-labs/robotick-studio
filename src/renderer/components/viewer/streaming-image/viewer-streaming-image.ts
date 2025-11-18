// viewer-streaming-image.ts

import type { ViewerConfig } from "../viewer-schema";
import { subscribeTelemetry } from "../../../core/telemetry/telemetry-store";
import type { ITelemetryModel } from "../../../core/telemetry/telemetry-client";
import {
  findModelDescriptorInState,
  waitForProjectModelsLoaded,
} from "../../../core/launcher/LauncherDataContext";

interface StreamingImageViewerConfig extends ViewerConfig {
  sourceModel?: string; // legacy
  modelName?: string;
  telemetryModelName?: string;
  sourceField?: string;
  telemetryBaseUrl?: string;
  telemetryIntervalMs?: number;
}

const BLACK_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

let telemetryDispose: (() => void) | null = null;
let lastFrameBlobUrl: string | null = null;
let activeImg: HTMLImageElement | null = null;

export async function init(viewerConfig: ViewerConfig): Promise<void> {
  console.log("Streaming Image Viewer initialized", viewerConfig);

  const viewerContainer = document.getElementById("viewer-container");
  if (!viewerContainer) {
    console.warn("No #viewer-container element found");
    return;
  }

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

  const interval = streamingConfig.telemetryIntervalMs ?? 100;
  console.info(
    `[streaming-image] Subscribing to telemetry ${telemetryBase} field ${fieldPath} @ ${interval}ms`
  );
  telemetryDispose = subscribeTelemetry(telemetryBase, interval, {
    callback: (model) => handleTelemetryFrame(model, fieldPath),
    error: (err) => {
      console.warn(
        `[streaming-image] Telemetry error for ${telemetryBase} (${fieldPath})`,
        err
      );
      setBlackFrame();
    },
  });
}

export async function uninit(): Promise<void> {
  telemetryDispose?.();
  telemetryDispose = null;
  if (lastFrameBlobUrl) {
    URL.revokeObjectURL(lastFrameBlobUrl);
    lastFrameBlobUrl = null;
  }
  activeImg = null;
  const viewerContainer = document.getElementById("viewer-container");
  if (viewerContainer) {
    viewerContainer.innerHTML = "";
  }
  console.log("Streaming Image Viewer unmounted");
}

function handleTelemetryFrame(model: ITelemetryModel, fieldPath: string) {
  if (!activeImg) return;
  const field = model.getField?.(fieldPath);
  if (!field) {
    setBlackFrame();
    return;
  }
  const value = field.getValue?.();
  if (!(value instanceof Uint8Array)) {
    setBlackFrame();
    return;
  }

  const mime = field.mime_type || "image/jpeg";
  const blob = new Blob([value], { type: mime });
  const blobUrl = URL.createObjectURL(blob);
  activeImg.src = blobUrl;
  if (lastFrameBlobUrl) {
    URL.revokeObjectURL(lastFrameBlobUrl);
  }
  lastFrameBlobUrl = blobUrl;
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
    const state = await waitForProjectModelsLoaded();
    const match = findModelDescriptorInState(state, sourceModelName) ?? null;
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
