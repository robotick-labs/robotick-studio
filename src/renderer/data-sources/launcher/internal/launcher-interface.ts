import {
  readStorageValue,
  removeStorageValue,
  setStorageValue,
} from "../../../services/storage";
import type { LauncherService } from "./LauncherService";
import type {
  ElectronLauncherDiagnosticsSnapshot,
  LegacyLauncherStatus,
  LauncherRuntimeMetrics,
  LauncherRuntimeProcessMetrics,
  LauncherModelLogsBatch,
  LauncherModelLogEvent,
  LauncherModelLogsSnapshot,
  ProjectModelDescriptor,
  WorkloadsRegistryEntry,
  WorkloadsRegistryField,
  WorkloadsRegistryResponse,
  WorkloadsRegistryStruct,
} from "../../../../electron/common/launcher-bridge-contract";

export type {
  LauncherModelLogEvent,
  LauncherModelLogsBatch,
  LauncherModelLogsSnapshot,
  LauncherRuntimeMetrics,
  LauncherRuntimeProcessMetrics,
  LegacyLauncherStatus,
  ProjectModelDescriptor,
  WorkloadsRegistryEntry,
  WorkloadsRegistryField,
  WorkloadsRegistryResponse,
  WorkloadsRegistryStruct,
};

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
  const basePath =
    base.pathname.endsWith("/") && base.pathname !== "/"
      ? base.pathname.slice(0, -1)
      : base.pathname;

  if (!basePath.startsWith(`${gatewayPrefix}/`)) {
    return null;
  }

  return new URL(`${base.origin}${basePath}${path.slice(telemetryPrefix.length)}`);
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

export function buildWebSocketUrl(
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
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function encodePathPreservingSlashes(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

const KEY_PROJECT_PATH = "robotick-studio.projectPath";
const KEY_LAUNCHER_PROFILE = "robotick-studio.launcherProfile";
const DEFAULT_MODEL_HOST = "localhost";
const LAUNCHER_LOCAL_API_BASE = "http://localhost:7081";

type ProjectChangedListener = (path: string) => void;
type LauncherProfileChangedListener = (profile: string) => void;
type ProjectSelectionStateChangedListener = (state: ProjectSelectionState) => void;

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

export type LauncherRendererDiagnosticsSnapshot = ElectronLauncherDiagnosticsSnapshot & {
  bootstrap_issue: ProjectSelectionIssue | null;
};

const projectListeners = new Set<ProjectChangedListener>();
const profileListeners = new Set<LauncherProfileChangedListener>();
const projectSelectionStateListeners = new Set<ProjectSelectionStateChangedListener>();

let latestProjectSelectionState: ProjectSelectionState = {
  currentProjectPath: "",
  bootstrapIssue: null,
};
let knownProjectPaths: string[] = [];
let bridgeProjectSelectionUnsubscribe: (() => void) | null = null;
let cachedHubEndpoint = "";

function getProjectSelectionBridge() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.robotick?.projectSelection ?? null;
}

function getLauncherBridge() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.robotick?.launcher ?? null;
}

function getWorkspaceRoot(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const workspaceRoot = window.robotick?.environment?.workspaceRoot;
  return typeof workspaceRoot === "string" ? workspaceRoot.trim() : "";
}

function getStaticHubEndpoint(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const hubEndpoint = window.robotick?.environment?.hubEndpoint;
  return typeof hubEndpoint === "string" ? hubEndpoint.trim() : "";
}

async function resolveHubEndpoint(): Promise<string> {
  if (typeof window !== "undefined") {
    try {
      const hubEndpoint = await window.robotick?.hub?.getEndpoint?.();
      if (typeof hubEndpoint === "string" && hubEndpoint.trim()) {
        cachedHubEndpoint = hubEndpoint.trim();
        return cachedHubEndpoint;
      }
    } catch {
      // Fall through to cached/static endpoint resolution.
    }
  }

  const staticEndpoint = getStaticHubEndpoint();
  if (staticEndpoint) {
    cachedHubEndpoint = staticEndpoint;
    return staticEndpoint;
  }
  return cachedHubEndpoint;
}

function getLauncherApiBaseSync(): string {
  return cachedHubEndpoint || getStaticHubEndpoint() || LAUNCHER_LOCAL_API_BASE;
}

function looksAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

