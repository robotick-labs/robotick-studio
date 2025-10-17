import type { ViewerConfig } from "./viewer-schema";

type ViewerType = "three-js" | "cesium" | "streaming-image";

interface ViewerModule {
  default: {
    init: (config: ViewerConfig) => Promise<void>;
    uninit?: () => Promise<void>;
  };
}

let viewerType: ViewerType | null = null;
/** Only set after a successful init for the current token */
let viewerModule: ViewerModule | null = null;

/** Monotonic sequence for loads; every init/uninit bumps it. */
let loadSeq = 0;
/** The token that represents the latest requested viewer. */
let currentToken = 0;

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

  // Generate a fresh token for this init and mark it current.
  const token = ++loadSeq;
  currentToken = token;

  // Fire-and-forget the async initializer (guarded by token checks).
  void loadAndInitViewer(viewerType, viewerConfig as ViewerConfig, token);
}

/**
 * Teardown any active viewer and invalidate in-flight loads
 * by bumping the token. Returns a promise you may await if desired.
 */
export async function uninit(): Promise<void> {
  // Invalidate any in-flight loads or future 'late' completions.
  const token = ++loadSeq;
  currentToken = token;

  // Snapshot existing module; clear references immediately.
  const prev = viewerModule;
  viewerType = null;
  viewerModule = null;

  try {
    if (prev?.default.uninit) {
      await prev.default.uninit();
    }
  } catch (err) {
    console.error("Error during viewer uninit:", err);
  }
}

async function loadAndInitViewer(
  type: ViewerType,
  config: ViewerConfig,
  token: number
): Promise<void> {
  try {
    // Resolve module locally; don't touch globals yet.
    let mod: ViewerModule | null = null;

    switch (type) {
      case "three-js":
        mod = (await import("./three/viewer-three")) as ViewerModule;
        break;

      case "cesium":
        mod = (await import("./cesium/viewer-cesium")) as ViewerModule;
        break;

      case "streaming-image":
        mod = (await import(
          "./streaming-image/viewer-streaming-image"
        )) as ViewerModule;
        break;

      default:
        console.warn(`Unknown viewer type: ${type}`);
        return;
    }

    // If this load has been superseded, ignore it.
    if (token !== currentToken) {
      // Optional: best-effort cleanup of a just-loaded module we won't use.
      try {
        await mod?.default?.uninit?.();
      } catch {
        /* ignore */
      }
      return;
    }

    // Teardown any currently live viewer before re-init (still under the same token).
    if (viewerModule?.default.uninit) {
      try {
        await viewerModule.default.uninit();
      } catch (err) {
        console.error("Error uninitialising previous viewer:", err);
      }
    }

    // Still current? (A rapid uninit/init could have happened while we awaited)
    if (token !== currentToken) {
      try {
        await mod?.default?.uninit?.();
      } catch {
        /* ignore */
      }
      return;
    }

    console.log(`Creating viewer of type "${type}"`);
    await mod.default.init(config);

    // After init completes, confirm we are still the latest request.
    if (token !== currentToken) {
      // We were superseded after successful init; tear down what we just made.
      try {
        await mod.default.uninit?.();
      } catch {
        /* ignore */
      }
      return;
    }

    // Success: publish the module only now.
    viewerModule = mod;
    console.log(`Created viewer of type "${type}"`);
  } catch (err) {
    // Only log as current if still current; otherwise it's noise from a cancelled attempt.
    if (token === currentToken) {
      console.error(`Failed to load viewer module for "${type}"`, err);
    } else {
      // Silently ignore errors from cancelled attempts.
    }
  }
}

export default { init, uninit };
