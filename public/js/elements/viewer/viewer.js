// viewer.js

let viewerType = null;
let viewerModule = null;

export function init(viewerConfig) {
  const type = viewerConfig?.viewerType;

  if (typeof type !== "string") {
    console.warn(
      "Viewer config is missing or invalid: expected viewer.viewerType as a string"
    );
    return;
  }

  viewerType = type;

  // Fire and forget the async dynamic import
  loadAndInitViewer(type, viewerConfig);
}

export function uninit() {
  if (viewerModule?.default.uninit) {
    viewerModule.default.uninit();
  }
  viewerType = null;
  viewerModule = null;
}

async function loadAndInitViewer(type, config) {
  try {
    switch (type) {
      case "three-js":
        viewerModule = await import("./three/viewer-three.js");
        break;

      case "cesium":
        viewerModule = await import("./cesium/viewer-cesium.js");
        break;

      case "streaming-image":
        console.warn("Streaming-image viewer not implemented yet");
        return;

      default:
        console.warn(`Unknown viewer type: ${type}`);
        return;
    }

    // Safely call init if available
    await viewerModule.default.init(config);
    console.log(`Created viewer of type "${type}"`);
  } catch (err) {
    console.error(`Failed to load viewer module for "${type}"`, err);
  }
}

export default { init, uninit };
