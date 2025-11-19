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

/** The token that represents the latest requested viewer. */
let currentToken = Number.NaN;

function normalizeConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeConfig(entry));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (isDomNode(record)) return undefined;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const normalizedValue = normalizeConfig(record[key]);
      if (normalizedValue !== undefined) {
        normalized[key] = normalizedValue;
      }
    }
    return normalized;
  }

  if (typeof value === "function") {
    return undefined;
  }

  if (isDomNode(value)) return undefined;

  return value;
}

function isDomNode(value: unknown): value is Node {
  if (typeof window === "undefined") return false;
  return (
    typeof Node !== "undefined" &&
    value instanceof Node
  );
}

function computeViewerToken(config: ViewerConfig): number {
  const serialized = JSON.stringify(normalizeConfig(config)) ?? "";
  let hash = 0;
  for (let i = 0; i < serialized.length; i += 1) {
    hash = (hash * 31 + serialized.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

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

  const resolvedConfig = viewerConfig as ViewerConfig;
  const token = computeViewerToken(resolvedConfig);
  currentToken = token;

  // Fire-and-forget the async initializer (guarded by token checks).
  void loadAndInitViewer(viewerType, resolvedConfig, token);
}

/**
 * Teardown any active viewer and invalidate in-flight loads
 * by bumping the token. Returns a promise you may await if desired.
 */
export async function uninit(reason?: string): Promise<void> {
  // Invalidate any in-flight loads or future 'late' completions.
  currentToken = Number.NaN;

  // Snapshot existing module; clear references immediately.
  const prev = viewerModule;
  if (prev && reason) {
    console.info(`[viewer] Uninitializing due to: ${reason}`);
  }
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
      // best-effort cleanup of a just-loaded module we won't use.
      try {
        await mod?.default?.uninit?.();
      } catch {
        console.error("Error uninitialising previous viewer:", err);
      }
      return;
    }

    try {
      console.log(`Creating viewer of type "${type}"`);
      await mod.default.init(config);
    } catch (err) {
      console.error("Error initialising new viewer:", err);
    }

    // After init completes, confirm we are still the latest request.
    if (token !== currentToken) {
      // We were superseded after successful init; tear down what we just made.
      try {
        console.log(`Destroying superseded viewer`);
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
