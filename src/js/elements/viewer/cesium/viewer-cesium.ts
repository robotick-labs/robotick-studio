// viewer-cesium.ts

import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import type { ViewerConfig } from "../viewer-schema";

let CESIUM_TOKEN: string | null = null;
let viewer: Cesium.Viewer | null = null;
let rocketEntity: Cesium.Entity | null = null;
let exitRequested = false;
let cameraOffset: Cesium.Cartesian3 | null = null;

// Load token immediately (once, at module load time)
const secretsPromise: Promise<void> = (async () => {
  try {
    const { CESIUM_TOKEN: LOCAL } = await import(
      "../../../pages/secrets_LOCAL.js"
    );
    CESIUM_TOKEN = LOCAL;
    console.log("✅ Loaded CESIUM_TOKEN from secrets_LOCAL.js");
  } catch {
    const { CESIUM_TOKEN: DEFAULT } = await import("../../../pages/secrets.js");
    CESIUM_TOKEN = DEFAULT;
    console.log("ℹ️ Loaded CESIUM_TOKEN from secrets.js");
  }
})();

async function init(_config: ViewerConfig): Promise<void> {
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
  startRocketTracking();
}

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

function startRocketTracking(): void {
  async function fetchAndUpdate() {
    try {
      await updateRocketFromTelemetry();
    } catch (err) {
      console.warn("Rocket tracking update failed:", err);
    } finally {
      if (!exitRequested) {
        setTimeout(fetchAndUpdate, 33);
      }
    }
  }

  fetchAndUpdate();
}

async function updateRocketFromTelemetry(): Promise<void> {
  const response = await fetch(
    "http://localhost:7090/api/telemetry/workload/outputs?name=jsb_sim"
  );
  if (!response.ok) return;

  const data = await response.json();

  const lat = parseFloat(data["jsb.fcs_position_lat_deg"]);
  const lon = parseFloat(data["jsb.fcs_position_long_deg"]);
  const alt = parseFloat(data["jsb.fcs_position_alt_sl_ft"]) * 0.3048 + 100;

  const roll = Cesium.Math.toRadians(
    parseFloat(data["jsb.fcs_attitude_roll_deg"])
  );
  const pitch = Cesium.Math.toRadians(
    parseFloat(data["jsb.fcs_attitude_pitch_deg"])
  );
  const yaw = Cesium.Math.toRadians(
    parseFloat(data["jsb.fcs_attitude_yaw_deg"])
  );

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

function uninit(): void {
  if (!viewer) return;

  console.log("Visualizer uninitializing");

  exitRequested = true;

  if (!viewer.isDestroyed()) {
    viewer.destroy();
  }

  viewer = null;
  rocketEntity = null;
  cameraOffset = null;

  const container = document.getElementById("viewer-container");
  if (container) container.innerHTML = "";
}

// Match ViewerModule interface
export default { init, uninit };
