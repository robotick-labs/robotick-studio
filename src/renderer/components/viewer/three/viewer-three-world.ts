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
  RestPoller,
  ResponseType,
} from "../viewer-schema.js";

import {
  ITelemetryModel,
  subscribeTelemetry,
} from "../../../data-sources/telemetry/index.js";
import { ProjectData } from "../../../data-sources/launcher/index.js";

const TONE_MAPS: Record<ToneMap, THREE.ToneMapping> = {
  None: THREE.NoToneMapping,
  Linear: THREE.LinearToneMapping,
  ACESFilmic: THREE.ACESFilmicToneMapping,
  Cineon: THREE.CineonToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
};

type NodeIndex = Map<string, THREE.Object3D>;

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
  private pendingResize = false;
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
  private telemetryStats = new Map<
    string,
    {
      lastTimestamp: number | null;
      count: number;
      sum: number;
      sumSq: number;
    }
  >();

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
        Math.PI
      )
    ); // +X → –Z

  private readonly MJ_TO_THREE_INV = this.MJ_TO_THREE.clone().invert();

  constructor(config: ViewerConfig) {
    this.worldConfig = config;
  }

  // ---------- world/local helpers ----------
  private getParentWorldQuat(
    obj: THREE.Object3D,
    out = new THREE.Quaternion()
  ) {
    if (!obj.parent) return out.identity();
    obj.parent.getWorldQuaternion(out);
    return out;
  }

  private worldToLocalPosition(
    obj: THREE.Object3D,
    worldPos: THREE.Vector3,
    out = new THREE.Vector3()
  ) {
    out.copy(worldPos);
    if (obj.parent) obj.parent.worldToLocal(out);
    return out;
  }

  private worldToLocalQuat(
    obj: THREE.Object3D,
    worldQuat: THREE.Quaternion,
    out = new THREE.Quaternion()
  ) {
    const qParent = this.getParentWorldQuat(obj, this.__TMP.qParent);
    out.copy(qParent).invert().multiply(worldQuat);
    return out;
  }

  private convertWorldPosFromSource(v: THREE.Vector3, sourceUp?: "Y" | "Z") {
    if (sourceUp === "Z") {
      v.set(-v.x, v.z, -v.y);
    }
    return v;
  }

  // change-of-basis for rotations: q' = C * q * C^{-1}
  private convertWorldQuatFromSource(
    q: THREE.Quaternion,
    sourceUp?: "Y" | "Z"
  ) {
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
    });

    // camera + controls
    const cam = this.worldConfig.camera;
    const width = Math.max(1, Math.round(this.containerElement.clientWidth));
    const height = Math.max(1, Math.round(this.containerElement.clientHeight));
    this.camera = new THREE.PerspectiveCamera(
      cam.fov,
      width / height,
      cam.near,
      cam.far
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
      this.worldConfig.backgroundColor ?? "#ffffff"
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
      `${THREE_PATH}/examples/jsm/libs/draco/gltf/`
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
      await this.loadModel(m.id, m.url, m.transform);
    }

    // pollers
    await this.installPollers();

    // ground
    if (this.worldConfig.addGroundPlane ?? true) {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.ShadowMaterial({ opacity: 0.45 })
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
    this.telemetrySubscriptions.forEach((dispose) => dispose());
    this.telemetrySubscriptions.clear();
    if (this.animReq) cancelAnimationFrame(this.animReq);
    this.controls?.dispose();
    this.pmrem?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentElement) {
      this.renderer.domElement.parentElement.removeChild(
        this.renderer.domElement
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
          if (v?.isTexture) v.dispose?.();
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
        envTex = await new Promise<THREE.Texture>((resolve, reject) => {
          new EXRLoader().load(
            rec.path!,
            (tex) => resolve(this.pmrem.fromEquirectangular(tex).texture),
            undefined,
            reject
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
        this.worldConfig.backgroundColor ?? "#ffffff"
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
    makeFloor = false
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
              new THREE.MeshStandardMaterial({ color: 0xffffff })
            );
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = 0;
            floor.receiveShadow = true;
            this.scene.add(floor);
          }

          resolve();
        },
        undefined,
        reject
      );
    });
  }

  // ---------- polling ----------
  private async installPollers() {
    this.telemetrySubscriptions.forEach((dispose) => dispose());
    this.telemetrySubscriptions.clear();
    this.telemetryStats.clear();
    if (!this.worldConfig.telemetryAnimators) return;

    for (const config of this.worldConfig.telemetryAnimators) {
      const baseUrl = await this.resolvePollerBaseUrl(config);
      if (!baseUrl) {
        console.warn(
          `[viewer] telemetry poller ${config.id} missing telemetry base URL`
        );
        continue;
      }

      const pollingRate = config.pollingRateHz ?? 20;
      const unsubscribe = subscribeTelemetry(baseUrl, pollingRate, {
        callback: (model) => {
          // this.logTelemetryStats(config.id);
          void this.executePoller(config, model);
        },
        error: (err) =>
          console.warn(`[viewer] telemetry poller ${config.id} failed`, err),
      });
      this.telemetrySubscriptions.set(config.id, unsubscribe);
    }
  }

  private logTelemetryStats(pollerId: string) {
    const now = Date.now();
    let stats = this.telemetryStats.get(pollerId);
    if (!stats) {
      stats = { lastTimestamp: now, count: 0, sum: 0, sumSq: 0 };
      this.telemetryStats.set(pollerId, stats);
      return;
    }

    if (stats.lastTimestamp !== null) {
      const interval = now - stats.lastTimestamp;
      stats.count += 1;
      stats.sum += interval;
      stats.sumSq += interval * interval;

      if (stats.count % 50 === 0) {
        const mean = stats.sum / stats.count;
        const variance = Math.max(0, stats.sumSq / stats.count - mean * mean);
        const stddev = Math.sqrt(variance);
        console.log(
          `[viewer] telemetry ${pollerId}: avg ${mean.toFixed(
            1
          )}ms, jitter ${stddev.toFixed(1)}ms (samples ${stats.count})`
        );
      }
    }

    stats.lastTimestamp = now;
  }

  private async resolvePollerBaseUrl(
    poller: RestPoller
  ): Promise<string | null> {
    if (poller.baseUrl?.trim()) {
      return poller.baseUrl.trim();
    }
    const modelName = poller.modelName?.trim();
    if (!modelName) {
      return null;
    }
    try {
      const descriptor = await ProjectData.waitForModelDescriptorByName(
        modelName
      );
      if (!descriptor) {
        console.warn(
          `[viewer] telemetry model "${modelName}" not found in project data`
        );
        return null;
      }
      return descriptor.telemetryBaseUrl;
    } catch (err) {
      console.warn(
        `[viewer] Failed to resolve telemetry model "${modelName}"`,
        err
      );
      return null;
    }
  }

  private async executePoller(
    poller: RestPoller,
    telemetryModel: ITelemetryModel
  ) {
    const workload = telemetryModel.workloads.find(
      (w) => w.name === poller.workloadName
    );
    if (!workload) {
      return;
    }

    if (poller.fields?.length) {
      this.applyFieldsData(
        poller.workloadName,
        poller.fields,
        telemetryModel,
        poller.defaultSpace,
        poller.sourceUp
      );
    }

    if (poller.textureFields?.length) {
      for (const t of poller.textureFields) {
        const fieldPath = `${poller.workloadName}.${t.fieldId}`;
        const field = telemetryModel.getField?.(fieldPath);
        if (!field) {
          console.warn("Texture field not found:", fieldPath);
          continue;
        }

        if (field.mime_type !== "image/png") {
          console.warn(
            `Texture field mime_type [${field.mime_type}] is not 'image/png': ${fieldPath}`
          );
          continue;
        }

        const fieldValue = field.getValue();
        if (!(fieldValue instanceof Uint8Array)) {
          console.warn("Texture field is not binary:", t.fieldId, fieldValue);
          continue;
        }

        const blob = new Blob([fieldValue], { type: field.mime_type });
        const bitmap = await createImageBitmap(blob);

        const node = this.findNodeAnyModel(t.node);
        if (!node) continue;
        let tex: THREE.Texture | null = null;
        const mats = this.asMaterials(node);
        for (const m of mats) {
          const targetKey = this.materialPropKey(t.prop);
          // @ts-ignore
          const current = m[targetKey] as THREE.Texture | undefined;
          if (!tex) {
            tex = current ?? new THREE.Texture(bitmap);
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
          } else {
            tex.image = bitmap;
            tex.needsUpdate = true;
          }
          // @ts-ignore
          m[targetKey] = tex;
          if (t.transparent) (m as any).transparent = true;
          if (typeof t.alphaTest === "number")
            (m as any).alphaTest = t.alphaTest;
          m.needsUpdate = true;
        }
      }
    }
  }

  // ---------- mapping ----------
  private applyFieldsData(
    workloadName: string,
    maps: Required<RestPoller>["fields"],
    telemetryModel: ITelemetryModel,
    defaultSpace?: "local" | "world",
    defaultSourceUp?: "Y" | "Z"
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
              m.multiply ? wz * m.multiply : wz
            );
            this.convertWorldPosFromSource(
              worldV,
              m.sourceUp ?? defaultSourceUp
            );
            const localV =
              spaceMode === "world"
                ? this.worldToLocalPosition(node, worldV, this.__TMP.v3b)
                : worldV;
            node.position.copy(localV);
          }
          node.updateMatrix();
          node.updateMatrixWorld();
          break;
        }

        case "rotationQuat": {
          const wq = num(fieldValue.w ?? fieldValue[0]);
          const xq = num(fieldValue.x ?? fieldValue[1]);
          const yq = num(fieldValue.y ?? fieldValue[2]);
          const zq = num(fieldValue.z ?? fieldValue[3]);
          if (
            [wq, xq, yq, zq].some(
              (v) => typeof v !== "number" || Number.isNaN(v)
            )
          )
            break;

          this.__TMP.qWorld.set(xq, yq, zq, wq);
          this.convertWorldQuatFromSource(
            this.__TMP.qWorld,
            m.sourceUp ?? defaultSourceUp
          );

          const qLocal =
            spaceMode === "world"
              ? this.worldToLocalQuat(
                  node,
                  this.__TMP.qWorld,
                  this.__TMP.qLocal
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
              "XYZ"
            );
            this.__TMP.qWorld.setFromEuler(eWorld);
            this.convertWorldQuatFromSource(
              this.__TMP.qWorld,
              m.sourceUp ?? defaultSourceUp
            );

            const qLocal =
              spaceMode === "world"
                ? this.worldToLocalQuat(
                    node,
                    this.__TMP.qWorld,
                    this.__TMP.qLocal
                  )
                : this.__TMP.qWorld;

            node.quaternion.copy(qLocal);
          }
          node.updateMatrix();
          node.updateMatrixWorld();
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
              m.multiply ? sz * m.multiply : sz
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
          // handled by texture poller
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
    this.animReq = requestAnimationFrame(this.animate);
    this.controls?.update();
    const d = this.worldConfig.lights?.directional;
    if (this.dir && d?.trackerModelRef)
      this.updateDirectionalLight(d.trackerModelRef);
    this.renderer.render(this.scene, this.camera);
  };

  private scheduleResize() {
    if (this.pendingResize) return;
    this.pendingResize = true;
    requestAnimationFrame(() => {
      this.pendingResize = false;
      this.updateSize();
    });
  }

  private updateSize = () => {
    const width = Math.max(
      1,
      Math.round(this.containerElement.clientWidth),
    );
    const height = Math.max(
      1,
      Math.round(this.containerElement.clientHeight),
    );
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
