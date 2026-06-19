import type {
  ElectronLauncherDiagnosticsSnapshot,
  LauncherModelLogsBatch,
  LauncherRuntimeModelRecord,
  LauncherRuntimeStatusResponse,
  LauncherStatusResponse,
  LegacyLauncherModelStatus,
  LegacyLauncherStatus,
  ProjectModelDescriptor,
  WorkloadsRegistryResponse,
} from "../../../common/launcher-bridge-contract";

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

type ModelCacheEntry = {
  cacheKey: string;
  models: ProjectModelDescriptor[];
};

type ModelPromiseEntry = {
  cacheKey: string;
  promise: Promise<ProjectModelDescriptor[]>;
};

type LauncherStatusCacheEntry = {
  cacheKey: string;
  projectPath: string;
  launcherProfile: string;
  loadedAtMs: number;
  value: LegacyLauncherStatus | null;
};

type LauncherDataSourceOptions = {
  getWorkspaceRoot: () => string;
  getStaticHubEndpoint: () => string;
  getHubEndpoint: () => string | Promise<string | undefined> | undefined;
};

const DEFAULT_MODEL_HOST = "localhost";
const DEFAULT_TELEMETRY_PORT = 7090;
const LAUNCHER_LOCAL_API_BASE = "http://localhost:7081";
const LAUNCHER_STATUS_CACHE_TTL_MS = 500;

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

