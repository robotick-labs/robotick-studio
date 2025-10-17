import type { ViewerConfig } from "./viewer-schema";

type ViewerType = "three-js" | "cesium" | "streaming-image";

interface ViewerModule {
  default: {
    init: (config: ViewerConfig) => Promise<void>;
    uninit?: () => void;
  };
}

let viewerType: ViewerType | null = null;
let viewerModule: ViewerModule | null = null;

export function init(
  viewerConfig: Partial<ViewerConfig> & { viewerType?: string }
): void {
  const type = viewerConfig?.viewerType;

  if (typeof type !== "string") {
    console.warn(
      "Viewer config is missing or invalid: expected viewer.viewerType as a string"
    );
    return;
  }

  viewerType = type as ViewerType;

  // Fire and forget the async dynamic import
  loadAndInitViewer(viewerType, viewerConfig as ViewerConfig);
}

export function uninit(): void {
  if (viewerModule?.default.uninit) {
    viewerModule.default.uninit();
  }
  viewerType = null;
  viewerModule = null;
}

async function loadAndInitViewer(
  type: ViewerType,
  config: ViewerConfig
): Promise<void> {
  try {
    switch (type) {
      case "three-js":
        viewerModule = (await import(
          "./three/viewer-three.js"
        )) as ViewerModule;
        break;

      case "cesium":
        viewerModule = (await import(
          "./cesium/viewer-cesium.js"
        )) as ViewerModule;
        break;

      case "streaming-image":
        viewerModule = (await import(
          "./streaming-image/viewer-streaming-image.js"
        )) as ViewerModule;
        break;

      default:
        console.warn(`Unknown viewer type: ${type}`);
        return;
    }

    console.log(`Creating viewer of type "${type}"`);
    await viewerModule.default.init(config);
    console.log(`Created viewer of type "${type}"`);
  } catch (err) {
    console.error(`Failed to load viewer module for "${type}"`, err);
  }
}

export default { init, uninit };
