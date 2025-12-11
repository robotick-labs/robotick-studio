// viewer-cesium.ts
// Robotick Studio configurable Cesium viewer

import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import type { ViewerConfig } from "../viewer-schema.js";
import {
  ITelemetryModel,
  subscribeTelemetry,
} from "../../../data-sources/telemetry/index.js";
import { ProjectData } from "../../../data-sources/launcher/index.js";

type GeoPosition = {
  lat: number;
  lon: number;
  height?: number;
  altitude?: number;
};

type CesiumModelConfig = {
  id: string;
  name?: string;
  uri: string;
  position: GeoPosition;
  orientationDegrees?: {
    heading?: number;
    pitch?: number;
    roll?: number;
  };
  scale?: number;
  minimumPixelSize?: number;
  show?: boolean;
};

type CesiumCameraConfig = {
  target?: GeoPosition;
  offset?: [number, number, number];
  followModelId?: string | null;
};

type CesiumTelemetryFields = {
  latitude: string;
  longitude: string;
  altitude: string;
  roll?: string;
  pitch?: string;
  yaw?: string;
  altitudeUnits?: "meters" | "feet";
  altitudeOffsetMeters?: number;
  orientationUnits?: "degrees" | "radians";
};

type CesiumTelemetryTrackerConfig = {
  id: string;
  modelId: string;
  workloadName: string;
  fields: CesiumTelemetryFields;
  telemetryModelName?: string;
  baseUrl?: string;
  pollingRateHz?: number;
};

type CesiumOptions = {
  useWorldTerrain?: boolean;
  enableLighting?: boolean;
  camera?: CesiumCameraConfig;
  models?: CesiumModelConfig[];
  telemetryTrackers?: CesiumTelemetryTrackerConfig[];
  clock?: {
    shouldAnimate?: boolean;
    currentTime?: string | Date | number;
  };
  viewerOptions?: Partial<Cesium.Viewer.ConstructorOptions>;
};

type CesiumViewerConfig = ViewerConfig & {
  telemetryModelName?: string;
  modelUri?: string;
  cesium?: CesiumOptions;
};

const DEFAULT_CAMERA_OFFSET: [number, number, number] = [-11.71, -10.35, 10.1];

let CESIUM_TOKEN: string | null = null;
let viewer: Cesium.Viewer | null = null;
let containerElement: HTMLElement | null = null;
const entitiesById = new Map<string, Cesium.Entity>();
const telemetrySubscriptions = new Map<string, () => void>();
let exitRequested = false;
let cameraOffset: Cesium.Cartesian3 | null = null;
let cameraFollowModelId: string | null = null;

// ---------------------------------------------------------------------------
// Token loading
/**
 * Resolve the Cesium access token from configured environment sources.
 *
 * Checks (in order) a token on `window.robotick.environment.cesiumToken`, `import.meta.env.CESIUM_TOKEN`,
 * and `process.env.CESIUM_TOKEN`, returning the first non-empty value trimmed of whitespace.
 *
 * @returns The trimmed Cesium token string if found, or an empty string if none is configured.
 */

function resolveCesiumToken(): string {
  const fromWindow =
    typeof window !== "undefined"
      ? window.robotick?.environment?.cesiumToken
      : undefined;
  if (typeof fromWindow === "string" && fromWindow.trim()) {
    return fromWindow.trim();
  }

  const fromImport = import.meta.env?.CESIUM_TOKEN;
  if (typeof fromImport === "string" && fromImport.trim()) {
    return fromImport.trim();
  }

  const fromProcess =
    typeof process !== "undefined" ? process.env?.CESIUM_TOKEN : undefined;
  if (typeof fromProcess === "string" && fromProcess.trim()) {
    return fromProcess.trim();
  }

  return "";
}

const secretsPromise: Promise<void> = (async () => {
  const token = resolveCesiumToken();
  if (token) {
    CESIUM_TOKEN = token;
    console.log("✅ Loaded CESIUM_TOKEN from environment");
    return;
  }

  console.error(
    "❌ CESIUM_TOKEN not configured. Set the CESIUM_TOKEN environment variable before launching Robotick Studio."
  );
})();

// ---------------------------------------------------------------------------

