// viewer_world.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import {
  ViewerConfig,
  EnvironmentConfig,
  ToneMap,
  TelemetryAnimator,
} from "../viewer-schema.js";

import {
  ITelemetryModel,
  subscribeTelemetry,
} from "../../../data-sources/telemetry/index.js";
import { ProjectData } from "../../../data-sources/launcher/index.js";
import { resolveViewerAssetUrl } from "../asset-url-resolver.js";

const TONE_MAPS: Record<ToneMap, THREE.ToneMapping> = {
  None: THREE.NoToneMapping,
  Linear: THREE.LinearToneMapping,
  ACESFilmic: THREE.ACESFilmicToneMapping,
  Cineon: THREE.CineonToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
};
const RESIZE_TIMER_SEC = 0.01;
const ENABLE_PERFORMANCE_STATS = false;
const ENABLE_CAMERA_OVERLAY = false;

type StatsRecord = {
  lastTimestamp: number | null;
  count: number;
  sum: number;
  sumSq: number;
};

type NodeIndex = Map<string, THREE.Object3D>;

type ClosableImage = {
  close?: () => void;
};

function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function closeImageResource(image: unknown) {
  if (!image || typeof image !== "object") {
    return;
  }
  try {
    (image as ClosableImage).close?.();
  } catch (error) {
    console.warn("[viewer] Failed to close image resource", error);
  }
}

type FixedVectorBinaryValue = {
  data_buffer?: unknown;
  count?: unknown;
};

function extractBinaryBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value.byteLength > 0 ? value : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeFixedVector = value as FixedVectorBinaryValue;
  if (!(maybeFixedVector.data_buffer instanceof Uint8Array)) {
    return null;
  }

  const raw = maybeFixedVector.data_buffer;
  const count =
    typeof maybeFixedVector.count === "number" &&
    Number.isFinite(maybeFixedVector.count)
      ? Math.max(
          0,
          Math.min(raw.byteLength, Math.trunc(maybeFixedVector.count)),
        )
      : raw.byteLength;
  return count > 0 ? raw.subarray(0, count) : null;
}

function extractBinaryFieldBytes(
  telemetryModel: ITelemetryModel,
  fieldPath: string,
  fieldValue: unknown,
): Uint8Array | null {
  const countedBytes = extractBinaryBytes(fieldValue);
  if (countedBytes && !(fieldValue instanceof Uint8Array)) {
    return countedBytes;
  }

  if (fieldValue instanceof Uint8Array) {
    const lastDot = fieldPath.lastIndexOf(".");
    if (lastDot > 0) {
      const parentFieldPath = fieldPath.slice(0, lastDot);
      const parentValue = telemetryModel.getField?.(parentFieldPath)?.getValue();
      const parentBytes = extractBinaryBytes(parentValue);
      if (parentBytes) {
        return parentBytes;
      }
    }
  }

  return countedBytes;
}

export class ViewerWorld {
  // temp scratch
  private __TMP = {
    v3: new THREE.Vector3(),
    v3b: new THREE.Vector3(),
    qWorld: new THREE.Quaternion(),
    qParent: new THREE.Quaternion(),
    qLocal: new THREE.Quaternion(),
  };

  private worldConfig: ViewerConfig;

  // three bits
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private pmrem!: THREE.PMREMGenerator;
  private neutralEnvTex!: THREE.Texture;
  private containerElement!: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: number | null = null;
  private lastSize = { width: 0, height: 0 };

  // lighting
  private ambient?: THREE.AmbientLight;
  private dir?: THREE.DirectionalLight;
  private lightTracker?: THREE.Object3D;

  // loaders
  private gltfLoader!: GLTFLoader;

  // content
  private models = new Map<string, THREE.Object3D>();
  private nodeIndex = new Map<string, NodeIndex>(); // per model id

  // telemetry
  private telemetrySubscriptions = new Map<string, () => void>();
  private telemetryStats = new Map<string, StatsRecord>();
  private textureFrameSignatures = new Map<string, string>();
  private frameStats: StatsRecord = {
    lastTimestamp: null,
    count: 0,
    sum: 0,
    sumSq: 0,
  };
  private statsOverlay: HTMLDivElement | null = null;
  private cameraOverlay: HTMLDivElement | null = null;
  private _cameraOverlayScratch = new THREE.Vector3();

  // render loop
  private animReq: number | null = null;

