// viewer-streaming-image.ts

import type { ViewerConfig } from "../viewer-schema";

interface StreamingImageViewerConfig extends ViewerConfig {
  imageSourceUrl?: string;
}

let videoInterval: ReturnType<typeof setInterval> | null = null;
const BLACK_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

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

  let lastFrameBlobUrl: string | null = null;
  const streamingConfig = viewerConfig as StreamingImageViewerConfig;
  const baseImageSourceUrl =
    typeof streamingConfig.imageSourceUrl === "string"
      ? streamingConfig.imageSourceUrl.trim()
      : "";

  function refreshCameraFrame() {
    if (!baseImageSourceUrl) {
      if (cameraImg.src !== BLACK_PIXEL) {
        cameraImg.src = BLACK_PIXEL;
      }
      return;
    }

    const loaderImg = new Image();
    loaderImg.onload = () => {
      cameraImg.src = loaderImg.src;
      if (lastFrameBlobUrl) {
        URL.revokeObjectURL(lastFrameBlobUrl);
        lastFrameBlobUrl = null;
      }
      if (loaderImg.src.startsWith("blob:")) {
        lastFrameBlobUrl = loaderImg.src;
      }
    };
    loaderImg.onerror = () => {
      console.warn("Camera frame failed to load");
      cameraImg.src = BLACK_PIXEL;
    };

    const cacheBustedUrl = `${baseImageSourceUrl}${
      baseImageSourceUrl.includes("?") ? "&" : "?"
    }t=${Date.now()}`;
    fetch(cacheBustedUrl)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP error");
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        loaderImg.src = blobUrl;
      })
      .catch((err) => {
        console.warn("Camera fetch failed:", err);
        cameraImg.src = BLACK_PIXEL;
      });
  }

  const intervalMs = 1000 / 15; // 15 fps
  videoInterval = setInterval(refreshCameraFrame, intervalMs);
}

export async function uninit(): Promise<void> {
  if (videoInterval) {
    clearInterval(videoInterval);
    videoInterval = null;
  }
  const viewerContainer = document.getElementById("viewer-container");
  if (viewerContainer) {
    viewerContainer.innerHTML = "";
  }
  console.log("Streaming Image Viewer unmounted");
}

export default { init, uninit };