async function init(
  config: CesiumViewerConfig,
  _instanceId?: number
): Promise<void> {
  if (viewer) {
    console.warn("Visualizer already initialized.");
    return;
  }

  exitRequested = false;
  await secretsPromise;
  Cesium.Ion.defaultAccessToken = CESIUM_TOKEN!;

  const container =
    (config.container instanceof HTMLElement
      ? config.container
      : document.getElementById("viewer-container")) ?? null;
  if (!container) {
    console.warn("[cesium] No viewer container available");
    return;
  }
  containerElement = container;

  const cesiumOptions = config.cesium ?? {};
  const viewerOptions: Cesium.Viewer.ConstructorOptions = {
    terrain:
      cesiumOptions.useWorldTerrain === false
        ? undefined
        : Cesium.Terrain.fromWorldTerrain({
            requestVertexNormals: true,
            requestWaterMask: true,
          }),
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    homeButton: false,
    sceneModePicker: false,
    geocoder: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: cesiumOptions.clock?.shouldAnimate ?? true,
    ...cesiumOptions.viewerOptions,
  };
  viewer = new Cesium.Viewer(container, viewerOptions);

  configureControls(config);

  viewer.clock.shouldAnimate = cesiumOptions.clock?.shouldAnimate ?? false;
  viewer.clock.currentTime = toJulianDate(
    cesiumOptions.clock?.currentTime ?? new Date()
  );
  viewer.scene.globe.enableLighting = cesiumOptions.enableLighting ?? true;

  const modelConfigs = buildModelConfigs(config);
  entitiesById.clear();
  for (const modelConfig of modelConfigs) {
    const entity = createModelEntity(modelConfig);
    if (entity) {
      entitiesById.set(modelConfig.id, entity);
    }
  }

  cameraOffset = createCameraOffset(cesiumOptions.camera?.offset);
  cameraFollowModelId =
    cesiumOptions.camera?.followModelId ?? modelConfigs[0]?.id ?? null;
  const initialCameraTarget =
    cesiumOptions.camera?.target ?? modelConfigs[0]?.position ?? null;
  if (initialCameraTarget) {
    lookAtCartesian(cartesianFromGeo(initialCameraTarget));
  }

  await installTelemetryTrackers(config);
}

/**
 * Apply pan/zoom/rotate/tilt control settings from the provided viewer configuration to the Cesium camera controller.
 *
 * Reads the `controls` section of `config` and sets the viewer's screenSpaceCameraController flags:
 * - when `controls.enabled` is truthy, enables rotate, tilt, look, and zoom;
 * - enables translate (screen-space panning) only when `controls.enabled` is truthy and `controls.screenSpacePanning` is truthy.
 *
 * @param config - Viewer configuration containing an optional `controls` object with `enabled` and `screenSpacePanning` flags
 */

function configureControls(config: ViewerConfig): void {
  if (!viewer) return;
  const controlsCfg = config.controls;
  const controller = viewer.scene.screenSpaceCameraController;
  const enabled = controlsCfg?.enabled ?? false;
  controller.enableRotate = enabled;
  controller.enableTilt = enabled;
  controller.enableLook = enabled;
  controller.enableZoom = enabled;
  const screenSpacePanning = controlsCfg?.screenSpacePanning ?? false;
  controller.enableTranslate = enabled && screenSpacePanning;
}

/**
 * Determine the list of Cesium model configurations to use based on the viewer configuration.
 *
 * @param config - The viewer configuration used to derive model entries.
 * @returns An array of `CesiumModelConfig` objects: if `config.cesium?.models` is present and non-empty it is returned unchanged; otherwise a single default model is created from `config.modelUri` and the camera target (or `{ lat: 0, lon: 0, height: 0 }`); returns an empty array if no model URI is available.
 */
function buildModelConfigs(config: CesiumViewerConfig): CesiumModelConfig[] {
  const explicit = config.cesium?.models;
  if (explicit?.length) {
    return explicit;
  }
  const fallbackUri = config.modelUri?.trim();
  if (!fallbackUri) {
    console.warn("[Cesium viewer] No models configured; scene will be empty.");
    return [];
  }
  return [
    {
      id: "primary-model",
      uri: fallbackUri,
      position: config.cesium?.camera?.target ?? {
        lat: 0,
        lon: 0,
        height: 0,
      },
    },
  ];
}

