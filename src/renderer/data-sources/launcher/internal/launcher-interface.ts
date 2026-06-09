import {
  readStorageValue,
  removeStorageValue,
  setStorageValue,
} from "../../../services/storage";
import type { LauncherService } from "./LauncherService";

/**
 * Ensure a URL string ends with a trailing slash.
 *
 * @returns The input `url` with a trailing `/`; returns the original string if it already ends with `/`.
 */
function ensureTrailingSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

function tryBuildRoutedTelemetryUrl(baseUrl: string, path: string): URL | null {
  const telemetryPrefix = "/api/telemetry";
  const gatewayPrefix = "/api/telemetry-gateway";
  if (!path.startsWith(`${telemetryPrefix}/`)) {
    return null;
  }

  const base = new URL(ensureTrailingSlash(baseUrl));
  const basePath = base.pathname.endsWith("/") && base.pathname !== "/"
    ? base.pathname.slice(0, -1)
    : base.pathname;

  if (!basePath.startsWith(`${gatewayPrefix}/`)) {
    return null;
  }

  return new URL(
    `${base.origin}${basePath}${path.slice(telemetryPrefix.length)}`
  );
}

export function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | undefined>
): string {
  const url =
    tryBuildRoutedTelemetryUrl(baseUrl, path) ??
    new URL(path, ensureTrailingSlash(baseUrl));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function buildWebSocketUrl(baseUrl: string, path: string): string {
  const url =
    tryBuildRoutedTelemetryUrl(baseUrl, path) ??
    new URL(path, ensureTrailingSlash(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function encodePathPreservingSlashes(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
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
type ProjectSelectionStateChangedListener = (
  state: ProjectSelectionState
) => void;

export type ProjectLockStatus = {
  projectPath: string;
  state: "available" | "current" | "locked";
  instanceName?: string;
  pid?: number;
  message?: string;
};

export type ProjectSelectionIssue = {
  type: "locked" | "error";
  projectPath: string;
  instanceName?: string;
  pid?: number;
  message: string;
};

export type ProjectSelectionState = {
  currentProjectPath: string;
  bootstrapIssue: ProjectSelectionIssue | null;
};

export type ProjectSelectionResult = {
  accepted: boolean;
  currentProjectPath: string;
  issue: ProjectSelectionIssue | null;
};

export interface ProjectModelDescriptor<T = unknown> {
  modelPath: string;
  modelShortName: string;
  modelName: string;
  telemetryPort: number;
  telemetryBaseUrl: string;
  telemetryPushRateHz: number;
  data: T;
}

export type WorkloadsRegistryField = {
  name: string;
  type: string;
  default?: string;
  element_count?: number;
  primitive_kind?: string;
  enum_values?: string[];
};

export type WorkloadsRegistryStruct = {
  name?: string | null;
  fields?: WorkloadsRegistryField[];
};

export type WorkloadsRegistryEntry = {
  type: string;
  metadata?: {
    name?: string;
    structs?: Record<string, WorkloadsRegistryStruct>;
  };
};

export type WorkloadsRegistryResponse = {
  project: string;
  target: string;
  workloads?: Array<{
    type: string;
    config?: { type: string };
    inputs?: { type: string };
    outputs?: { type: string };
    state?: { type: string };
    schema_error?: string;
  }>;
  types?: Array<{
    name: string;
    type_category: string | number;
    fields?: Array<{
      name: string;
      type: string;
      element_count?: number;
      default_value?: string;
      primitive_kind?: string;
      enum_values?: string[];
    }>;
    primitive_kind?: string;
    mime_type?: string;
    format?: string;
    capacity?: string;
    enum_values?: string[];
  }>;
  writable_inputs?: Array<Record<string, unknown>>;
  validation_errors?: string[];

  // Legacy shape kept optional for compatibility during migration.
  registry?: WorkloadsRegistryEntry[];
  shared_types?: {
    primitives?: Record<
      string,
      {
        type_name?: string;
        category?: string;
        primitive_kind?: string;
        mime_type?: string;
        format?: string;
        capacity?: string;
      }
    >;
    structs?: Record<
      string,
      {
        type_name?: string | null;
        fields?: Array<{
          field_name: string;
          field_type_name: string;
          default_value?: string;
        }>;
      }
    >;
  };
};

const projectListeners = new Set<ProjectChangedListener>();
const profileListeners = new Set<LauncherProfileChangedListener>();
const projectSelectionStateListeners = new Set<ProjectSelectionStateChangedListener>();

type ModelCacheEntry = {
  projectPath: string;
  models: ProjectModelDescriptor[];
};

let cachedModels: ModelCacheEntry | null = null;
let modelsPromise: Promise<ProjectModelDescriptor[]> | null = null;
let knownProjectPaths: string[] = [];
let bridgeProjectSelectionUnsubscribe: (() => void) | null = null;

function getProjectSelectionBridge() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.robotick?.projectSelection ?? null;
}

function applyProjectPath(path: string) {
  if (path) {
    setStorageValue(KEY_PROJECT_PATH, path);
  } else {
    removeStorageValue(KEY_PROJECT_PATH);
  }
  invalidateModelCache();
  notifyProjectChanged(path);
}

function notifyProjectSelectionStateChanged(state: ProjectSelectionState) {
  for (const callback of projectSelectionStateListeners) {
    try {
      callback(state);
    } catch (err) {
      console.error("Error in onProjectSelectionStateChanged listener:", err);
    }
  }
}

function applyProjectSelectionState(state: ProjectSelectionState) {
  const nextProjectPath = state.currentProjectPath?.trim() || "";
  if (getProjectPath() !== nextProjectPath) {
    applyProjectPath(nextProjectPath);
  }
  notifyProjectSelectionStateChanged({
    currentProjectPath: nextProjectPath,
    bootstrapIssue: state.bootstrapIssue ?? null,
  });
}

function ensureProjectSelectionBridgeSubscription() {
  if (bridgeProjectSelectionUnsubscribe || typeof window === "undefined") {
    return;
  }
  const bridge = getProjectSelectionBridge();
  if (!bridge?.onStateChanged) {
    return;
  }
  bridgeProjectSelectionUnsubscribe = bridge.onStateChanged((state) => {
    applyProjectSelectionState({
      currentProjectPath: state.currentProjectPath?.trim() || "",
      bootstrapIssue: state.bootstrapIssue ?? null,
    });
  });
}

function getWorkspaceRoot(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const workspaceRoot = window.robotick?.environment?.workspaceRoot;
  return typeof workspaceRoot === "string" ? workspaceRoot.trim() : "";
}

function getHubEndpoint(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const hubEndpoint = window.robotick?.environment?.hubEndpoint;
  return typeof hubEndpoint === "string" ? hubEndpoint.trim() : "";
}

function getLauncherApiBase(): string {
  return getHubEndpoint() || LAUNCHER_LOCAL_API_BASE;
}

function looksAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function getPathBasename(path: string): string {
  const normalized = normalizePathForMatch(path);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function joinWorkspacePath(root: string, relativePath: string): string {
  if (!root) {
    return relativePath;
  }
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  const normalizedRelative = relativePath.replace(/^[\\/]+/, "");
  if (!normalizedRelative) {
    return normalizedRoot;
  }
  const separator = /\\/.test(normalizedRoot) ? "\\" : "/";
  const joined = `${normalizedRoot}${separator}${normalizedRelative}`;
  return separator === "\\" ? joined.replace(/\//g, "\\") : joined;
}

function cacheProjectPaths(paths: string[]) {
  knownProjectPaths = paths.slice();
}

function resolveProjectPathFromCache(projectPath: string): string {
  const trimmedPath = projectPath.trim();
  if (!trimmedPath) {
    return trimmedPath;
  }
  if (looksAbsolutePath(trimmedPath)) {
    return trimmedPath;
  }

  const normalizedInput = normalizePathForMatch(trimmedPath);
  const exactMatch = knownProjectPaths.find(
    (candidate) => normalizePathForMatch(candidate) === normalizedInput
  );
  if (exactMatch) {
    return exactMatch;
  }

  const basenameMatches = knownProjectPaths.filter(
    (candidate) => getPathBasename(candidate) === normalizedInput
  );
  if (basenameMatches.length === 1) {
    return basenameMatches[0];
  }

  return trimmedPath;
}

async function resolveProjectPath(projectPath: string): Promise<string> {
  const trimmedPath = projectPath.trim();
  if (!trimmedPath) {
    return trimmedPath;
  }

  let resolvedPath = resolveProjectPathFromCache(trimmedPath);
  const stillNeedsLookup =
    !looksAbsolutePath(resolvedPath) &&
    resolvedPath === trimmedPath &&
    knownProjectPaths.length === 0;
  if (stillNeedsLookup) {
    await fetchProjectPaths();
    resolvedPath = resolveProjectPathFromCache(trimmedPath);
  }

  if (looksAbsolutePath(resolvedPath)) {
    return resolvedPath;
  }

  const workspaceRoot = getWorkspaceRoot();
  return workspaceRoot
    ? joinWorkspacePath(workspaceRoot, resolvedPath)
    : resolvedPath;
}

/**
 * Set the current project path and propagate the change.
 *
 * Stores the given project path in persistent storage, invalidates any cached model data for the previous project, and notifies registered project-change listeners of the new path.
 *
 * @param path - The project path to store and broadcast to listeners
 */
function setProjectPath(path: string) {
  applyProjectPath(path);
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
  invalidateModelCache();
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

function isLocalLauncherProfile(profile: string): boolean {
  return profile.trim().toLowerCase().startsWith("local:");
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

async function getProjectSelectionState(): Promise<ProjectSelectionState> {
  ensureProjectSelectionBridgeSubscription();
  const bridge = getProjectSelectionBridge();
  if (!bridge?.getState) {
    return {
      currentProjectPath: getProjectPath(),
      bootstrapIssue: null,
    };
  }
  const state = await bridge.getState();
  const normalizedState = {
    currentProjectPath: state.currentProjectPath?.trim() || "",
    bootstrapIssue: state.bootstrapIssue ?? null,
  };
  applyProjectSelectionState(normalizedState);
  return normalizedState;
}

async function requestProjectSelection(
  path: string
): Promise<ProjectSelectionResult> {
  ensureProjectSelectionBridgeSubscription();
  const bridge = getProjectSelectionBridge();
  if (!bridge?.setProject) {
    setProjectPath(path);
    return {
      accepted: true,
      currentProjectPath: path,
      issue: null,
    };
  }
  const result = await bridge.setProject(path);
  if (result.accepted) {
    applyProjectSelectionState({
      currentProjectPath: result.currentProjectPath?.trim() || "",
      bootstrapIssue: null,
    });
  }
  return {
    accepted: result.accepted,
    currentProjectPath: result.currentProjectPath?.trim() || "",
    issue: result.issue ?? null,
  };
}

function onProjectSelectionStateChanged(
  callback: ProjectSelectionStateChangedListener
) {
  ensureProjectSelectionBridgeSubscription();
  projectSelectionStateListeners.add(callback);
  return () => projectSelectionStateListeners.delete(callback);
}

async function fetchProjectLockStatuses(
  projectPaths: string[]
): Promise<ProjectLockStatus[]> {
  const bridge = getProjectSelectionBridge();
  if (!bridge?.getLockStatuses || projectPaths.length === 0) {
    return projectPaths.map((projectPath) => ({
      projectPath,
      state: "available",
    }));
  }
  const payload = await bridge.getLockStatuses(projectPaths);
  return Array.isArray(payload.statuses) ? payload.statuses : [];
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

function normalizeTelemetryPushRateHz(
  sampleRateHzValue: unknown
): number {
  const next = Number(sampleRateHzValue);
  if (Number.isFinite(next) && next > 0) {
    return next;
  }
  return 20;
}

function buildTelemetryBaseUrl(port: number) {
  return `http://${getModelHostName()}:${port}`;
}

function getPreferredHost(data: unknown): string {
  const preferredHost = (data as { runtime?: { preferred_host?: string } })?.runtime
    ?.preferred_host;
  return preferredHost?.trim() || DEFAULT_MODEL_HOST;
}

function isTelemetryGatewayModel(data: unknown): boolean {
  return Boolean(
    (data as { telemetry?: { is_gateway?: boolean } })?.telemetry?.is_gateway
  );
}

function buildDirectTelemetryBaseUrl(data: unknown, telemetryPort: number) {
  return `http://${getPreferredHost(data)}:${telemetryPort}`;
}

type GatewayRegistryEntry = {
  model_id: string;
  is_local?: boolean;
  is_gateway?: boolean;
  telemetry_path?: string;
};

type GatewayRegistryResponse = {
  gateway_model_id?: string;
  models?: GatewayRegistryEntry[];
};

async function tryFetchGatewayRegistry(
  gatewayBaseUrl: string
): Promise<Map<string, GatewayRegistryEntry> | null> {
  const url = buildUrl(gatewayBaseUrl, "/api/telemetry-gateway/models");
  const response = await tryFetchJSON<GatewayRegistryResponse>(url);
  if (!response?.models?.length) {
    return null;
  }

  const registry = new Map<string, GatewayRegistryEntry>();
  for (const model of response.models) {
    const modelId = model.model_id?.trim();
    if (!modelId) continue;
    registry.set(modelId, model);
  }
  return registry;
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
  const url = buildUrl(getLauncherApiBase(), "/query/list-projects");
  const projects = await fetchJSON<string[]>(url);
  const sortedProjects = projects.sort();
  cacheProjectPaths(sortedProjects);
  return sortedProjects;
}

export async function fetchProjectSettingsData<T = Record<string, unknown>>(
  projectPath: string
): Promise<T> {
  const normalizedProjectPath = await resolveProjectPath(projectPath);
  const url = buildUrl(getLauncherApiBase(), "/query/get-project-settings", {
    project_path: normalizedProjectPath,
  });
  return await fetchJSON<T>(url);
}

export async function fetchProjectRemoteControlSettings<
  T = Record<string, unknown>
>(projectPath: string, signal?: AbortSignal): Promise<T> {
  const normalizedProjectPath = await resolveProjectPath(projectPath);
  const url = buildUrl(
    getLauncherApiBase(),
    "/query/get-project-rc-settings",
    {
      project_path: normalizedProjectPath,
    }
  );
  return await fetchJSON<T>(url, { signal });
}

export function buildProjectAssetUrl(
  projectPath: string,
  assetPath: string
): string {
  const normalizedProjectPath = resolveProjectPathFromCache(projectPath.trim());
  const absoluteProjectPath = looksAbsolutePath(normalizedProjectPath)
    ? normalizedProjectPath
    : joinWorkspacePath(getWorkspaceRoot(), normalizedProjectPath);
  const normalizedAssetPath = assetPath.trim().replace(/^\/+/, "");
  return buildUrl(
    getLauncherApiBase(),
    `/query/project-assets/${encodePathPreservingSlashes(normalizedAssetPath)}`,
    {
      project_path: absoluteProjectPath,
    }
  );
}

export async function requestLauncherRun(
  projectPath: string,
  launcherProfile: string
): Promise<void> {
  const normalizedProjectPath = await resolveProjectPath(projectPath);
  const url = buildUrl(getLauncherApiBase(), "/launcher/run", {
    project_path: normalizedProjectPath,
    profile: launcherProfile,
  });
  await fetchJSON(url, { method: "POST" });
}

export async function requestLauncherRunModel(
  projectPath: string,
  platform: "local" | "native",
  modelId: string
): Promise<void> {
  const normalizedProjectPath = await resolveProjectPath(projectPath);
  const url = buildUrl(getLauncherApiBase(), "/launcher/run-model", {
    project_path: normalizedProjectPath,
    platform,
    model_id: modelId,
  });
  await fetchJSON(url, { method: "POST" });
}

export async function requestLauncherStop(): Promise<void> {
  const url = buildUrl(getLauncherApiBase(), "/launcher/stop");
  await fetchJSON(url, { method: "POST" });
}

export async function requestLauncherStopModel(
  projectPath: string,
  platform: "local" | "native",
  modelId: string
): Promise<void> {
  const normalizedProjectPath = await resolveProjectPath(projectPath);
  const url = buildUrl(getLauncherApiBase(), "/launcher/stop-model", {
    project_path: normalizedProjectPath,
    platform,
    model_id: modelId,
  });
  await fetchJSON(url, { method: "POST" });
}

export async function fetchLauncherStatus(): Promise<{
  status: string;
  phase?: string | null;
  profile?: string | null;
  models?: Record<string, { stage?: string; status?: string }>;
} | null> {
  const url = buildUrl(getLauncherApiBase(), "/launcher/status");
  return await tryFetchJSON<{
    status: string;
    phase?: string | null;
    profile?: string | null;
    models?: Record<string, { stage?: string; status?: string }>;
  }>(url);
}

export function getLauncherLogStreamUrl(): string {
  return buildWebSocketUrl(getLauncherApiBase(), "/launcher/ws/log");
}

export async function fetchProjectModelPaths(projectPath: string) {
  const normalizedProjectPath = await resolveProjectPath(projectPath);
  const url = buildUrl(getLauncherApiBase(), "/query/list-project-models", {
    project_path: normalizedProjectPath,
  });
  const models = await fetchJSON<string[]>(url);
  return models.sort();
}

async function fetchProjectModelData(
  projectPath: string,
  modelPath: string
): Promise<unknown> {
  const normalizedProjectPath = await resolveProjectPath(projectPath);
  const url = buildUrl(getLauncherApiBase(), "/query/get-model", {
    project_path: normalizedProjectPath,
    model_path: modelPath,
  });
  return await fetchJSON(url);
}

export async function fetchProjectWorkloadsRegistry(
  projectPath: string,
  target = "linux"
): Promise<WorkloadsRegistryResponse> {
  const normalizedProjectPath = await resolveProjectPath(projectPath);
  const url = buildUrl(
    getLauncherApiBase(),
    "/query/get-workloads-registry",
    {
      project_path: normalizedProjectPath,
      target,
    }
  );
  return await fetchJSON<WorkloadsRegistryResponse>(url);
}

export async function fetchProjectCoreModelSchema(
  projectPath: string,
  target = "linux"
): Promise<Record<string, unknown>> {
  const normalizedProjectPath = await resolveProjectPath(projectPath);
  const url = buildUrl(getLauncherApiBase(), "/query/get-core-model-schema", {
    project_path: normalizedProjectPath,
    target,
  });
  return await fetchJSON<Record<string, unknown>>(url);
}

async function buildModelDescriptors(
  projectPath: string
): Promise<ProjectModelDescriptor[]> {
  const useLocalModelHosts = isLocalLauncherProfile(getLauncherProfile());
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
      const telemetryPushRateHz =
        normalizeTelemetryPushRateHz(
          (
            data as {
              telemetry?: { telemetry_push_rate_hz?: number };
            }
          )?.telemetry?.telemetry_push_rate_hz
        );

      return {
        modelPath,
        modelShortName: buildModelShortName(modelPath),
        modelName,
        telemetryPort,
        telemetryBaseUrl: useLocalModelHosts
          ? buildTelemetryBaseUrl(telemetryPort)
          : buildDirectTelemetryBaseUrl(data, telemetryPort),
        telemetryPushRateHz,
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
  const filteredDescriptors = descriptors.filter(
    (descriptor): descriptor is ProjectModelDescriptor => descriptor !== null
  );

  const gatewayDescriptor = filteredDescriptors.find((descriptor) =>
    isTelemetryGatewayModel(descriptor.data)
  );

  if (!gatewayDescriptor) {
    return filteredDescriptors;
  }

  const gatewayBaseUrl = gatewayDescriptor.telemetryBaseUrl;
  const gatewayRegistry = await tryFetchGatewayRegistry(gatewayBaseUrl);

  return filteredDescriptors.map((descriptor) => {
    const descriptorData =
      descriptor.data && typeof descriptor.data === "object"
        ? (descriptor.data as Record<string, unknown>)
        : null;
    const modelIdFromData = String(descriptorData?.id ?? "").trim();
    if (!modelIdFromData) {
      throw new Error(
        `Model '${descriptor.modelPath}' is missing required 'id' for telemetry gateway routing`
      );
    }
    const registryEntry =
      gatewayRegistry?.get(modelIdFromData);
    const telemetryPath =
      registryEntry?.telemetry_path?.trim() ||
      `/api/telemetry-gateway/${descriptor.modelShortName}`;

    return {
      ...descriptor,
      telemetryBaseUrl: buildUrl(gatewayBaseUrl, telemetryPath),
    };
  });
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
  requestProjectSelection,
  getProjectSelectionState,
  setLauncherProfile,
  getLauncherProfile,
  onProjectChanged,
  onProjectSelectionStateChanged,
  onLauncherProfileChanged,
  fetchProjectLockStatuses,
  fetchProjectPaths,
  fetchProjectSettingsData,
  fetchProjectRemoteControlSettings,
  fetchProjectModelPaths,
  fetchProjectWorkloadsRegistry,
  fetchProjectCoreModelSchema,
  getProjectModels,
  refreshProjectModels,
  clearProjectModelCache: invalidateModelCache,
  getModelHostName,
  requestLauncherRun,
  requestLauncherRunModel,
  requestLauncherStop,
  requestLauncherStopModel,
  fetchLauncherStatus,
  getLauncherLogStreamUrl,
};

export default currentProject;
