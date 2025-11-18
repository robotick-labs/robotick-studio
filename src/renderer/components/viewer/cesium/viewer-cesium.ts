// viewer-cesium.ts
// Robotick Hub 3D flight viewer (Cesium) using live telemetry from JSBSim workload.

import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import type { ViewerConfig } from "../viewer-schema.js";
import {
  ITelemetryModel,
  subscribeTelemetry,
} from "../../../data-sources/telemetry/index.js";
import { ProjectData } from "../../../data-sources/launcher/index.js";

type CesiumViewerConfig = ViewerConfig & {
  telemetryModelName?: string;
};

let CESIUM_TOKEN: string | null = null;
let viewer: Cesium.Viewer | null = null;
let rocketEntity: Cesium.Entity | null = null;
let exitRequested = false;
let cameraOffset: Cesium.Cartesian3 | null = null;
let telemetryUnsubscribe: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Token loading
// ---------------------------------------------------------------------------

const secretsPromise: Promise<void> = (async () => {
  try {
    const { CESIUM_TOKEN: LOCAL } = await import("./secrets_LOCAL.js");
    CESIUM_TOKEN = LOCAL;
    console.log("✅ Loaded CESIUM_TOKEN from secrets_LOCAL.js");
  } catch {
    const { CESIUM_TOKEN: DEFAULT } = await import("./secrets.js");
    CESIUM_TOKEN = DEFAULT;
    console.log("ℹ️ Loaded CESIUM_TOKEN from secrets.js");
  }
})();

// ---------------------------------------------------------------------------

async function init(config: ViewerConfig): Promise<void> {
  if (viewer) {
    console.warn("Visualizer already initialized.");
    return;
  }

  exitRequested = false;
  await secretsPromise;
  Cesium.Ion.defaultAccessToken = CESIUM_TOKEN!;

  viewer = new Cesium.Viewer("viewer-container", {
    terrain: Cesium.Terrain.fromWorldTerrain({
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
    shouldAnimate: true,
  });

  const controls = viewer.scene.screenSpaceCameraController;
  controls.enableRotate = false;
  controls.enableTranslate = false;
  controls.enableZoom = false;
  controls.enableTilt = false;
  controls.enableLook = false;

  viewer.clock.shouldAnimate = false;
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(
    new Date(Date.UTC(2025, 8, 30, 17, 40, 0))
  );

  viewer.scene.globe.enableLighting = true;

  const lon = -3.0716882;
  const lat = 54.3640662;
  const alt = 102;

  const rocketPosition = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
  rocketEntity = viewer.entities.add({
    name: "Rocket",
    position: rocketPosition,
    model: {
      uri: "glb/robotick_simple_rocket.glb",
      scale: 1.0,
      minimumPixelSize: 64,
    },
    orientation: Cesium.Transforms.headingPitchRollQuaternion(
      rocketPosition,
      new Cesium.HeadingPitchRoll(0, 0, 0)
    ),
  });

  const cameraOffsetLin = new Cesium.Cartesian3(11.71, 10.35, 10.1);
  cameraOffset = Cesium.Matrix3.multiplyByVector(
    Cesium.Matrix3.fromRotationZ(Math.PI),
    cameraOffsetLin,
    new Cesium.Cartesian3()
  );

  lookAtRocket(rocketPosition);
  await startRocketTracking(config as CesiumViewerConfig);
}

// ---------------------------------------------------------------------------

function lookAtRocket(position: Cesium.Cartesian3): void {
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(position);
  const offset = Cesium.Matrix4.multiplyByPoint(
    transform,
    cameraOffset!,
    new Cesium.Cartesian3()
  );

  viewer!.camera.lookAt(
    position,
    new Cesium.Cartesian3(
      offset.x - position.x,
      offset.y - position.y,
      offset.z - position.z
    )
  );
}

// ---------------------------------------------------------------------------

async function startRocketTracking(
  viewerConfig?: CesiumViewerConfig
): Promise<void> {
  exitRequested = false;
  telemetryUnsubscribe?.();
  const telemetryBaseUrl = await resolveCesiumTelemetryBase(viewerConfig);
  if (!telemetryBaseUrl) {
    console.warn(
      "[Cesium viewer] Unable to resolve telemetry endpoint; telemetry disabled."
    );
    return;
  }

  telemetryUnsubscribe = subscribeTelemetry(telemetryBaseUrl, 33, {
    callback: (model) => {
      if (exitRequested) return;
      try {
        updateRocketFromTelemetry(model);
      } catch (err) {
        console.warn("Rocket tracking update failed:", err);
      }
    },
    error: (err) => console.warn("[Cesium viewer] telemetry error:", err),
  });
}

// ---------------------------------------------------------------------------
// Full fetch-decode-update path (no caching)
// ---------------------------------------------------------------------------

function updateRocketFromTelemetry(model: ITelemetryModel): void {
  const workloadName = "jsb_sim";

  const get = (fieldPath: string): number =>
    parseFloat(
      model.getField(`${workloadName}.outputs.${fieldPath}`)?.getValue?.() ??
        "0"
    );

  const lat = get("fcs_position_lat_deg");
  const lon = get("fcs_position_long_deg");
  const alt = get("fcs_position_alt_sl_ft") * 0.3048 + 100;

  const roll = Cesium.Math.toRadians(get("fcs_attitude_roll_deg"));
  const pitch = Cesium.Math.toRadians(get("fcs_attitude_pitch_deg"));
  const yaw = Cesium.Math.toRadians(get("fcs_attitude_yaw_deg"));

  const position = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
  const orientation = Cesium.Transforms.headingPitchRollQuaternion(
    position,
    new Cesium.HeadingPitchRoll(yaw, pitch, roll)
  );

  if (rocketEntity) {
    rocketEntity.position = new Cesium.ConstantPositionProperty(position);
    rocketEntity.orientation = new Cesium.ConstantProperty(orientation);
  }

  if (viewer && !viewer.isDestroyed()) {
    lookAtRocket(position);
  }
}

// ---------------------------------------------------------------------------

function uninit(): void {
  if (!viewer) return;

  console.log("Visualizer uninitializing");
  exitRequested = true;
  if (telemetryUnsubscribe) {
    telemetryUnsubscribe();
    telemetryUnsubscribe = null;
  }

  if (!viewer.isDestroyed()) {
    viewer.destroy();
  }

  viewer = null;
  rocketEntity = null;
  cameraOffset = null;

  const container = document.getElementById("viewer-container");
  if (container) container.innerHTML = "";
}

// ---------------------------------------------------------------------------

export default { init, uninit };

async function resolveCesiumTelemetryBase(
  config?: CesiumViewerConfig
): Promise<string | null> {
  const modelName = config?.telemetryModelName?.trim();
  if (!modelName) {
    console.warn(
      "[Cesium viewer] Missing telemetryModelName in configuration; telemetry disabled."
    );
    return null;
  }

  try {
    const descriptor = await ProjectData.waitForModelDescriptorByName(
      modelName
    );
    if (!descriptor) {
      console.warn(
        `[Cesium viewer] Telemetry model "${modelName}" not found in project data.`
      );
      return null;
    }
    return descriptor.telemetryBaseUrl;
  } catch (err) {
    console.warn(
      `[Cesium viewer] Failed to resolve telemetry model "${modelName}"`,
      err
    );
    return null;
  }
}