function createModelEntity(model: CesiumModelConfig): Cesium.Entity | null {
  if (!viewer) return null;
  const position = cartesianFromGeo(model.position);
  const heading = Cesium.Math.toRadians(model.orientationDegrees?.heading ?? 0);
  const pitch = Cesium.Math.toRadians(model.orientationDegrees?.pitch ?? 0);
  const roll = Cesium.Math.toRadians(model.orientationDegrees?.roll ?? 0);
  return viewer.entities.add({
    name: model.name ?? model.id,
    show: model.show ?? true,
    position,
    model: {
      uri: model.uri,
      scale: model.scale ?? 1.0,
      minimumPixelSize: model.minimumPixelSize ?? 64,
    },
    orientation: Cesium.Transforms.headingPitchRollQuaternion(
      position,
      new Cesium.HeadingPitchRoll(heading, pitch, roll)
    ),
  });
}

function cartesianFromGeo(position: GeoPosition): Cesium.Cartesian3 {
  const lat = position.lat ?? 0;
  const lon = position.lon ?? 0;
  const height =
    typeof position.height === "number"
      ? position.height
      : typeof position.altitude === "number"
      ? position.altitude
      : 0;
  return Cesium.Cartesian3.fromDegrees(lon, lat, height);
}

function createCameraOffset(
  offset?: [number, number, number]
): Cesium.Cartesian3 {
  const [x, y, z] = offset ?? DEFAULT_CAMERA_OFFSET;
  return new Cesium.Cartesian3(x, y, z);
}

function lookAtCartesian(position: Cesium.Cartesian3): void {
  if (!viewer || viewer.isDestroyed() || !cameraOffset) {
    return;
  }
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(position);
  const offset = Cesium.Matrix4.multiplyByPoint(
    transform,
    cameraOffset,
    new Cesium.Cartesian3()
  );
  viewer.camera.lookAt(
    position,
    new Cesium.Cartesian3(
      offset.x - position.x,
      offset.y - position.y,
      offset.z - position.z
    )
  );
}

// ---------------------------------------------------------------------------

async function installTelemetryTrackers(
  viewerConfig: CesiumViewerConfig
): Promise<void> {
  exitRequested = false;
  telemetrySubscriptions.forEach((dispose) => dispose());
  telemetrySubscriptions.clear();
  const trackers = viewerConfig.cesium?.telemetryTrackers ?? [];
  if (!trackers.length) {
    console.warn(
      "[Cesium viewer] No telemetry trackers configured; telemetry disabled."
    );
    return;
  }

  for (const tracker of trackers) {
    const entity = entitiesById.get(tracker.modelId);
    if (!entity) {
      console.warn(
        `[Cesium viewer] Telemetry tracker ${tracker.id} references unknown model "${tracker.modelId}"`
      );
      continue;
    }
    if (!tracker.fields.latitude || !tracker.fields.longitude || !tracker.fields.altitude) {
      console.warn(
        `[Cesium viewer] Telemetry tracker ${tracker.id} is missing mandatory latitude/longitude/altitude fields`
      );
      continue;
    }

    const telemetryBaseUrl = tracker.baseUrl?.trim()
      ? tracker.baseUrl.trim()
      : await resolveCesiumTelemetryBase(
          tracker.telemetryModelName ?? viewerConfig.telemetryModelName
        );
    if (!telemetryBaseUrl) {
      console.warn(
        `[Cesium viewer] Unable to resolve telemetry endpoint for tracker ${tracker.id}; skipping.`
      );
      continue;
    }

    const pollingRate = tracker.pollingRateHz ?? 30;
    const unsubscribe = subscribeTelemetry(telemetryBaseUrl, pollingRate, {
      callback: (model) => {
        if (exitRequested) return;
        try {
          updateModelFromTelemetry(tracker, model);
        } catch (err) {
          console.warn(
            `[Cesium viewer] Telemetry tracker ${tracker.id} update failed`,
            err
          );
        }
      },
      error: (err) =>
        console.warn(
          `[Cesium viewer] telemetry error for tracker ${tracker.id}:`,
          err
        ),
    });
    telemetrySubscriptions.set(tracker.id, unsubscribe);
  }
}

