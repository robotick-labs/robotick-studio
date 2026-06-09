import type { ViewerConfig } from "./viewer-schema";

type ViewerType = "three-js" | "cesium" | "streaming-image";

export interface ViewerRuntime {
  unmount: () => Promise<void> | void;
}

interface ViewerModule {
  default: {
    createInstance?: (
      config: ViewerConfig,
      instanceId: number
    ) => Promise<ViewerRuntime>;
    init: (config: ViewerConfig, instanceId: number) => Promise<void>;
    uninit?: (instanceId?: number) => Promise<void>;
  };
}

type ViewerInstance = {
  id: number;
  type: ViewerType;
  module: ViewerModule;
  runtime: ViewerRuntime;
};

let nextInstanceId = 1;
const instances = new Map<number, ViewerInstance>();

async function loadViewerModule(type: ViewerType): Promise<ViewerModule | null> {
  switch (type) {
    case "three-js":
      return import("./three/viewer-three") as Promise<ViewerModule>;
    case "cesium":
      return import("./cesium/viewer-cesium") as Promise<ViewerModule>;
    case "streaming-image":
      return import(
        "./streaming-image/viewer-streaming-image"
      ) as Promise<ViewerModule>;
    default:
      console.warn(`Unknown viewer type: ${type}`);
      return null;
  }
}

export async function init(
  viewerConfig: Partial<ViewerConfig> & { viewerType?: string }
): Promise<number | null> {
  const type = viewerConfig?.viewerType;

  if (typeof type !== "string") {
    console.warn(
      "Viewer config is missing or invalid: expected viewer.viewerType as a string"
    );
    return null;
  }

  const module = await loadViewerModule(type as ViewerType);
  if (!module) return null;

  const resolvedConfig = viewerConfig as ViewerConfig;
  const instanceId = nextInstanceId++;

  try {
    const runtime = module.default.createInstance
      ? await module.default.createInstance(resolvedConfig, instanceId)
      : await (async (): Promise<ViewerRuntime> => {
          await module.default.init(resolvedConfig, instanceId);
          return {
            unmount: () => module.default.uninit?.(instanceId),
          };
        })();
    instances.set(instanceId, {
      id: instanceId,
      type: type as ViewerType,
      module,
      runtime,
    });
    console.log(
      `Created viewer of type "${type}" (instance ${instanceId})`
    );
    return instanceId;
  } catch (err) {
    console.error("Error initialising viewer:", err);
    return null;
  }
}

export async function uninit(
  instanceId?: number,
  reason?: string
): Promise<void> {
  if (instanceId != null) {
    const record = instances.get(instanceId);
    if (!record) return;
    if (reason) {
      console.info(
        `[viewer] Uninitializing instance ${instanceId} due to: ${reason}`
      );
    }
    instances.delete(instanceId);
    try {
      await record.runtime.unmount();
    } catch (err) {
      console.error("Error during viewer uninit:", err);
    }
    return;
  }

  if (instances.size === 0) {
    if (reason) {
      console.info(`[viewer] No active viewers to uninitialize.`);
    }
    return;
  }

  if (reason) {
    console.info(`[viewer] Uninitializing all viewers due to: ${reason}`);
  }
  const entries = Array.from(instances.values());
  instances.clear();

  for (const { runtime } of entries) {
    try {
      await runtime.unmount();
    } catch (err) {
      console.error("Error during viewer uninit:", err);
    }
  }
}

export default { init, uninit };