function looksLikeProjectFilePath(path: string): boolean {
  return /\.project\.ya?ml$/i.test(path.trim());
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

function absolutizeKnownProjectPath(candidate: string): string {
  return looksAbsolutePath(candidate)
    ? candidate
    : joinWorkspacePath(getWorkspaceRoot(), candidate);
}

function resolveProjectPathFromCache(projectPath: string): string {
  const trimmedPath = projectPath.trim();
  if (!trimmedPath) {
    return trimmedPath;
  }
  if (looksAbsolutePath(trimmedPath) && !looksLikeProjectFilePath(trimmedPath)) {
    const normalizedInput = normalizePathForMatch(trimmedPath).replace(/\/+$/, "");
    const directoryMatches = knownProjectPaths
      .map((candidate) => absolutizeKnownProjectPath(candidate))
      .filter((candidate) => {
        const normalizedCandidate = normalizePathForMatch(candidate);
        const candidateDirectory = normalizedCandidate.slice(
          0,
          normalizedCandidate.lastIndexOf("/")
        );
        return candidateDirectory === normalizedInput;
      });
    if (directoryMatches.length === 1) {
      return directoryMatches[0];
    }
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

function clearProjectModelCache(projectPath?: string) {
  const bridge = getLauncherBridge();
  if (bridge?.clearProjectModelCache) {
    void bridge.clearProjectModelCache(projectPath, getLauncherProfile());
  }
}

function applyProjectPath(path: string) {
  if (path) {
    setStorageValue(KEY_PROJECT_PATH, path);
  } else {
    removeStorageValue(KEY_PROJECT_PATH);
  }
  clearProjectModelCache();
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
  latestProjectSelectionState = {
    currentProjectPath: nextProjectPath,
    bootstrapIssue: state.bootstrapIssue ?? null,
  };
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

function setProjectPath(path: string) {
  applyProjectPath(path);
}

function getProjectPath(): string {
  return readStorageValue(KEY_PROJECT_PATH) ?? "";
}

function setLauncherProfile(value: string) {
  setStorageValue(KEY_LAUNCHER_PROFILE, value);
  clearProjectModelCache();
  notifyLauncherProfileChanged(value);
}

function getLauncherProfile(): string {
  return readStorageValue(KEY_LAUNCHER_PROFILE) ?? "";
}

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
    const fallbackState = {
      currentProjectPath: getProjectPath(),
      bootstrapIssue: null,
    };
    latestProjectSelectionState = fallbackState;
    return fallbackState;
  }
  const state = await bridge.getState();
  const normalizedState = {
    currentProjectPath: state.currentProjectPath?.trim() || "",
    bootstrapIssue: state.bootstrapIssue ?? null,
  };
  applyProjectSelectionState(normalizedState);
  return normalizedState;
}

async function requestProjectSelection(path: string): Promise<ProjectSelectionResult> {
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

function requireLauncherBridge() {
  const bridge = getLauncherBridge();
  if (!bridge) {
    throw new Error("Launcher bridge unavailable");
  }
  return bridge;
}

export async function fetchProjectPaths(): Promise<string[]> {
  const projects = (await requireLauncherBridge().listProjectPaths()) as string[];
  const sortedProjects = [...projects].sort();
  cacheProjectPaths(sortedProjects);
  return sortedProjects;
}

export async function fetchProjectSettingsData<T = Record<string, unknown>>(
  projectPath: string
): Promise<T> {
  return (await requireLauncherBridge().getProjectSettings(projectPath)) as T;
}

export async function fetchProjectRemoteControlSettings<
  T = Record<string, unknown>
>(projectPath: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  const result = (await requireLauncherBridge().getProjectRemoteControlSettings(
    projectPath
  )) as T;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  return result;
}

export function buildProjectAssetUrl(projectPath: string, assetPath: string): string {
  const normalizedProjectPath = resolveProjectPathFromCache(projectPath.trim());
  const absoluteProjectPath = looksAbsolutePath(normalizedProjectPath)
    ? normalizedProjectPath
    : joinWorkspacePath(getWorkspaceRoot(), normalizedProjectPath);
  const normalizedAssetPath = assetPath.trim().replace(/^\/+/, "");
  return buildUrl(
    getLauncherApiBaseSync(),
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
  await requireLauncherBridge().run(projectPath, launcherProfile);
}

export async function requestLauncherRunModel(
  projectPath: string,
  platform: "local" | "native",
  modelId: string
): Promise<void> {
  await requireLauncherBridge().runModel(projectPath, platform, modelId);
}

export async function requestLauncherStop(): Promise<void> {
  await requireLauncherBridge().stop(getProjectPath());
}

export async function requestLauncherStopModel(
  projectPath: string,
  platform: "local" | "native",
  modelId: string
): Promise<void> {
  await requireLauncherBridge().stopModel(projectPath, platform, modelId);
}

export async function requestLauncherRestart(
  projectPath: string,
  launcherProfile: string
): Promise<void> {
  await requireLauncherBridge().restart(projectPath, launcherProfile);
}

export async function requestLauncherRestartModel(
  projectPath: string,
  platform: "local" | "native",
  modelId: string
): Promise<void> {
  await requireLauncherBridge().restartModel(projectPath, platform, modelId);
}

export async function fetchLauncherStatus(): Promise<LegacyLauncherStatus | null> {
  return (await requireLauncherBridge().getStatus(
    getProjectPath(),
    getLauncherProfile()
  )) as LegacyLauncherStatus | null;
}

export function getLauncherLogStreamUrl(): string {
  const projectPath = getProjectPath().trim();
  if (!projectPath) {
    return "";
  }
  const basename = getPathBasename(projectPath);
  const projectId = basename.replace(/\.ya?ml$/i, "").replace(/\.project$/i, "");
  return buildWebSocketUrl(
    getLauncherApiBaseSync(),
    "/v1/launcher/models/logs/stream",
    {
      project_id: projectId,
    }
  );
}

export async function getLauncherLogStreamUrlAsync(): Promise<string> {
  return (await requireLauncherBridge().getLogStreamUrl(getProjectPath())) as string;
}

export async function getLauncherRendererDiagnosticsSnapshot(): Promise<LauncherRendererDiagnosticsSnapshot> {
  const snapshot = (await requireLauncherBridge().getDiagnostics(
    getProjectPath(),
    getLauncherProfile()
  )) as Omit<LauncherRendererDiagnosticsSnapshot, "bootstrap_issue">;
  return {
    ...snapshot,
    bootstrap_issue: latestProjectSelectionState.bootstrapIssue,
  };
}

export async function fetchLauncherLogSnapshot(
  tail = 300
): Promise<LauncherModelLogsBatch | null> {
  return (await requireLauncherBridge().getLogSnapshot(
    getProjectPath(),
    tail
  )) as LauncherModelLogsBatch | null;
}

export async function requestLauncherLogClear(): Promise<void> {
  await requireLauncherBridge().clearLogs(getProjectPath());
}

export async function fetchProjectModelPaths(projectPath: string) {
  return ((await requireLauncherBridge().listProjectModelPaths(projectPath)) as string[]).sort();
}

export async function fetchProjectWorkloadsRegistry(
  projectPath: string,
  target = "linux"
): Promise<WorkloadsRegistryResponse> {
  return (await requireLauncherBridge().getWorkloadsRegistry(
    projectPath,
    target
  )) as WorkloadsRegistryResponse;
}

export async function fetchProjectCoreModelSchema(
  projectPath: string,
  target = "linux"
): Promise<Record<string, unknown>> {
  return (await requireLauncherBridge().getCoreModelSchema(
    projectPath,
    target
  )) as Record<string, unknown>;
}

export async function getProjectModels(
  projectPath?: string
): Promise<ProjectModelDescriptor[]> {
  return (await requireLauncherBridge().getProjectModels(
    projectPath ?? getProjectPath(),
    getLauncherProfile(),
    { force: false }
  )) as ProjectModelDescriptor[];
}

export async function refreshProjectModels(
  projectPath?: string
): Promise<ProjectModelDescriptor[]> {
  return (await requireLauncherBridge().getProjectModels(
    projectPath ?? getProjectPath(),
    getLauncherProfile(),
    { force: true }
  )) as ProjectModelDescriptor[];
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
  clearProjectModelCache,
  getModelHostName,
  requestLauncherRun,
  requestLauncherRunModel,
  requestLauncherStop,
  requestLauncherStopModel,
  requestLauncherRestart,
  requestLauncherRestartModel,
  fetchLauncherStatus,
  getLauncherLogStreamUrl,
  getLauncherLogStreamUrlAsync,
  fetchLauncherLogSnapshot,
  requestLauncherLogClear,
};

export default currentProject;
