// viewer_schema.ts
import * as THREE from "three";

export type ToneMap = "None" | "Linear" | "ACESFilmic" | "Cineon" | "Reinhard";

export interface EnvironmentConfig {
  id: string;
  name: string;
  // EXR URL (or null for none); special keyword "neutral" → RoomEnvironment PMREM
  path: string | null;
  asBackground?: boolean; // if true, scene.background = env
}

export interface FogConfig {
  color: string; // hex like "#bfd1e5"
  near: number;
  far: number;
}

export interface LightAmbient {
  intensity: number;
  color: string; // "#ffffff"
  attachToCamera?: boolean; // default true
}

export interface LightDirectional {
  intensity: number; // often * Math.PI if using PBR-friendly units
  color: string;
  // Shadow config (optional)
  castShadow?: boolean;
  mapSize?: number; // e.g. 4096
  bias?: number; // -0.0005
  normalBias?: number; // 0.01
  camera?: {
    near: number;
    far: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  // A “tracker” offset in the model’s local space; if provided and modelRef is set, light follows tracker
  trackerModelRef?: string; // id of model to track (from models[].id)
  trackerLocalPos?: [number, number, number]; // e.g. [2,4,2]
}

export interface RendererConfig {
  antialias?: boolean;
  pixelRatioMax?: number; // clamp DPR; default 2
  clearColor?: number; // 0xcccccc
}

export interface CameraConfig {
  fov: number;
  near: number;
  far: number;
  // initial position is auto-derived from offset/target if provided,
  // else you can specify explicit position:
  position?: [number, number, number];
  target?: [number, number, number];
  offset?: [number, number, number]; // camera = target + offset
}

export interface ControlsConfig {
  enabled?: boolean;
  screenSpacePanning?: boolean;
}

export interface PollFieldMap {
  // JSON key → node transform/material target
  // e.g. "root_position.x": { node:"PipRoot", prop:"position", axis:"x" }
  fieldId: string;
  node: string; // node name (found by Object3D.getObjectByName)
  prop:
    | "position"
    | "rotationEuler"
    | "rotationXYZ" // synonym for rotationEuler
    | "rotationQuat"
    | "scale"
    | "material.map"
    | "material.emissiveMap"
    | "material.color"
    | "material.emissive"
    | "material.opacity";
  axis?: "all" | "x" | "y" | "z" | "w";
  space?: "local" | "world"; // for vector/euler components
  sourceUp?: "Y" | "Z"; // default "Y"
  // Optional: scale or units conversion applied to numeric value
  multiply?: number;
}

export type ResponseType = "json" | "blob" | "png" | "jpeg";

export interface RestPoller {
  id: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  bodyJson?: Record<string, unknown>; // for POST
  responseType?: ResponseType; // default "json"
  intervalMs: number;
  // Map response to scene changes:
  fields?: PollFieldMap[];
  defaultSpace?: "local" | "world";
  sourceUp?: "Y" | "Z"; // default "Y"
  // For textures (blob/png/jpeg): where to apply
  textureTargets?: {
    node: string;
    prop:
      | "material.map"
      | "material.emissiveMap"
      | "material.alphaMap"
      | "material.normalMap";
    // Texture options
    flipY?: boolean; // default false (GLTF-style)
    sRGB?: boolean; // default true for color maps
    generateMipmaps?: boolean; // default false for frequent updates
    minFilter?: number; // THREE.LinearFilter, etc.
    magFilter?: number; // THREE.LinearFilter, etc.
    anisotropy?: number; // auto-max if not set
    transparent?: boolean; // set mat.transparent = true
    alphaTest?: number; // 0..1
  }[];
}

export interface ModelConfig {
  id: string;
  url: string; // glb/gltf
  // Optional transform at load time (world-space anchor)
  transform?: {
    position?: [number, number, number];
    rotationEuler?: [number, number, number]; // radians
    scale?: [number, number, number];
  };
}

export interface ViewerConfig {
  container?: HTMLElement | null; // DOM parent; defaults to document.body
  backgroundColor?: string; // "#ffffff"
  fog?: FogConfig | null;
  addGroundPlane?: boolean;

  renderer?: RendererConfig;
  camera: CameraConfig;
  controls?: ControlsConfig;

  environment?: {
    current: string; // must match environments[].id or "neutral"
    environments: EnvironmentConfig[];
    exposureStops?: number; // renderer.toneMappingExposure = 2^exposureStops
    toneMapping?: ToneMap; // "Linear", "ACESFilmic", ...
  };

  lights?: {
    ambient?: LightAmbient | null;
    directional?: LightDirectional | null;
  };

  // Asset set
  models: ModelConfig[];

  // REST telemetryAnimators (telemetry, textures, etc.)
  telemetryAnimators?: RestPoller[];
}
