import { readStorageValue, setStorageValue } from "../../../services/storage";
import type { LauncherService } from "./LauncherService";

/**
 * Ensure a URL string ends with a trailing slash.
 *
 * @returns The input `url` with a trailing `/`; returns the original string if it already ends with `/`.
 */
function ensureTrailingSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

export function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | undefined>
): string {
  const url = new URL(path, ensureTrailingSlash(baseUrl));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function buildWebSocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, ensureTrailingSlash(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Request failed ${response.status} ${response.statusText}: ${text}`
    );
  }
  return (await response.json()) as T;
}

async function tryFetchJSON<T>(
  url: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    return await fetchJSON<T>(url, init);
  } catch {
    return null;
  }
}

const KEY_PROJECT_PATH = "robotick-studio.projectPath";
const KEY_LAUNCHER_PROFILE = "robotick-studio.launcherProfile";
const DEFAULT_MODEL_HOST = "localhost";
const DEFAULT_TELEMETRY_PORT = 7090;
const LAUNCHER_LOCAL_API_BASE = "http://localhost:7081";
type ProjectChangedListener = (path: string) => void;
type LauncherProfileChangedListener = (profile: string) => void;

export interface ProjectModelDescriptor<T = unknown> {
  modelPath: string;
  modelShortName: string;
  modelName: string;
  telemetryPort: number;
  telemetryBaseUrl: string;
  data: T;
}

const projectListeners = new Set<ProjectChangedListener>();
const profileListeners = new Set<LauncherProfileChangedListener>();

type ModelCacheEntry = {
  projectPath: string;
  models: ProjectModelDescriptor[];
};

let cachedModels: ModelCacheEntry | null = null;
let modelsPromise: Promise<ProjectModelDescriptor[]> | null = null;

/**
 * Set the current project path and propagate the change.
 *
 * Stores the given project path in persistent storage, invalidates any cached model data for the previous project, and notifies registered project-change listeners of the new path.
 *
 * @param path - The project path to store and broadcast to listeners
 */
function setProjectPath(path: string) {
  setStorageValue(KEY_PROJECT_PATH, path);
  invalidateModelCache();
  notifyProjectChanged(path);
}

/**
 * Retrieve the stored project path.
 *
 * @returns The stored project path, or an empty string if no path is set
 */
function getProjectPath(): string {
  return readStorageValue(KEY_PROJECT_PATH) ?? "";
}

/**
 * Persist the given launcher profile and notify registered listeners of the change.
 *
 * @param value - Launcher profile identifier to store and broadcast to listeners
 */
function setLauncherProfile(value: string) {
  setStorageValue(KEY_LAUNCHER_PROFILE, value);
  notifyLauncherProfileChanged(value);
}

/**
 * Retrieve the stored launcher profile name.
 *
 * @returns The launcher profile string, or an empty string when no profile is set.
 */
function getLauncherProfile(): string {
  return readStorageValue(KEY_LAUNCHER_PROFILE) ?? "";
}

/**
 * Notify all registered listeners that the current project path has changed.
 *
 * @param path - The new project path delivered to each listener.
 *
 * Exceptions thrown by individual listeners are caught and logged; notification proceeds for remaining listeners.
 */
function notifyProjectChanged(path: string) {
  for (const callback of projectListeners) {
    try {
      callback(path);
    } catch (err) {
      console.error("Error in onProjectChanged listener:", err);
    }
  }
}

function notifyLauncherProfileChanged(profile: string) {
  for (const callback of profileListeners) {
    try {
      callback(profile);
    } catch (err) {
      console.error("Error in onLauncherProfileChanged listener:", err);
    }
  }
}

function onProjectChanged(callback: ProjectChangedListener) {
  projectListeners.add(callback);
  return () => projectListeners.delete(callback);
}

function onLauncherProfileChanged(callback: LauncherProfileChangedListener) {
  profileListeners.add(callback);
  return () => profileListeners.delete(callback);
}

export function getModelHostName() {
  return DEFAULT_MODEL_HOST;
}

function normalizePort(portValue: unknown): number {
  const next = Number(portValue);
  if (Number.isFinite(next) && next > 0) {
    return next;
  }
  return DEFAULT_TELEMETRY_PORT;
}

function buildTelemetryBaseUrl(port: number) {
  return `http://${getModelHostName()}:${port}`;
}

function buildModelShortName(modelPath: string): string {
  const filename = modelPath.split("/").pop() ?? modelPath;
  if (filename.endsWith(".model.yaml")) {
    return filename.slice(0, -".model.yaml".length);
  }
  if (filename.endsWith(".yaml")) {
    return filename.slice(0, -".yaml".length);
  }
  return filename;
}

export async function fetchProjectPaths(): Promise<string[]> {
  const url = buildUrl(LAUNCHER_LOCAL_API_BASE, "/query/list-projects");
  const projects = await fetchJSON<string[]>(url);
  return projects.sort();
}

export async function fetchProjectSettingsData<T = Record<string, unknown>>(
  projectPath: string
): Promise<T> {
  const url = buildUrl(LAUNCHER_LOCAL_API_BASE, "/query/get-project-settings", {
    project_path: projectPath,
  });
  return await fetchJSON<T>(url);
}

export async function fetchProjectRemoteControlSettings<
  T = Record<string, unknown>
>(projectPath: string, signal?: AbortSignal): Promise<T> {
  const url = buildUrl(
    LAUNCHER_LOCAL_API_BASE,
    "/query/get-project-rc-settings",
    {
      project_path: projectPath,
    }
  );
  return await fetchJSON<T>(url, { signal });
}

export async function requestLauncherRun(
  projectPath: string,
  launcherProfile: string
): Promise<void> {
  const url = buildUrl(LAUNCHER_LOCAL_API_BASE, "/launcher/run", {
    project_path: projectPath,
    profile: launcherProfile,
  });
  await fetchJSON(url, { method: "POST" });
}

export async function requestLauncherStop(): Promise<void> {
  const url = buildUrl(LAUNCHER_LOCAL_API_BASE, "/launcher/stop");
  await fetchJSON(url, { method: "POST" });
}

export async function fetchLauncherStatus(): Promise<{
  status: string;
} | null> {
  const url = buildUrl(LAUNCHER_LOCAL_API_BASE, "/launcher/status");
  return await tryFetchJSON<{ status: string }>(url);
}

export function getLauncherLogStreamUrl(): string {
  return buildWebSocketUrl(LAUNCHER_LOCAL_API_BASE, "/launcher/ws/log");
}

export async function fetchProjectModelPaths(projectPath: string) {
  const url = buildUrl(LAUNCHER_LOCAL_API_BASE, "/query/list-project-models", {
    project_path: projectPath,
  });
  const models = await fetchJSON<string[]>(url);
  return models.sort();
}

async function fetchProjectModelData(
  projectPath: string,
  modelPath: string
): Promise<unknown> {
  const url = buildUrl(LAUNCHER_LOCAL_API_BASE, "/query/get-model", {
    project_path: projectPath,
    model_path: modelPath,
  });
  return await fetchJSON(url);
}

async function buildModelDescriptors(
  projectPath: string
): Promise<ProjectModelDescriptor[]> {
  const modelPaths = await fetchProjectModelPaths(projectPath);
  const descriptorPromises = modelPaths.map(async (modelPath) => {
    try {
      const data = await fetchProjectModelData(projectPath, modelPath);
      if (!data) return null;

      const modelName =
        (data as { name?: string })?.name?.trim() ||
        modelPath
          .split("/")
          .pop()
          ?.replace(/\.model\.yaml$/, "") ||
        modelPath;

      const telemetryPort = normalizePort(
        (data as { telemetry?: { port?: number } })?.telemetry?.port
      );

      return {
        modelPath,
        modelShortName: buildModelShortName(modelPath),
        modelName,
        telemetryPort,
        telemetryBaseUrl: buildTelemetryBaseUrl(telemetryPort),
        data,
      } as ProjectModelDescriptor;
    } catch (err) {
      console.warn(
        `[launcher-interface] Failed to load model definition ${modelPath}`,
        err
      );
      return null;
    }
  });

  const descriptors = await Promise.all(descriptorPromises);
  return descriptors.filter(
    (descriptor): descriptor is ProjectModelDescriptor => descriptor !== null
  );
}

async function resolveProjectModels(
  projectPath?: string,
  { force } = { force: false }
): Promise<ProjectModelDescriptor[]> {
  const effectivePath = projectPath ?? getProjectPath();
  if (!effectivePath) {
    return [];
  }

  if (!force && cachedModels?.projectPath === effectivePath) {
    return cachedModels.models;
  }

  if (!force && modelsPromise) {
    return await modelsPromise;
  }

  const promise = buildModelDescriptors(effectivePath);
  modelsPromise = promise;

  try {
    const models = await promise;
    cachedModels = { projectPath: effectivePath, models };
    return models;
  } finally {
    if (modelsPromise === promise) {
      modelsPromise = null;
    }
  }
}

function invalidateModelCache(projectPath?: string) {
  if (!cachedModels) return;
  if (!projectPath || cachedModels.projectPath === projectPath) {
    cachedModels = null;
  }
}

export async function getProjectModels(
  projectPath?: string
): Promise<ProjectModelDescriptor[]> {
  return resolveProjectModels(projectPath);
}

export async function refreshProjectModels(
  projectPath?: string
): Promise<ProjectModelDescriptor[]> {
  return resolveProjectModels(projectPath, { force: true });
}

const currentProject: LauncherService = {
  setProjectPath,
  getProjectPath,
  setLauncherProfile,
  getLauncherProfile,
  onProjectChanged,
  onLauncherProfileChanged,
  fetchProjectPaths,
  fetchProjectSettingsData,
  fetchProjectRemoteControlSettings,
  fetchProjectModelPaths,
  getProjectModels,
  refreshProjectModels,
  clearProjectModelCache: invalidateModelCache,
  getModelHostName,
  requestLauncherRun,
  requestLauncherStop,
  fetchLauncherStatus,
  getLauncherLogStreamUrl,
};

export default currentProject;