  // ===== MuJoCo (Z-up, +X fwd, +Y right) -> Three.js (Y-up, +X right, -Z fwd) =====
  // Step1: Rx(-90°) to make Z-up -> Y-up
  // Step2: Ry(180°) so +X (MJ fwd) -> -Z (Three "forward")
  private readonly MJ_TO_THREE = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2) // Z-up → Y-up
    .multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI,
      ),
    ); // +X → –Z

  private readonly MJ_TO_THREE_INV = this.MJ_TO_THREE.clone().invert();
  private readonly REP103_TO_THREE =
    new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().set(
        // Columns are source basis vectors expressed in Three.js coordinates.
        // REP-103: +X fwd -> (0,0,-1), +Y left -> (-1,0,0), +Z up -> (0,1,0)
        0,
        -1,
        0,
        0,
        0,
        0,
        1,
        0,
        -1,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
      ),
    );
  private readonly REP103_TO_THREE_INV = this.REP103_TO_THREE.clone().invert();

  constructor(config: ViewerConfig) {
    this.worldConfig = config;
  }

  // ---------- world/local helpers ----------
  private getParentWorldQuat(
    obj: THREE.Object3D,
    out = new THREE.Quaternion(),
  ) {
    if (!obj.parent) return out.identity();
    obj.parent.getWorldQuaternion(out);
    return out;
  }

  private worldToLocalPosition(
    obj: THREE.Object3D,
    worldPos: THREE.Vector3,
    out = new THREE.Vector3(),
  ) {
    out.copy(worldPos);
    if (obj.parent) obj.parent.worldToLocal(out);
    return out;
  }

  private worldToLocalQuat(
    obj: THREE.Object3D,
    worldQuat: THREE.Quaternion,
    out = new THREE.Quaternion(),
  ) {
    const qParent = this.getParentWorldQuat(obj, this.__TMP.qParent);
    out.copy(qParent).invert().multiply(worldQuat);
    return out;
  }

  private convertWorldPosFromSource(
    v: THREE.Vector3,
    sourceFrame?: "REP103" | "MUJOCO_ZUP_X_FORWARD_Y_RIGHT",
    sourceUp?: "Y" | "Z",
  ) {
    if (sourceFrame === "REP103") {
      // REP-103 (+X fwd, +Y left, +Z up) -> Three.js (+X right, +Y up, -Z fwd)
      v.set(-v.y, v.z, -v.x);
      return v;
    }
    if (sourceFrame === "MUJOCO_ZUP_X_FORWARD_Y_RIGHT") {
      // MuJoCo convention used in existing Robotick scenes.
      v.set(-v.x, v.z, -v.y);
      return v;
    }
    if (sourceUp === "Z") {
      v.set(-v.x, v.z, -v.y);
    }
    return v;
  }

  // change-of-basis for rotations: q' = C * q * C^{-1}
  private convertWorldQuatFromSource(
    q: THREE.Quaternion,
    sourceFrame?: "REP103" | "MUJOCO_ZUP_X_FORWARD_Y_RIGHT",
    sourceUp?: "Y" | "Z",
  ) {
    if (sourceFrame === "REP103") {
      q.premultiply(this.REP103_TO_THREE);
      q.multiply(this.REP103_TO_THREE_INV);
      return q;
    }
    if (sourceFrame === "MUJOCO_ZUP_X_FORWARD_Y_RIGHT") {
      q.premultiply(this.MJ_TO_THREE);
      q.multiply(this.MJ_TO_THREE_INV);
      q.set(-q.x, q.y, -q.z, q.w);
      return q;
    }
    if (sourceUp !== "Z") return q;
    q.premultiply(this.MJ_TO_THREE);
    q.multiply(this.MJ_TO_THREE_INV);
    q.set(-q.x, q.y, -q.z, q.w);
    return q;
  }

  // ---------- lifecycle ----------
  async start() {
    this.containerElement = this.worldConfig.container ?? document.body;

    // renderer
    const rCfg = this.worldConfig.renderer ?? {};
    this.renderer = new THREE.WebGLRenderer({ antialias: !!rCfg.antialias });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    const pxMax = rCfg.pixelRatioMax ?? 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pxMax));
    if (typeof rCfg.clearColor === "number")
      this.renderer.setClearColor(rCfg.clearColor);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.containerElement.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, {
      width: "100%",
      height: "100%",
      display: "block",
      objectFit: "cover",
    });
    this.containerElement.style.overflow = "hidden";
    if (ENABLE_PERFORMANCE_STATS) {
      this.ensureStatsOverlay();
    }
    if (ENABLE_CAMERA_OVERLAY) {
      this.ensureCameraOverlay();
    }

    // camera + controls
    const cam = this.worldConfig.camera;
    const width = Math.max(1, Math.round(this.containerElement.clientWidth));
    const height = Math.max(1, Math.round(this.containerElement.clientHeight));
    this.camera = new THREE.PerspectiveCamera(
      cam.fov,
      width / height,
      cam.near,
      cam.far,
    );
    if (cam.target && cam.offset) {
      const target = new THREE.Vector3(...cam.target);
      const offset = new THREE.Vector3(...cam.offset);
      this.camera.position.copy(target.clone().add(offset));
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.copy(target);
    } else {
      const p = cam.position ?? [0, 1, 2];
      const target = cam.target ?? [0, 0, 0];
      this.camera.position.set(p[0], p[1], p[2]);
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.set(target[0], target[1], target[2]);
    }
    const cCfg = this.worldConfig.controls ?? {
      enabled: true,
      screenSpacePanning: true,
    };
    this.controls.enabled = cCfg.enabled ?? true;
    this.controls.screenSpacePanning = cCfg.screenSpacePanning ?? true;
    this.controls.update();

    // pmrem / env
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    this.neutralEnvTex = this.pmrem.fromScene(new RoomEnvironment()).texture;

    // bg + fog
    this.scene.background = new THREE.Color(
      this.worldConfig.backgroundColor ?? "#ffffff",
    );
    if (this.worldConfig.fog) {
      const f = this.worldConfig.fog;
      this.scene.fog = new THREE.Fog(new THREE.Color(f.color), f.near, f.far);
    }

    await this.applyEnvironment();
    this.installLights();

    // loader stack
    const THREE_PATH = `https://unpkg.com/three@0.${THREE.REVISION}.x`;
    const draco = new DRACOLoader().setDecoderPath(
      `${THREE_PATH}/examples/jsm/libs/draco/gltf/`,
    );
    const ktx2 = new KTX2Loader()
      .setTranscoderPath(`${THREE_PATH}/examples/jsm/libs/basis/`)
      .detectSupport(this.renderer);
    this.gltfLoader = new GLTFLoader()
      .setDRACOLoader(draco)
      .setKTX2Loader(ktx2)
      .setMeshoptDecoder(MeshoptDecoder);

    // models
    for (const m of this.worldConfig.models) {
      const modelUrl = resolveViewerAssetUrl(
        m.url,
        this.worldConfig.projectPath,
      );
      await this.loadModel(m.id, modelUrl, m.transform);
    }

    // animators
    await this.installTelemetryAnimators();

    // ground
    if (this.worldConfig.addGroundPlane ?? true) {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.ShadowMaterial({ opacity: 0.45 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0;
      ground.receiveShadow = true;
      this.scene.add(ground);
    }

    // loop
    this.updateSize();
    this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
    this.resizeObserver.observe(this.containerElement);
    this.animate();
  }

  dispose() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.cleanupStatsOverlay();
    this.cleanupCameraOverlay();
    this.telemetrySubscriptions.forEach((dispose) => dispose());
    this.telemetrySubscriptions.clear();
    this.textureFrameSignatures.clear();
    if (this.animReq) cancelAnimationFrame(this.animReq);
    this.controls?.dispose();
    this.pmrem?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentElement) {
      this.renderer.domElement.parentElement.removeChild(
        this.renderer.domElement,
      );
    }
    this.scene.traverse((n: any) => {
      n.geometry?.dispose?.();
      const mats = Array.isArray(n.material)
        ? n.material
        : n.material
          ? [n.material]
          : [];
      for (const m of mats) {
        Object.values(m).forEach((v: any) => {
          if (v?.isTexture) {
            closeImageResource(v.image);
            v.dispose?.();
          }
        });
      }
    });
  }

  updateConfig(next: Partial<ViewerConfig>) {
    this.worldConfig = { ...this.worldConfig, ...next };
    this.applyEnvironment();
    this.refreshLights();
  }

  // ---------- env / lights ----------
  private envById(id: string | undefined): EnvironmentConfig | null {
    const envCfg = this.worldConfig.environment;
    if (!envCfg) return null;
    return envCfg.environments.find((e) => e.id === id) ?? null;
  }

  private async applyEnvironment() {
    const envCfg = this.worldConfig.environment;
    if (!envCfg) return;

    this.renderer.toneMapping = TONE_MAPS[envCfg.toneMapping ?? "Linear"];
    const stops = envCfg.exposureStops ?? 0.0;
    this.renderer.toneMappingExposure = Math.pow(2, stops);

    const currentId = envCfg.current ?? "neutral";
    let envTex: THREE.Texture | null = null;

    if (currentId === "neutral") {
      envTex = this.neutralEnvTex;
    } else {
      const rec = this.envById(currentId);
      if (rec?.path) {
        const envPath = resolveViewerAssetUrl(
          rec.path,
          this.worldConfig.projectPath,
        );
        envTex = await new Promise<THREE.Texture>((resolve, reject) => {
          new EXRLoader().load(
            envPath,
            (tex) => resolve(this.pmrem.fromEquirectangular(tex).texture),
            undefined,
            reject,
          );
        });
      }
    }

    this.scene.environment = envTex;
    const rec = this.envById(currentId);
    const asBg = rec?.asBackground ?? false;
    if (asBg && envTex) this.scene.background = envTex;
    else
      this.scene.background = new THREE.Color(
        this.worldConfig.backgroundColor ?? "#ffffff",
      );
  }

  private installLights() {
    const L = this.worldConfig.lights ?? {};

    if (L.ambient) {
      const amb = new THREE.AmbientLight(L.ambient.color, L.ambient.intensity);
      this.ambient = amb;
      if (L.ambient.attachToCamera ?? true) {
        this.camera.add(amb);
        this.scene.add(this.camera);
      } else {
        this.scene.add(amb);
      }
    }

    if (L.directional) {
      const d = L.directional;
      const dir = new THREE.DirectionalLight(d.color, d.intensity);
      this.dir = dir;
      if (d.castShadow) {
        dir.castShadow = true;
        if (d.mapSize) dir.shadow.mapSize.set(d.mapSize, d.mapSize);
        if (typeof d.bias === "number") dir.shadow.bias = d.bias;
        if (typeof d.normalBias === "number")
          dir.shadow.normalBias = d.normalBias;
        const sc = dir.shadow.camera as THREE.OrthographicCamera;
        sc.left = -1;
        sc.right = 1;
        sc.top = 1;
        sc.bottom = -1;
        sc.near = 0.1;
        sc.far = 40;
        sc.updateProjectionMatrix();
      }
      this.scene.add(dir);
      this.scene.add(dir.target);

      if (d.trackerModelRef && d.trackerLocalPos) {
        this.lightTracker = new THREE.Object3D();
        this.lightTracker.position.set(...d.trackerLocalPos);
        this.scene.add(this.lightTracker);
      }
    }
  }

  private refreshLights() {
    const L = this.worldConfig.lights ?? {};
    if (this.ambient && L.ambient) {
      this.ambient.intensity = L.ambient.intensity;
      this.ambient.color.set(L.ambient.color);
    }
    if (this.dir && L.directional) {
      this.dir.intensity = L.directional.intensity;
      this.dir.color.set(L.directional.color);
    }
  }

  private updateDirectionalLight(modelId: string) {
    if (!this.dir || !this.lightTracker) return;
    const model = this.models.get(modelId);
    if (!model) return;

    model.add(this.lightTracker);
    this.lightTracker.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    this.lightTracker.getWorldPosition(worldPos);
    model.remove(this.lightTracker);
    this.scene.add(this.lightTracker);

    const desired = worldPos.clone().add(new THREE.Vector3(-1, 2, 1));
    this.dir.position.lerp(desired, 0.15);
    this.dir.target.position.copy(model.position);
    this.dir.target.updateMatrixWorld(true);
  }

  // ---------- loading ----------
  private async loadModel(
    id: string,
    url: string,
    transform?: {
      position?: [number, number, number];
      rotationEuler?: [number, number, number];
      scale?: [number, number, number];
    },
    makeFloor = false,
  ) {
    return new Promise<void>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const obj = gltf.scene || gltf.scenes?.[0] || gltf.scene;
          obj.updateMatrixWorld();

          obj.traverse((node: any) => {
            if (node.castShadow !== undefined) node.castShadow = true;
            if (node.receiveShadow !== undefined) node.receiveShadow = true;
          });

          if (transform?.position) obj.position.set(...transform.position);
          if (transform?.rotationEuler)
            obj.rotation.set(...transform.rotationEuler);
          if (transform?.scale) obj.scale.set(...transform.scale);

          this.scene.add(obj);
          this.models.set(id, obj);

          // build node index
          const index: NodeIndex = new Map();
          obj.traverse((node) => {
            if (node.name) {
              index.set(node.name, node);
            }
          });
          this.nodeIndex.set(id, index);

          const showAxes = false;
          if (showAxes) {
            const showAxesFor = new Set([
              "Body",
              "LeftWheel_Hub",
              "RightWheel_Hub",
            ]);

            for (const [name, node] of index.entries()) {
              if (node.getObjectByName(`${name}_axes`)) continue;
              if (!showAxesFor.has(name)) continue;

              const axes = new THREE.AxesHelper(0.05);
              axes.name = `${name}_axes`;
              axes.visible = true;

              node.updateMatrixWorld(true);
              axes.position.set(0, 0, 0);
              node.add(axes);
            }
          }

          if (makeFloor) {
            const floor = new THREE.Mesh(
              new THREE.PlaneGeometry(100, 100),
              new THREE.MeshStandardMaterial({ color: 0xffffff }),
            );
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = 0;
            floor.receiveShadow = true;
            this.scene.add(floor);
          }

          resolve();
        },
        undefined,
        reject,
      );
    });
  }

  // ---------- sampling ----------
  private async installTelemetryAnimators() {
    this.telemetrySubscriptions.forEach((dispose) => dispose());
    this.telemetrySubscriptions.clear();
    this.telemetryStats.clear();
    if (!this.worldConfig.telemetryAnimators) return;

    for (const config of this.worldConfig.telemetryAnimators) {
      this.telemetryStats.set(config.id, {
        lastTimestamp: null,
        count: 0,
        sum: 0,
        sumSq: 0,
      });
      const baseUrl = await this.resolveAnimatorBaseUrl(config);
      if (!baseUrl) {
        console.warn(
          `[viewer] telemetry animator ${config.id} missing telemetry base URL`,
        );
        continue;
      }

      const samplingRate = config.samplingRateHz ?? 20;
      const unsubscribe = subscribeTelemetry(baseUrl, samplingRate, {
        callback: (model) => {
          // this.logTelemetryStats(config.id);
          void this.executeAnimator(config, model);
        },
        error: (err) =>
          console.warn(`[viewer] telemetry animator ${config.id} failed`, err),
      });
      this.telemetrySubscriptions.set(config.id, unsubscribe);
    }
  }

  private recordTelemetrySample(animatorId: string) {
    const stats = this.telemetryStats.get(animatorId);
    if (!stats) return;
    const now = Date.now();
    if (stats.lastTimestamp !== null) {
      const interval = now - stats.lastTimestamp;
      stats.count += 1;
      stats.sum += interval;
      stats.sumSq += interval * interval;
      this.clampStats(stats);
    }
    stats.lastTimestamp = now;
  }

  private recordFrameInterval(interval: number) {
    const stats = this.frameStats;
    stats.count += 1;
    stats.sum += interval;
    stats.sumSq += interval * interval;
    this.clampStats(stats);
  }

  private clampStats(stats: StatsRecord) {
    if (stats.count > 200) {
      stats.count = Math.floor(stats.count / 2);
      stats.sum *= 0.5;
      stats.sumSq *= 0.5;
    }
  }

  private computeRateJitter(stats: StatsRecord) {
    if (stats.count === 0) {
      return { rateHz: null, jitterMs: null };
    }
    const mean = stats.sum / stats.count;
    const variance = Math.max(0, stats.sumSq / stats.count - mean * mean);
    const rate = mean > 0 ? 1000 / mean : null;
    const jitter = Math.sqrt(variance);
    return { rateHz: rate, jitterMs: Number.isFinite(jitter) ? jitter : null };
  }

  private ensureStatsOverlay() {
    if (!ENABLE_PERFORMANCE_STATS || this.statsOverlay) return;
    if (typeof window !== "undefined") {
      const computed = window.getComputedStyle(this.containerElement).position;
      if (!computed || computed === "static") {
        this.containerElement.style.position = "relative";
      }
    }
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "absolute",
      top: "8px",
      left: "8px",
      padding: "4px 8px",
      background: "rgba(0, 0, 0, 0.65)",
      color: "#f4f4f4",
      fontSize: "0.75rem",
      lineHeight: "1.2",
      borderRadius: "4px",
      pointerEvents: "none",
      zIndex: "999",
      whiteSpace: "pre",
      fontFamily: "Menlo, Consolas, monospace",
    });
    this.statsOverlay = overlay;
    this.containerElement.appendChild(overlay);
    this.updateStatsOverlay();
  }

  private getTelemetryStatsForOverlay() {
    for (const [id, stats] of this.telemetryStats) {
      if (/face/i.test(id)) {
        continue;
      }
      const { rateHz, jitterMs } = this.computeRateJitter(stats);
      if (rateHz !== null || jitterMs !== null) {
        return { label: id, rateHz, jitterMs };
      }
    }
    return null;
  }

  private updateStatsOverlay() {
    if (!ENABLE_PERFORMANCE_STATS || !this.statsOverlay) return;
    const draw = this.computeRateJitter(this.frameStats);
    const telemetry = this.getTelemetryStatsForOverlay();
    const drawLine =
      draw.rateHz !== null
        ? `Draw: ${draw.rateHz.toFixed(1)} Hz (jitter ${
            draw.jitterMs?.toFixed(1) ?? "0"
          } ms)`
        : "Draw: –";
    const telemetryLine = telemetry
      ? `${telemetry.label}: ${
          telemetry.rateHz?.toFixed(1) ?? "–"
        } Hz (jitter ${telemetry.jitterMs?.toFixed(1) ?? "0"} ms)`
      : "Telemetry: –";
    this.statsOverlay.textContent = `${drawLine}\n${telemetryLine}`;
  }

  private cleanupStatsOverlay() {
    if (this.statsOverlay && this.statsOverlay.parentElement) {
      this.statsOverlay.parentElement.removeChild(this.statsOverlay);
    }
    this.statsOverlay = null;
  }

  private ensureCameraOverlay() {
    if (!ENABLE_CAMERA_OVERLAY) return;
    if (this.cameraOverlay) return;
    if (typeof window !== "undefined") {
      const computed = window.getComputedStyle(this.containerElement).position;
      if (!computed || computed === "static") {
        this.containerElement.style.position = "relative";
      }
    }
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "absolute",
      top: "8px",
      right: "8px",
      padding: "4px 8px",
      background: "rgba(0, 0, 0, 0.65)",
      color: "#f4f4f4",
      fontSize: "0.75rem",
      lineHeight: "1.2",
      borderRadius: "4px",
      pointerEvents: "none",
      zIndex: "999",
      whiteSpace: "pre",
      fontFamily: "Menlo, Consolas, monospace",
      textAlign: "left",
    });
    this.cameraOverlay = overlay;
    this.containerElement.appendChild(overlay);
    this.updateCameraOverlay();
  }

  private updateCameraOverlay() {
    if (
      !ENABLE_CAMERA_OVERLAY ||
      !this.cameraOverlay ||
      !this.camera ||
      !this.controls
    )
      return;
    const position = this.camera.position;
    const target = this.controls.target;
    const offset = this._cameraOverlayScratch.subVectors(position, target);
    const formatVec = (v: THREE.Vector3) =>
      `[${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}]`;
    this.cameraOverlay.textContent =
      `camera.target:   ${formatVec(target)}\n` +
      `camera.offset:   ${formatVec(offset)}\n` +
      `camera.position: ${formatVec(position)}`;
  }

  private cleanupCameraOverlay() {
    if (this.cameraOverlay && this.cameraOverlay.parentElement) {
      this.cameraOverlay.parentElement.removeChild(this.cameraOverlay);
    }
    this.cameraOverlay = null;
  }

  private async resolveAnimatorBaseUrl(
    animator: TelemetryAnimator,
  ): Promise<string | null> {
    if (animator.baseUrl?.trim()) {
      return animator.baseUrl.trim();
    }
    const modelName = animator.modelName?.trim();
    if (!modelName) {
      return null;
    }
    try {
      const descriptor =
        await ProjectData.waitForModelDescriptorByName(modelName);
      if (!descriptor) {
        console.warn(
          `[viewer] telemetry model "${modelName}" not found in project data`,
        );
        return null;
      }
      return descriptor.telemetryBaseUrl;
    } catch (err) {
      console.warn(
        `[viewer] Failed to resolve telemetry model "${modelName}"`,
        err,
      );
      return null;
    }
  }

  private async executeAnimator(
    animator: TelemetryAnimator,
    telemetryModel: ITelemetryModel,
  ) {
    this.recordTelemetrySample(animator.id);
    const workload = telemetryModel.workloads.find(
      (w) => w.name === animator.workloadName,
    );
    if (!workload) {
      return;
    }

    if (animator.fields?.length) {
      this.applyFieldsData(
        animator.workloadName,
        animator.fields,
        telemetryModel,
        animator.defaultSpace,
        animator.sourceFrame,
        animator.sourceUp,
      );
    }

    if (animator.textureFields?.length) {
      for (const t of animator.textureFields) {
        try {
          const fieldPath = `${animator.workloadName}.${t.fieldId}`;
          const field = telemetryModel.getField?.(fieldPath);
          if (!field) {
            console.warn("Texture field not found:", fieldPath);
            continue;
          }

          if (field.mime_type !== "image/png") {
            console.warn(
              `Texture field mime_type [${field.mime_type}] is not 'image/png': ${fieldPath}`,
            );
            continue;
          }

          const fieldValue = field.getValue();
          const fieldBytes = extractBinaryFieldBytes(
            telemetryModel,
            fieldPath,
            fieldValue,
          );
          if (!fieldBytes) {
            console.warn(
              "Texture field is not binary or is empty:",
              t.fieldId,
              fieldValue,
            );
            continue;
          }

          const textureKey = `${animator.id}:${fieldPath}:${t.node}:${t.prop}`;
          const frameSignature = `${fieldBytes.byteLength}:${hashBytes(fieldBytes)}`;
          if (this.textureFrameSignatures.get(textureKey) === frameSignature) {
            continue;
          }

          const buffer = fieldBytes.buffer.slice(
            fieldBytes.byteOffset,
            fieldBytes.byteOffset + fieldBytes.byteLength,
          ) as ArrayBuffer;
          const blob = new Blob([buffer], { type: field.mime_type });
          const bitmap = await createImageBitmap(blob);

          const node = this.findNodeAnyModel(t.node);
          if (!node) {
            closeImageResource(bitmap);
            continue;
          }

          let tex: THREE.Texture | null = null;
          const staleTextures = new Set<THREE.Texture>();
          const mats = this.asMaterials(node);
          for (const m of mats) {
            const targetKey = this.materialPropKey(t.prop);
            // @ts-ignore
            const current = m[targetKey] as THREE.Texture | undefined;
            if (!tex) {
              tex = current ?? new THREE.Texture(bitmap);
              if (current) {
                closeImageResource(current.image);
              }
              tex.image = bitmap;
              tex.needsUpdate = true;
              tex.flipY = t.flipY ?? false;
              if (t.sRGB ?? true) tex.colorSpace = THREE.SRGBColorSpace;
              tex.generateMipmaps = t.generateMipmaps ?? false;
              tex.minFilter = (t.minFilter ??
                THREE.LinearFilter) as THREE.MinificationTextureFilter;
              tex.magFilter = (t.magFilter ??
                THREE.LinearFilter) as THREE.MagnificationTextureFilter;
              tex.wrapS = THREE.ClampToEdgeWrapping;
              tex.wrapT = THREE.ClampToEdgeWrapping;
              tex.anisotropy =
                t.anisotropy ?? this.renderer.capabilities.getMaxAnisotropy();
            } else if (current && current !== tex) {
              staleTextures.add(current);
            }
            // @ts-ignore
            m[targetKey] = tex;
            if (t.transparent) (m as any).transparent = true;
            if (typeof t.alphaTest === "number")
              (m as any).alphaTest = t.alphaTest;
            m.needsUpdate = true;
          }

          for (const staleTexture of staleTextures) {
            closeImageResource(staleTexture.image);
            staleTexture.dispose();
          }

          this.textureFrameSignatures.set(textureKey, frameSignature);
        } catch (error) {
          console.error(
            `[viewer] Failed to update texture field ${animator.workloadName}.${t.fieldId}`,
            error,
          );
        }
      }
    }
  }

  // ---------- mapping ----------
  private applyFieldsData(
    workloadName: string,
    maps: Required<TelemetryAnimator>["fields"],
    telemetryModel: ITelemetryModel,
    defaultSpace?: "local" | "world",
    defaultSourceFrame?: "REP103" | "MUJOCO_ZUP_X_FORWARD_Y_RIGHT",
    defaultSourceUp?: "Y" | "Z",
  ) {
    for (const m of maps) {
      const fieldPath = `${workloadName}.${m.fieldId}`;
      const field = telemetryModel.getField?.(fieldPath);
      if (!field) continue;

      const fieldValue = field.getValue();
      if (fieldValue === undefined || fieldValue === null) continue;

      const node = this.findNodeAnyModel(m.node);
      if (!node) {
        console.warn(`[viewer] Node not found for telemetry: "${m.node}"`);
        continue;
      }

      const spaceMode = (m.space ?? defaultSpace ?? "local") as
        | "local"
        | "world";
      const num = (x: any) =>
        typeof x === "number" ? x : typeof x === "string" ? parseFloat(x) : x;

      switch (m.prop) {
        case "position": {
          if (m.axis && m.axis !== "all") {
            const v = num(fieldValue);
            if (typeof v !== "number") break;
            const vec = node.position.clone();
            if (m.axis === "x") vec.x = m.multiply ? v * m.multiply : v;
            if (m.axis === "y") vec.y = m.multiply ? v * m.multiply : v;
            if (m.axis === "z") vec.z = m.multiply ? v * m.multiply : v;
            node.position.copy(vec);
            node.updateMatrix();
            node.updateMatrixWorld();
          } else {
            const wx = num(fieldValue.x),
              wy = num(fieldValue.y),
              wz = num(fieldValue.z);
            if (
              [wx, wy, wz].some((v) => typeof v !== "number" || Number.isNaN(v))
            )
              break;
            const worldV = this.__TMP.v3.set(
              m.multiply ? wx * m.multiply : wx,
              m.multiply ? wy * m.multiply : wy,
              m.multiply ? wz * m.multiply : wz,
            );
            this.convertWorldPosFromSource(
              worldV,
              m.sourceFrame ?? defaultSourceFrame,
              m.sourceUp ?? defaultSourceUp,
            );
            const localV =
              spaceMode === "world"
                ? this.worldToLocalPosition(node, worldV, this.__TMP.v3b)
                : worldV;
            node.position.copy(localV);
            node.updateMatrix();
            node.updateMatrixWorld();
          }
          break;
        }

        case "rotationQuat": {
          const wq = num(fieldValue.w ?? fieldValue[0]);
          const xq = num(fieldValue.x ?? fieldValue[1]);
          const yq = num(fieldValue.y ?? fieldValue[2]);
          const zq = num(fieldValue.z ?? fieldValue[3]);
          if (
            [wq, xq, yq, zq].some(
              (v) => typeof v !== "number" || Number.isNaN(v),
            )
          )
            break;

          this.__TMP.qWorld.set(xq, yq, zq, wq);
          this.convertWorldQuatFromSource(
            this.__TMP.qWorld,
            m.sourceFrame ?? defaultSourceFrame,
            m.sourceUp ?? defaultSourceUp,
          );

          const qLocal =
            spaceMode === "world"
              ? this.worldToLocalQuat(
                  node,
                  this.__TMP.qWorld,
                  this.__TMP.qLocal,
                )
              : this.__TMP.qWorld;
          node.quaternion.copy(qLocal);
          node.updateMatrix();
          node.updateMatrixWorld();
          break;
        }

        case "rotationEuler":
        case "rotationXYZ": {
          const ex = num(fieldValue.x),
            ey = num(fieldValue.y),
            ez = num(fieldValue.z);
          if (
            [ex, ey, ez].some((v) => typeof v !== "number" || Number.isNaN(v))
          ) {
            if (!m.axis || m.axis === "all") break;
            const v = num(fieldValue);
            if (typeof v !== "number") break;
            const e = node.rotation.clone();
            if (m.axis === "x") e.x = m.multiply ? v * m.multiply : v;
            if (m.axis === "y") e.y = m.multiply ? v * m.multiply : v;
            if (m.axis === "z") e.z = m.multiply ? v * m.multiply : v;
            node.rotation.copy(e);
          } else {
            const eWorld = new THREE.Euler(
              m.multiply ? ex * m.multiply : ex,
              m.multiply ? ey * m.multiply : ey,
              m.multiply ? ez * m.multiply : ez,
              "XYZ",
            );
            this.__TMP.qWorld.setFromEuler(eWorld);
            this.convertWorldQuatFromSource(
              this.__TMP.qWorld,
              m.sourceFrame ?? defaultSourceFrame,
              m.sourceUp ?? defaultSourceUp,
            );

            const qLocal =
              spaceMode === "world"
                ? this.worldToLocalQuat(
                    node,
                    this.__TMP.qWorld,
                    this.__TMP.qLocal,
                  )
                : this.__TMP.qWorld;
            node.quaternion.copy(qLocal);
            node.updateMatrix();
            node.updateMatrixWorld();
          }
          break;
        }

        case "scale": {
          if (m.axis && m.axis !== "all") {
            const v = num(fieldValue);
            if (typeof v !== "number") break;
            const s = node.scale.clone();
            if (m.axis === "x") s.x = m.multiply ? v * m.multiply : v;
            if (m.axis === "y") s.y = m.multiply ? v * m.multiply : v;
            if (m.axis === "z") s.z = m.multiply ? v * m.multiply : v;
            node.scale.copy(s);
          } else if (fieldValue && typeof fieldValue === "object") {
            const sx = num(fieldValue.x),
              sy = num(fieldValue.y),
              sz = num(fieldValue.z);
            if (
              [sx, sy, sz].some((v) => typeof v !== "number" || Number.isNaN(v))
            )
              break;
            node.scale.set(
              m.multiply ? sx * m.multiply : sx,
              m.multiply ? sy * m.multiply : sy,
              m.multiply ? sz * m.multiply : sz,
            );
          }
          node.updateMatrix();
          node.updateMatrixWorld();
          break;
        }

        case "material.color":
        case "material.emissive": {
          const mats = this.asMaterials(node);
          for (const mat of mats) {
            const key = this.materialPropKey(m.prop) as "color" | "emissive";
            if (typeof fieldValue === "string")
              (mat as any)[key].set(fieldValue);
            mat.needsUpdate = true;
          }
          break;
        }

        case "material.map":
        case "material.emissiveMap": {
          // handled by texture animator
          break;
        }

        case "material.opacity": {
          const mats = this.asMaterials(node);
          const v = num(fieldValue);
          for (const mat of mats) {
            (mat as any).opacity =
              typeof v === "number" ? v : m.multiply ? v * m.multiply : v;
            (mat as any).transparent = true;
            mat.needsUpdate = true;
          }
          break;
        }

        default:
          break;
      }
    }
  }

  private materialPropKey(prop: string): keyof THREE.Material {
    return prop.replace(/^material\./, "") as keyof THREE.Material;
  }

  private asMaterials(node: THREE.Object3D): THREE.Material[] {
    const mats: THREE.Material[] = [];
    // @ts-ignore
    const mat = (node as any).material;
    if (mat) mats.push(...(Array.isArray(mat) ? mat : [mat]));
    return mats;
  }

  private findNodeAnyModel(nodeName: string): THREE.Object3D | null {
    for (const [, index] of this.nodeIndex) {
      const found = index.get(nodeName);
      if (found) return found;
    }
    return null;
  }

  // ---------- render ----------
  private animate = () => {
    const now = performance.now();
    if (this.frameStats.lastTimestamp !== null) {
      this.recordFrameInterval(now - this.frameStats.lastTimestamp);
    }
    this.frameStats.lastTimestamp = now;
    this.animReq = requestAnimationFrame(this.animate);
    this.controls?.update();
    const d = this.worldConfig.lights?.directional;
    if (this.dir && d?.trackerModelRef)
      this.updateDirectionalLight(d.trackerModelRef);
    this.renderer.render(this.scene, this.camera);
    this.updateStatsOverlay();
    if (ENABLE_CAMERA_OVERLAY) {
      this.updateCameraOverlay();
    }
  };

  private scheduleResize() {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      this.updateSize();
    }, RESIZE_TIMER_SEC * 1000);
  }

  private updateSize = () => {
    const width = Math.max(1, Math.round(this.containerElement.clientWidth));
    const height = Math.max(1, Math.round(this.containerElement.clientHeight));
    if (width === this.lastSize.width && height === this.lastSize.height) {
      return;
    }
    this.lastSize.width = width;
    this.lastSize.height = height;
    this.renderer.setSize(width, height, false);
    if (this.renderer.domElement) {
      this.renderer.domElement.style.width = "100%";
      this.renderer.domElement.style.height = "100%";
    }
    this.camera.aspect = width / height || 1;
    this.camera.updateProjectionMatrix();
  };
}