function updateModelFromTelemetry(
  tracker: CesiumTelemetryTrackerConfig,
  telemetryModel: ITelemetryModel
): void {
  const lat = readTelemetryNumber(
    telemetryModel,
    tracker.workloadName,
    tracker.fields.latitude
  );
  const lon = readTelemetryNumber(
    telemetryModel,
    tracker.workloadName,
    tracker.fields.longitude
  );
  const rawAlt = readTelemetryNumber(
    telemetryModel,
    tracker.workloadName,
    tracker.fields.altitude
  );

  const altitudeUnits = tracker.fields.altitudeUnits ?? "meters";
  const altitudeOffset = tracker.fields.altitudeOffsetMeters ?? 0;
  const altitudeMeters =
    (altitudeUnits === "feet" ? rawAlt * 0.3048 : rawAlt) + altitudeOffset;

  const orientationUnits = tracker.fields.orientationUnits ?? "degrees";
  const angleConverter = (value: number) =>
    orientationUnits === "radians" ? value : Cesium.Math.toRadians(value);
  const roll = tracker.fields.roll
    ? angleConverter(
        readTelemetryNumber(
          telemetryModel,
          tracker.workloadName,
          tracker.fields.roll
        )
      )
    : 0;
  const pitch = tracker.fields.pitch
    ? angleConverter(
        readTelemetryNumber(
          telemetryModel,
          tracker.workloadName,
          tracker.fields.pitch
        )
      )
    : 0;
  const yaw = tracker.fields.yaw
    ? angleConverter(
        readTelemetryNumber(
          telemetryModel,
          tracker.workloadName,
          tracker.fields.yaw
        )
      )
    : 0;

  const position = Cesium.Cartesian3.fromDegrees(lon, lat, altitudeMeters);
  const orientation = Cesium.Transforms.headingPitchRollQuaternion(
    position,
    new Cesium.HeadingPitchRoll(yaw, pitch, roll)
  );

  const entity = entitiesById.get(tracker.modelId);
  if (!entity) {
    return;
  }
  entity.position = new Cesium.ConstantPositionProperty(position);
  entity.orientation = new Cesium.ConstantProperty(orientation);

  if (
    viewer &&
    !viewer.isDestroyed() &&
    cameraFollowModelId &&
    tracker.modelId === cameraFollowModelId
  ) {
    lookAtCartesian(position);
  }
}

function readTelemetryNumber(
  telemetryModel: ITelemetryModel,
  workloadName: string,
  fieldPath: string
): number {
  const trimmed = fieldPath?.trim();
  if (!trimmed) return 0;
  const fullPath = trimmed.startsWith(`${workloadName}.`)
    ? trimmed
    : `${workloadName}.${trimmed}`;
  const field = telemetryModel.getField?.(fullPath);
  const value = field?.getValue?.();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof (value as any)?.byteLength === "number") {
    return 0;
  }
  if (typeof (field as any)?.value === "number") {
    return (field as any).value as number;
  }
  const fallback = (field as any)?.value;
  const parsed = parseFloat(String(fallback ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------

async function uninit(_instanceId?: number): Promise<void> {
  if (!viewer) return;

  console.log("Visualizer uninitializing");
  exitRequested = true;
  telemetrySubscriptions.forEach((dispose) => dispose());
  telemetrySubscriptions.clear();

  if (!viewer.isDestroyed()) {
    viewer.destroy();
  }

  viewer = null;
  entitiesById.clear();
  cameraOffset = null;
  cameraFollowModelId = null;

  if (containerElement) {
    containerElement.innerHTML = "";
    containerElement = null;
  }
}

// ---------------------------------------------------------------------------

export default { init, uninit };

function toJulianDate(value: string | Date | number): Cesium.JulianDate {
  if (value instanceof Date) {
    return Cesium.JulianDate.fromDate(value);
  }
  if (typeof value === "number") {
    return Cesium.JulianDate.fromDate(new Date(value));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? Cesium.JulianDate.now()
    : Cesium.JulianDate.fromDate(parsed);
}

async function resolveCesiumTelemetryBase(
  modelName?: string | null
): Promise<string | null> {
  const trimmed = modelName?.trim();
  if (!trimmed) {
    console.warn(
      "[Cesium viewer] Missing telemetryModelName in configuration; telemetry disabled."
    );
    return null;
  }

  try {
    const descriptor = await ProjectData.waitForModelDescriptorByName(
      trimmed
    );
    if (!descriptor) {
      console.warn(
        `[Cesium viewer] Telemetry model "${trimmed}" not found in project data.`
      );
      return null;
    }
    return descriptor.telemetryBaseUrl;
  } catch (err) {
    console.warn(
      `[Cesium viewer] Failed to resolve telemetry model "${trimmed}"`,
      err
    );
    return null;
  }
}