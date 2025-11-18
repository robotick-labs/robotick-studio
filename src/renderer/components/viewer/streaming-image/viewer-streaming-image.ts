// viewer-streaming-image.ts

import type { ViewerConfig } from "../viewer-schema";
import { REMOTE_CONTROL_BASE } from "../../../core/config";

let videoInterval: ReturnType<typeof setInterval> | null = null;
const remoteControlServer = REMOTE_CONTROL_BASE;

export async function init(viewerConfig: ViewerConfig): Promise<void> {
  console.log("Streaming Image Viewer initialized", viewerConfig);

  const viewerContainer = document.getElementById("viewer-container");
  if (!viewerContainer) {
    console.warn("No #viewer-container element found");
    return;
  }

  const cameraImg = document.createElement("img");
  cameraImg.id = "camera-stream";
  viewerContainer.appendChild(cameraImg);

  let lastFrameBlobUrl: string | null = null;

  function refreshCameraFrame() {
    const loaderImg = new Image();
    loaderImg.onload = () => {
      cameraImg.src = loaderImg.src;
      if (lastFrameBlobUrl) URL.revokeObjectURL(lastFrameBlobUrl);
      lastFrameBlobUrl = loaderImg.src;
    };
    loaderImg.onerror = () => {
      console.warn("Camera frame failed to load");
    };

    fetch(`${remoteControlServer}/api/jpeg_data?t=${Date.now()}`)
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