function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | undefined>
): string {
  const url =
    tryBuildRoutedTelemetryUrl(baseUrl, path) ??
    new URL(path, ensureTrailingSlash(baseUrl));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildWebSocketUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | undefined>
): string {
  const url =
    tryBuildRoutedTelemetryUrl(baseUrl, path) ??
    new URL(path, ensureTrailingSlash(baseUrl));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed ${response.status} ${response.statusText}: ${text}`);
  }
  return (await response.json()) as T;
}

async function tryFetchJSON<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    return await fetchJSON<T>(url, init);
  } catch {
    return null;
  }
}

function normalizePort(portValue: unknown): number {
  const next = Number(portValue);
  if (Number.isFinite(next) && next > 0) {
    return next;
  }
  return DEFAULT_TELEMETRY_PORT;
}

function normalizeTelemetryPushRateHz(sampleRateHzValue: unknown): number {
  const next = Number(sampleRateHzValue);
  if (Number.isFinite(next) && next > 0) {
    return next;
  }
  return 20;
}

function buildTelemetryBaseUrl(port: number) {
  return `http://${DEFAULT_MODEL_HOST}:${port}`;
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

function isLocalLauncherProfile(profile: string): boolean {
  return profile.trim().toLowerCase().startsWith("local:");
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

function stripYamlExtension(value: string): string {
  return value.replace(/\.ya?ml$/i, "");
}

function deriveProjectName(projectPath: string): string {
  const trimmedPath = projectPath.trim();
  if (!trimmedPath) {
    return "";
  }
  const basename = getPathBasename(trimmedPath);
  return stripYamlExtension(basename).replace(/\.project$/i, "");
}

function mapRuntimeModelToLegacyModelStatus(
  model: LauncherRuntimeModelRecord
): LegacyLauncherModelStatus | null {
  const modelId = model.model_id?.trim();
  if (!modelId) {
    return null;
  }
  const baseStatus = {
    lifecycle: model.lifecycle,
    readiness: model.readiness,
    freshness: model.freshness,
    logRefs: model.log_path ? [{ kind: "worker", path: model.log_path }] : [],
  } satisfies Omit<LegacyLauncherModelStatus, "stage" | "status">;

  switch (model.lifecycle) {
    case "starting":
      return { ...baseStatus, stage: "run", status: "starting" };
    case "running":
      return { ...baseStatus, stage: "run", status: "running" };
    case "stopping":
      return { ...baseStatus, stage: "stop", status: "stopping" };
    case "stopped":
      return { ...baseStatus, stage: "stop", status: "succeeded" };
    default:
      if (model.freshness === "failed") {
        return { ...baseStatus, stage: "run", status: "running" };
      }
      return null;
  }
}

function buildRuntimeModelStatusMap(
  models: LauncherRuntimeModelRecord[]
): Record<string, LegacyLauncherModelStatus> {
  const byModel: Record<string, LegacyLauncherModelStatus> = {};
  for (const model of models) {
    const modelId = model.model_id?.trim();
    if (!modelId) {
      continue;
    }
    const status = mapRuntimeModelToLegacyModelStatus(model);
    if (status) {
      byModel[modelId] = status;
    }
  }
  return byModel;
}

function reduceRuntimeLauncherStatus(
  models: LauncherRuntimeModelRecord[]
): "stopped" | "launching" | "running" | "stopping" {
  if (models.some((model) => model.lifecycle === "stopping")) {
    return "stopping";
  }
  if (models.some((model) => model.lifecycle === "starting")) {
    return "launching";
  }
  if (
    models.some(
      (model) => model.lifecycle === "running" || model.freshness === "live"
    )
  ) {
    return "running";
  }
  return "stopped";
}

function reduceRuntimeLauncherPhase(models: LauncherRuntimeModelRecord[]): string | null {
  if (models.some((model) => model.lifecycle === "stopping")) {
    return "stop";
  }
  if (models.some((model) => ["starting", "running"].includes(model.lifecycle ?? ""))) {
    return "run";
  }
  return null;
}

export function createElectronLauncherDataSource(options: LauncherDataSourceOptions) {
  let cachedHubEndpoint = "";
  let knownProjectPaths: string[] = [];
  let cachedModels: ModelCacheEntry | null = null;
  let modelsPromise: ModelPromiseEntry | null = null;
  let cachedLauncherStatus: LauncherStatusCacheEntry | null = null;
  let statusCacheHitCount = 0;
  let statusCacheMissCount = 0;
  let lastLauncherRuntimeFetchAt: string | null = null;
  let lastLauncherRuntimeFetchError: string | null = null;
  const timings: NonNullable<ElectronLauncherDiagnosticsSnapshot["timings"]> = {};

  function roundMs(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  async function measure<T>(
    key: NonNullable<ElectronLauncherDiagnosticsSnapshot["timings"]> extends infer M
      ? keyof M
      : never,
    action: () => Promise<T>
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      return await action();
    } finally {
      timings[key] = roundMs(performance.now() - startedAt);
    }
  }

  function getWorkspaceRoot(): string {
    return options.getWorkspaceRoot().trim();
  }

  function getStaticHubEndpoint(): string {
    return options.getStaticHubEndpoint().trim();
  }

  function launcherStatusCacheKey(projectPath: string, launcherProfile: string): string {
    return `${projectPath}::${launcherProfile}`;
  }

  function clearLauncherStatusCache() {
    cachedLauncherStatus = null;
  }

  async function resolveHubEndpoint(): Promise<string> {
    try {
      const hubEndpoint = await options.getHubEndpoint();
      if (typeof hubEndpoint === "string" && hubEndpoint.trim()) {
        cachedHubEndpoint = hubEndpoint.trim();
        return cachedHubEndpoint;
      }
    } catch {
      // Fall through to cached/static endpoint resolution.
    }

    const staticEndpoint = getStaticHubEndpoint();
    if (staticEndpoint) {
      cachedHubEndpoint = staticEndpoint;
      return staticEndpoint;
    }
    return cachedHubEndpoint;
  }

  async function getLauncherApiBase(): Promise<string> {
    return (await resolveHubEndpoint()) || LAUNCHER_LOCAL_API_BASE;
  }

  function getLauncherApiBaseSync(): string {
    return cachedHubEndpoint || getStaticHubEndpoint() || LAUNCHER_LOCAL_API_BASE;
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

  async function fetchProjectPaths(): Promise<string[]> {
    return await measure("list_project_paths_ms", async () => {
      const url = buildUrl(await getLauncherApiBase(), "/query/list-projects");
      const projects = await fetchJSON<string[]>(url);
      const sortedProjects = projects.sort();
      cacheProjectPaths(sortedProjects);
      return sortedProjects;
    });
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

  async function resolveProjectSettingsPath(projectPath: string): Promise<string> {
    const trimmedPath = projectPath.trim();
    if (!trimmedPath) {
      return trimmedPath;
    }

    let resolvedPath = resolveProjectPathFromCache(trimmedPath);
    const needsAbsoluteDirectoryLookup =
      looksAbsolutePath(trimmedPath) &&
      !looksLikeProjectFilePath(trimmedPath) &&
      resolvedPath === trimmedPath &&
      knownProjectPaths.length === 0;
    if (needsAbsoluteDirectoryLookup) {
      await fetchProjectPaths();
      resolvedPath = resolveProjectPathFromCache(trimmedPath);
    }
    return await resolveProjectPath(resolvedPath);
  }

  async function fetchProjectSettingsData<T = Record<string, unknown>>(
    projectPath: string
  ): Promise<T> {
    return await measure("project_settings_ms", async () => {
      const normalizedProjectPath = await resolveProjectSettingsPath(projectPath);
      const url = buildUrl(await getLauncherApiBase(), "/query/get-project-settings", {
        project_path: normalizedProjectPath,
      });
      return await fetchJSON<T>(url);
    });
  }

  async function fetchProjectRemoteControlSettings<T = Record<string, unknown>>(
    projectPath: string
  ): Promise<T> {
    return await measure("project_remote_control_settings_ms", async () => {
      const normalizedProjectPath = await resolveProjectPath(projectPath);
      const url = buildUrl(await getLauncherApiBase(), "/query/get-project-rc-settings", {
        project_path: normalizedProjectPath,
      });
      return await fetchJSON<T>(url);
    });
  }

  async function createLauncherGroupRequest(payload: Record<string, unknown>): Promise<void> {
    const url = buildUrl(await getLauncherApiBase(), "/v1/launcher/models/launch");
    await fetchJSON(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  async function createLauncherControlRequest(
    action: "stop" | "restart",
    payload: Record<string, unknown>
  ): Promise<void> {
    const url = buildUrl(await getLauncherApiBase(), `/v1/launcher/models/${action}`);
    await fetchJSON(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  async function requestLauncherRun(
    projectPath: string,
    launcherProfile: string
  ): Promise<void> {
    clearLauncherStatusCache();
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const projectName = deriveProjectName(normalizedProjectPath);
    await createLauncherGroupRequest({
      project_name: projectName,
      profile: launcherProfile,
      creator: {
        client: "studio",
      },
    });
  }

  async function requestLauncherRunModel(
    projectPath: string,
    platform: "local" | "native",
    modelId: string
  ): Promise<void> {
    clearLauncherStatusCache();
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const projectName = deriveProjectName(normalizedProjectPath);
    await createLauncherGroupRequest({
      project_name: projectName,
      intent: {
        project: projectName,
        scope: {
          kind: "model",
          value: modelId,
        },
        target_policy: platform,
        created_by: {
          client: "studio",
        },
      },
      creator: {
        client: "studio",
      },
    });
  }

  async function requestLauncherStop(projectPath: string): Promise<void> {
    clearLauncherStatusCache();
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const projectName = deriveProjectName(normalizedProjectPath);
    if (!projectName) {
      return;
    }
    await createLauncherControlRequest("stop", {
      project_name: projectName,
    });
  }

  async function requestLauncherStopModel(
    projectPath: string,
    platform: "local" | "native",
    modelId: string
  ): Promise<void> {
    clearLauncherStatusCache();
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const projectName = deriveProjectName(normalizedProjectPath);
    if (!projectName) {
      return;
    }
    void platform;
    await createLauncherControlRequest("stop", {
      project_name: projectName,
      model_ids: [modelId],
    });
  }

  async function requestLauncherRestart(
    projectPath: string,
    launcherProfile: string
  ): Promise<void> {
    clearLauncherStatusCache();
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const projectName = deriveProjectName(normalizedProjectPath);
    if (!projectName) {
      return;
    }
    await createLauncherControlRequest("restart", {
      project_name: projectName,
      profile: launcherProfile,
      creator: {
        client: "studio",
      },
    });
  }

  async function requestLauncherRestartModel(
    projectPath: string,
    platform: "local" | "native",
    modelId: string
  ): Promise<void> {
    clearLauncherStatusCache();
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const projectName = deriveProjectName(normalizedProjectPath);
    if (!projectName) {
      return;
    }
    await createLauncherControlRequest("restart", {
      project_name: projectName,
      model_ids: [modelId],
      intent: {
        project: projectName,
        scope: {
          kind: "model",
          value: modelId,
        },
        target_policy: platform,
      },
      creator: {
        client: "studio",
      },
    });
  }

  async function fetchLauncherSnapshot(projectPath: string): Promise<LauncherStatusResponse | null> {
    const projectName = deriveProjectName(projectPath);
    if (!projectName) {
      return null;
    }
    lastLauncherRuntimeFetchAt = new Date().toISOString();
    const url = buildUrl(await getLauncherApiBase(), "/v1/launcher/runtime", {
      project_id: projectName,
    });
    try {
      const runtime = await fetchJSON<LauncherRuntimeStatusResponse>(url);
      lastLauncherRuntimeFetchError = null;
      return { resource_type: "robotick_launcher_status", runtime };
    } catch (error) {
      lastLauncherRuntimeFetchError =
        error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  async function fetchLauncherStatus(
    projectPath: string,
    launcherProfile: string
  ): Promise<LegacyLauncherStatus | null> {
    return await measure("launcher_status_ms", async () => {
      const normalizedProjectPath = await resolveProjectPath(projectPath);
      const cacheKey = launcherStatusCacheKey(normalizedProjectPath, launcherProfile);
      const nowMs = performance.now();
      if (
        cachedLauncherStatus?.cacheKey === cacheKey &&
        nowMs - cachedLauncherStatus.loadedAtMs < LAUNCHER_STATUS_CACHE_TTL_MS
      ) {
        statusCacheHitCount += 1;
        return cachedLauncherStatus.value;
      }
      statusCacheMissCount += 1;
      const projectName = deriveProjectName(normalizedProjectPath);
      if (!projectName) {
        const stoppedStatus = {
          status: "stopped",
          phase: null,
          profile: launcherProfile.trim() || null,
          models: {},
        };
        cachedLauncherStatus = {
          cacheKey,
          projectPath: normalizedProjectPath,
          launcherProfile,
          loadedAtMs: nowMs,
          value: stoppedStatus,
        };
        return stoppedStatus;
      }

      const snapshot = await fetchLauncherSnapshot(normalizedProjectPath);
      if (!snapshot) {
        cachedLauncherStatus = {
          cacheKey,
          projectPath: normalizedProjectPath,
          launcherProfile,
          loadedAtMs: nowMs,
          value: null,
        };
        return null;
      }

      const runtimeModels = (snapshot.runtime?.models ?? []).filter(
        (model) => model.project_id?.trim() === projectName
      );
      const status = {
        status: reduceRuntimeLauncherStatus(runtimeModels),
        phase: reduceRuntimeLauncherPhase(runtimeModels),
        profile: launcherProfile.trim() || null,
        models: buildRuntimeModelStatusMap(runtimeModels),
      };
      cachedLauncherStatus = {
        cacheKey,
        projectPath: normalizedProjectPath,
        launcherProfile,
        loadedAtMs: nowMs,
        value: status,
      };
      return status;
    });
  }

  async function fetchProjectModelPaths(projectPath: string) {
    return await measure("project_model_paths_ms", async () => {
      const normalizedProjectPath = await resolveProjectPath(projectPath);
      const url = buildUrl(await getLauncherApiBase(), "/query/list-project-models", {
        project_path: normalizedProjectPath,
      });
      const models = await fetchJSON<string[]>(url);
      return models.sort();
    });
  }

  async function fetchProjectWorkloadsRegistry(
    projectPath: string,
    target = "linux"
  ): Promise<WorkloadsRegistryResponse> {
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const url = buildUrl(await getLauncherApiBase(), "/query/get-workloads-registry", {
      project_path: normalizedProjectPath,
      target,
    });
    return await fetchJSON<WorkloadsRegistryResponse>(url);
  }

  async function fetchProjectCoreModelSchema(
    projectPath: string,
    target = "linux"
  ): Promise<Record<string, unknown>> {
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const url = buildUrl(await getLauncherApiBase(), "/query/get-core-model-schema", {
      project_path: normalizedProjectPath,
      target,
    });
    return await fetchJSON<Record<string, unknown>>(url);
  }

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
      if (!modelId) {
        continue;
      }
      registry.set(modelId, model);
    }
    return registry;
  }

  async function buildModelDescriptors(
    projectPath: string,
    launcherProfile: string
  ): Promise<ProjectModelDescriptor[]> {
    const useLocalModelHosts = isLocalLauncherProfile(launcherProfile);
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const launcherApiBase = await getLauncherApiBase();
    const modelPaths = await fetchJSON<string[]>(
      buildUrl(launcherApiBase, "/query/list-project-models", {
        project_path: normalizedProjectPath,
      })
    );
    modelPaths.sort();

    const descriptorPromises = modelPaths.map(async (modelPath) => {
      try {
        const data = await fetchJSON(
          buildUrl(launcherApiBase, "/query/get-model", {
            project_path: normalizedProjectPath,
            model_path: modelPath,
          })
        );
        if (!data) {
          return null;
        }

        const modelName =
          (data as { name?: string })?.name?.trim() ||
          modelPath.split("/").pop()?.replace(/\.model\.yaml$/, "") ||
          modelPath;

        const telemetryPort = normalizePort(
          (data as { telemetry?: { port?: number } })?.telemetry?.port
        );
        const telemetryPushRateHz = normalizeTelemetryPushRateHz(
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
      } catch (error) {
        console.warn(
          `[electron-launcher-data-source] Failed to load model definition ${modelPath}`,
          error
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
      const registryEntry = gatewayRegistry?.get(modelIdFromData);
      const telemetryPath =
        registryEntry?.telemetry_path?.trim() ||
        `/api/telemetry-gateway/${descriptor.modelShortName}`;

      return {
        ...descriptor,
        telemetryBaseUrl: buildUrl(gatewayBaseUrl, telemetryPath),
      };
    });
  }

  function modelCacheKey(projectPath: string, launcherProfile: string): string {
    return `${projectPath}::${launcherProfile}`;
  }

  async function resolveProjectModels(
    projectPath: string,
    launcherProfile: string,
    force = false
  ): Promise<ProjectModelDescriptor[]> {
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    if (!normalizedProjectPath) {
      return [];
    }

    const cacheKey = modelCacheKey(normalizedProjectPath, launcherProfile);
    if (!force && cachedModels?.cacheKey === cacheKey) {
      return cachedModels.models;
    }
    if (modelsPromise?.cacheKey === cacheKey) {
      return await modelsPromise.promise;
    }

    const promise = measure("project_models_ms", async () =>
      await buildModelDescriptors(normalizedProjectPath, launcherProfile)
    );
    modelsPromise = { cacheKey, promise };

    try {
      const models = await promise;
      cachedModels = { cacheKey, models };
      return models;
    } finally {
      if (modelsPromise?.promise === promise) {
        modelsPromise = null;
      }
    }
  }

  function clearProjectModelCache(projectPath?: string, launcherProfile?: string) {
    if (!cachedModels) {
      return;
    }
    if (!projectPath) {
      cachedModels = null;
      return;
    }
    const nextKey = modelCacheKey(projectPath, launcherProfile ?? "");
    if (cachedModels.cacheKey === nextKey) {
      cachedModels = null;
    }
  }

  async function getProjectModels(projectPath: string, launcherProfile: string) {
    return await resolveProjectModels(projectPath, launcherProfile, false);
  }

  async function refreshProjectModels(projectPath: string, launcherProfile: string) {
    return await resolveProjectModels(projectPath, launcherProfile, true);
  }

  async function getLauncherLogStreamUrl(projectPath: string): Promise<string> {
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const projectName = deriveProjectName(normalizedProjectPath);
    if (!projectName) {
      return "";
    }
    return buildWebSocketUrl(
      await getLauncherApiBase(),
      "/v1/launcher/models/logs/stream",
      {
        project_id: projectName,
      }
    );
  }

  async function fetchLauncherLogSnapshot(
    projectPath: string,
    tail = 300
  ): Promise<LauncherModelLogsBatch | null> {
    return await measure("launcher_log_snapshot_ms", async () => {
      const normalizedProjectPath = await resolveProjectPath(projectPath);
      const projectName = deriveProjectName(normalizedProjectPath);
      if (!projectName) {
        return null;
      }
      const url = buildUrl(await getLauncherApiBase(), "/v1/launcher/models/logs", {
        project_id: projectName,
        tail,
      });
      return await tryFetchJSON<LauncherModelLogsBatch>(url);
    });
  }

  async function requestLauncherLogClear(projectPath: string): Promise<void> {
    clearLauncherStatusCache();
    const normalizedProjectPath = await resolveProjectPath(projectPath);
    const projectName = deriveProjectName(normalizedProjectPath);
    if (!projectName) {
      return;
    }
    const url = buildUrl(await getLauncherApiBase(), "/v1/launcher/models/logs/clear");
    await fetchJSON(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ project_id: projectName }),
    });
  }

  async function getDiagnostics(
    projectPath: string,
    launcherProfile: string
  ): Promise<ElectronLauncherDiagnosticsSnapshot> {
    const normalizedProjectPath = projectPath ? await resolveProjectPath(projectPath) : "";
    return {
      current_project_path: normalizedProjectPath,
      launcher_profile: launcherProfile,
      static_hub_endpoint: getStaticHubEndpoint() || null,
      cached_hub_endpoint: cachedHubEndpoint || null,
      launcher_api_base: getLauncherApiBaseSync(),
      terminal_log_stream_url: normalizedProjectPath
        ? await getLauncherLogStreamUrl(normalizedProjectPath)
        : "",
      last_runtime_fetch_at: lastLauncherRuntimeFetchAt,
      last_runtime_fetch_error: lastLauncherRuntimeFetchError,
      status_cache: {
        project_path: cachedLauncherStatus?.projectPath ?? null,
        launcher_profile: cachedLauncherStatus?.launcherProfile ?? null,
        age_ms: cachedLauncherStatus
          ? roundMs(performance.now() - cachedLauncherStatus.loadedAtMs)
          : null,
        ttl_ms: LAUNCHER_STATUS_CACHE_TTL_MS,
        hit_count: statusCacheHitCount,
        miss_count: statusCacheMissCount,
      },
      timings: { ...timings },
    };
  }

  return {
    fetchProjectPaths,
    fetchProjectSettingsData,
    fetchProjectRemoteControlSettings,
    fetchProjectModelPaths,
    fetchProjectWorkloadsRegistry,
    fetchProjectCoreModelSchema,
    getProjectModels,
    refreshProjectModels,
    clearProjectModelCache,
    requestLauncherRun,
    requestLauncherRunModel,
    requestLauncherStop,
    requestLauncherStopModel,
    requestLauncherRestart,
    requestLauncherRestartModel,
    fetchLauncherStatus,
    getLauncherLogStreamUrl,
    fetchLauncherLogSnapshot,
    requestLauncherLogClear,
    getDiagnostics,
  };
}
