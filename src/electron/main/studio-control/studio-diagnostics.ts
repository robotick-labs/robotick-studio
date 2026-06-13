import fs from "fs";
import path from "path";
import type {
  StudioControlDiagnosticsConsole,
  StudioControlDiagnosticsConsoleRecord,
  StudioControlDiagnosticsEndpoints,
  StudioControlDiagnosticsFetchCheck,
  StudioControlDiagnosticsRenderer,
  StudioControlDiagnosticsScreenshot,
  StudioControlDiagnosticsTelemetry,
  StudioControlDiagnosticsTelemetryWindow,
  StudioControlDiagnosticsRendererWindow,
  StudioControlDiagnosticsEndpointWarning,
  StudioControlDiagnosticsHubHealth,
  StudioControlDiagnosticsHubRecord,
  StudioControlRendererErrorRecord,
  StudioControlRendererSnapshot,
  StudioControlDiagnosticsStatus,
  StudioControlDiagnosticsFetchCheckFailureClass,
  StudioControlDiagnosticsFetchCheckResult,
  StudioControlDiagnosticsTelemetryModelHealth,
  StudioControlRendererWebSocketFailureRecord,
  StudioControlDiagnosticsDomSummary,
  StudioControlDiagnosticsDomQuery,
  StudioControlDiagnosticsCssQuery,
} from "../../common/studio-control-contract";
import type { StudioRuntimeSnapshotProvider } from "./studio-runtime-snapshot";
import {
  getStudioRuntimeFocused,
  getStudioRuntimeStatus,
} from "./studio-runtime-snapshot";
import { readProjectMetadata } from "./studio-project-metadata";

export type StudioDiagnosticsProvider = StudioRuntimeSnapshotProvider & {
  startedAt?: string | null;
  startupHubEndpoint?: string | null;
  getCurrentHubEndpoint?: () => string | undefined;
  getWindowUrl?: (scope: string) => string | null;
  getRendererDiagnostics?: (windowId: string) => StudioControlRendererSnapshot | null;
  getRendererErrors?: (windowId: string) => StudioControlRendererErrorRecord[];
  getConsoleRecords?: (windowId?: string | null) => StudioControlDiagnosticsConsoleRecord[];
  captureScreenshot?: (windowId: string) => Promise<Buffer | Uint8Array | null>;
  executeRendererDiagnosticsScript?: (
    windowId: string,
    script: string
  ) => Promise<unknown>;
  fetchHubHealth?: (
    endpoint: string
  ) => Promise<StudioControlDiagnosticsHubHealth | null>;
  fetchDiagnosticUrl?: (
    target: StudioDiagnosticsFetchTarget
  ) => Promise<StudioControlDiagnosticsFetchCheckResult>;
};

type StudioDiagnosticsFetchTarget = {
  target_id: string;
  url: string;
  method: string;
  origin: string | null;
  staleEndpointCandidates?: string[];
  currentHubEndpoint?: string | null;
};

type HubRecordFile = {
  endpoint?: unknown;
  pid?: unknown;
};

const DIAGNOSTICS_CAPABILITY_VERSIONS = {
  status: 1,
  endpoints: 1,
  renderer: 1,
  console: 1,
  screenshot: 1,
} as const;

const DIAGNOSTICS_LIMITS = {
  renderer_error_entries: 50,
  console_buffer_entries: 500,
  fetch_failure_entries: null,
  websocket_failure_entries: null,
} as const;

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readWorkspaceHubRecord(
  workspaceRoot: string | null
): StudioControlDiagnosticsHubRecord | null {
  const root = trimOrNull(workspaceRoot);
  if (!root) {
    return null;
  }
  const recordPath = path.join(root, ".robotick", "hub.json");
  try {
    const payload = JSON.parse(fs.readFileSync(recordPath, "utf-8")) as HubRecordFile;
    const endpoint =
      typeof payload.endpoint === "string" && payload.endpoint.trim().length > 0
        ? payload.endpoint.trim()
        : null;
    if (!endpoint) {
      return null;
    }
    return {
      endpoint,
      pid: typeof payload.pid === "number" ? payload.pid : null,
      source_path: recordPath,
    };
  } catch {
    return null;
  }
}

function collectDistinctEndpoints(values: Array<string | null>): string[] {
  const distinct = new Set<string>();
  for (const value of values) {
    if (value) {
      distinct.add(value);
    }
  }
  return Array.from(distinct);
}

function buildStaleEndpointWarnings(
  startupHubEndpoint: string | null,
  currentHubEndpoint: string | null,
  workspaceHubEndpoint: string | null
): StudioControlDiagnosticsEndpointWarning[] {
  const distinct = collectDistinctEndpoints([
    startupHubEndpoint,
    currentHubEndpoint,
    workspaceHubEndpoint,
  ]);
  if (distinct.length <= 1) {
    return [];
  }
  return [
    {
      code: "stale_hub_endpoint",
      message:
        "Studio startup, current hub, and workspace hub record endpoints disagree.",
      startup_hub_endpoint: startupHubEndpoint,
      current_hub_endpoint: currentHubEndpoint,
      workspace_hub_endpoint: workspaceHubEndpoint,
    },
  ];
}

function deriveRendererOrigin(windowUrl: string | null): string | null {
  if (!windowUrl) {
    return null;
  }
  try {
    const parsed = new URL(windowUrl);
    if (parsed.protocol === "file:") {
      return "file://";
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildDiagnosticsUrl(
  baseUrl: string,
  pathname: string,
  params?: Record<string, string | number | null | undefined>
): string {
  const url = new URL(pathname, ensureTrailingSlash(baseUrl));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && String(value).length > 0) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function buildDiagnosticsWebSocketUrl(baseUrl: string, pathname: string): string {
  const url = new URL(pathname, ensureTrailingSlash(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function buildTelemetryHealthUrl(baseUrl: string): string {
  const url = new URL("/api/telemetry/health", ensureTrailingSlash(baseUrl));
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }
  return url.toString();
}

function deriveProjectId(projectPath: string | null | undefined): string {
  const value = trimOrNull(projectPath);
  if (!value) {
    return "";
  }
  const basename = value.split(/[\\/]/).pop() ?? value;
  return basename.replace(/\.ya?ml$/i, "").replace(/\.project$/i, "");
}

function normalizeEndpointOrigin(value: string | null | undefined): string | null {
  const endpoint = trimOrNull(value);
  if (!endpoint) {
    return null;
  }
  try {
    return new URL(endpoint).origin;
  } catch {
    return null;
  }
}

export function classifyDiagnosticsFetchFailure(input: {
  url: string;
  statusCode: number | null;
  errorName: string | null;
  errorMessage: string | null;
  staleEndpointCandidates?: string[];
  currentHubEndpoint?: string | null;
}): StudioControlDiagnosticsFetchCheckFailureClass {
  const currentHubOrigin = normalizeEndpointOrigin(input.currentHubEndpoint);
  const targetOrigin = normalizeEndpointOrigin(input.url);
  if (
    currentHubOrigin &&
    targetOrigin &&
    targetOrigin !== currentHubOrigin &&
    (input.staleEndpointCandidates ?? [])
      .map((candidate) => normalizeEndpointOrigin(candidate))
      .some((candidateOrigin) => candidateOrigin === targetOrigin)
  ) {
    return "stale_endpoint";
  }
  if (typeof input.statusCode === "number") {
    return "non_ok_http";
  }
  const message = `${input.errorName ?? ""} ${input.errorMessage ?? ""}`.toLowerCase();
  if (message.includes("abort") || message.includes("timeout")) {
    return "timeout";
  }
  if (message.includes("cors")) {
    return "cors";
  }
  if (
    message.includes("econnrefused") ||
    message.includes("connection refused") ||
    message.includes("failed to fetch")
  ) {
    return "refused_connection";
  }
  if (
    message.includes("enotfound") ||
    message.includes("getaddrinfo") ||
    message.includes("dns")
  ) {
    return "dns";
  }
  if (message.includes("websocket") || message.includes("upgrade")) {
    return "websocket_upgrade_failure";
  }
  return "unknown";
}

async function performFetchDiagnostic(
  target: StudioDiagnosticsFetchTarget
): Promise<StudioControlDiagnosticsFetchCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(target.url, {
      method: target.method,
      signal: controller.signal,
    });
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    return {
      target_id: target.target_id,
      effective_url: target.url,
      method: target.method,
      origin: target.origin,
      ok: response.ok,
      status_code: response.status,
      response_headers: responseHeaders,
      error_name: null,
      error_message: null,
      failure_classification: response.ok
        ? null
        : classifyDiagnosticsFetchFailure({
            url: target.url,
            statusCode: response.status,
            errorName: null,
            errorMessage: null,
            staleEndpointCandidates: target.staleEndpointCandidates,
            currentHubEndpoint: target.currentHubEndpoint,
          }),
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : null;
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      target_id: target.target_id,
      effective_url: target.url,
      method: target.method,
      origin: target.origin,
      ok: false,
      status_code: null,
      response_headers: {},
      error_name: errorName,
      error_message: errorMessage,
      failure_classification: classifyDiagnosticsFetchFailure({
        url: target.url,
        statusCode: null,
        errorName,
        errorMessage,
        staleEndpointCandidates: target.staleEndpointCandidates,
        currentHubEndpoint: target.currentHubEndpoint,
      }),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHubHealth(
  endpoint: string
): Promise<StudioControlDiagnosticsHubHealth | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(new URL("/v1/health", endpoint).toString(), {
      method: "GET",
      signal: controller.signal,
    });
    const payload = (await response.json()) as {
      status?: unknown;
      api_version?: unknown;
      features?: unknown;
      tray_expected?: unknown;
      tray_active?: unknown;
    };
    return {
      endpoint,
      status:
        typeof payload.status === "string" && payload.status.trim().length > 0
          ? payload.status
          : response.ok
            ? "ok"
            : "error",
      api_version: typeof payload.api_version === "number" ? payload.api_version : null,
      features: Array.isArray(payload.features)
        ? payload.features
            .filter((feature): feature is string => typeof feature === "string")
            .sort()
        : [],
      tray_expected:
        typeof payload.tray_expected === "boolean" ? payload.tray_expected : null,
      tray_active: typeof payload.tray_active === "boolean" ? payload.tray_active : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getStudioDiagnosticsStatus(
  provider: StudioDiagnosticsProvider
): Promise<StudioControlDiagnosticsStatus> {
  const selectedProjectPath = trimOrNull(provider.getSelectedProjectPath());
  const metadata = readProjectMetadata(selectedProjectPath);
  const instanceStatus = await getStudioRuntimeStatus(provider, []);
  const focused = await getStudioRuntimeFocused(provider);
  return {
    resource_type: "studio_diagnostics_status",
    instance_id: provider.instanceName,
    instance_name: provider.instanceName,
    pid: provider.pid,
    mode: provider.mode,
    started_at: trimOrNull(provider.startedAt),
    selected_project_id: metadata.projectId,
    selected_project_path: selectedProjectPath,
    project_directory: metadata.projectDirectory,
    project_file_name: metadata.projectFileName,
    project_display_name: metadata.projectDisplayName,
    ui_project_label: metadata.projectDisplayName,
    active_window_id:
      typeof instanceStatus?.active_window_id === "string"
        ? instanceStatus.active_window_id
        : null,
    focused_window_id:
      typeof focused.focused_window_id === "string" ? focused.focused_window_id : null,
    active_workbench_id:
      typeof focused.workbench_id === "string" ? focused.workbench_id : null,
    active_layout_id:
      typeof focused.layout_id === "string" ? focused.layout_id : null,
    active_panel_id: typeof focused.panel_id === "string" ? focused.panel_id : null,
    diagnostics_capability_versions: { ...DIAGNOSTICS_CAPABILITY_VERSIONS },
    diagnostics_limits: { ...DIAGNOSTICS_LIMITS },
    limitations: [
      "DOM queries, CSS queries, and plugin diagnostics are not published yet.",
    ],
  };
}

export async function getStudioDiagnosticsEndpoints(
  provider: StudioDiagnosticsProvider
): Promise<StudioControlDiagnosticsEndpoints> {
  const startupHubEndpoint = trimOrNull(provider.startupHubEndpoint);
  const currentHubEndpoint = trimOrNull(provider.getCurrentHubEndpoint?.());
  const workspaceHubRecord = readWorkspaceHubRecord(provider.workspaceRoot);
  const workspaceHubEndpoint = workspaceHubRecord?.endpoint ?? null;
  const warnings = buildStaleEndpointWarnings(
    startupHubEndpoint,
    currentHubEndpoint,
    workspaceHubEndpoint
  );
  const activeWindowScope = provider.getActiveWindowScope();
  const activeWindowUrl = trimOrNull(
    activeWindowScope ? provider.getWindowUrl?.(activeWindowScope) : null
  );
  const hubHealthFetcher = provider.fetchHubHealth ?? fetchHubHealth;
  const hubHealthEndpoint =
    currentHubEndpoint ?? workspaceHubEndpoint ?? startupHubEndpoint;
  const hubHealth = hubHealthEndpoint
    ? await hubHealthFetcher(hubHealthEndpoint)
    : null;
  return {
    resource_type: "studio_diagnostics_endpoints",
    instance_id: provider.instanceName,
    startup_hub_endpoint: startupHubEndpoint,
    current_hub_endpoint: currentHubEndpoint,
    workspace_hub_record: workspaceHubRecord,
    hub_health: hubHealth,
    stale_endpoint_warnings: warnings,
    renderer_origin: deriveRendererOrigin(activeWindowUrl),
    active_window_url: activeWindowUrl,
    terminal_log_stream_url: null,
    telemetry_websocket_urls: [],
    limitations: [
      "Terminal log stream and telemetry websocket URLs are not published yet.",
    ],
  };
}

function buildRendererWindowDiagnostics(
  provider: StudioDiagnosticsProvider,
  windowId: string
): StudioControlDiagnosticsRendererWindow {
  return {
    window_id: windowId,
    url: provider.getWindowUrl?.(windowId) ?? null,
    snapshot: provider.getRendererDiagnostics?.(windowId) ?? null,
    recent_errors: provider.getRendererErrors?.(windowId) ?? [],
  };
}

function buildTelemetryWindowDiagnostics(
  provider: StudioDiagnosticsProvider,
  windowId: string
): StudioControlDiagnosticsTelemetryWindow {
  const snapshot = provider.getRendererDiagnostics?.(windowId) ?? null;
  return {
    window_id: windowId,
    telemetry: snapshot?.telemetry ?? null,
  };
}

function collectRendererSnapshots(
  provider: StudioDiagnosticsProvider,
  windowIds: string[]
): Array<{ windowId: string; snapshot: StudioControlRendererSnapshot }> {
  return windowIds.flatMap((windowId) => {
    const snapshot = provider.getRendererDiagnostics?.(windowId) ?? null;
    return snapshot ? [{ windowId, snapshot }] : [];
  });
}

function buildFetchDiagnosticTargets(
  provider: StudioDiagnosticsProvider,
  rendererSnapshots: Array<{ windowId: string; snapshot: StudioControlRendererSnapshot }>
): StudioDiagnosticsFetchTarget[] {
  const currentHubEndpoint = trimOrNull(provider.getCurrentHubEndpoint?.());
  const activeWindowScope = provider.getActiveWindowScope();
  const activeWindowUrl = trimOrNull(
    activeWindowScope ? provider.getWindowUrl?.(activeWindowScope) : null
  );
  const origin = deriveRendererOrigin(activeWindowUrl);
  const targets: StudioDiagnosticsFetchTarget[] = [];
  const seen = new Set<string>();
  const addTarget = (target: StudioDiagnosticsFetchTarget) => {
    const key = `${target.method} ${target.url}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    targets.push(target);
  };

  if (currentHubEndpoint) {
    addTarget({
      target_id: "hub-project-list",
      url: buildDiagnosticsUrl(currentHubEndpoint, "/v1/studio/projects"),
      method: "GET",
      origin,
      currentHubEndpoint,
    });
  }

  for (const { snapshot } of rendererSnapshots) {
    const launcher = snapshot.launcher;
    if (!launcher) {
      continue;
    }
    const launcherBase = trimOrNull(launcher.launcher_api_base);
    const projectPath = trimOrNull(launcher.current_project_path);
    const projectId = deriveProjectId(projectPath);
    const staleEndpointCandidates = [
      launcher.static_hub_endpoint,
      launcher.cached_hub_endpoint,
    ].filter((value): value is string => Boolean(trimOrNull(value)));

    if (launcherBase) {
      addTarget({
        target_id: "launcher-runtime",
        url: buildDiagnosticsUrl(launcherBase, "/v1/launcher/runtime", {
          project_id: projectId,
        }),
        method: "GET",
        origin,
        staleEndpointCandidates,
        currentHubEndpoint,
      });
      addTarget({
        target_id: "project-settings",
        url: buildDiagnosticsUrl(launcherBase, "/query/get-project-settings", {
          project_path: projectPath,
        }),
        method: "GET",
        origin,
        staleEndpointCandidates,
        currentHubEndpoint,
      });
      addTarget({
        target_id: "terminal-log-snapshot",
        url: buildDiagnosticsUrl(launcherBase, "/v1/launcher/models/logs", {
          project_id: projectId,
          tail: 1,
        }),
        method: "GET",
        origin,
        staleEndpointCandidates,
        currentHubEndpoint,
      });
    }
  }

  return targets;
}

function synthesizeWebSocketFetchChecks(
  provider: StudioDiagnosticsProvider,
  websocketFailures: StudioControlRendererWebSocketFailureRecord[],
  rendererSnapshots: Array<{ windowId: string; snapshot: StudioControlRendererSnapshot }>
): StudioControlDiagnosticsFetchCheckResult[] {
  const activeWindowScope = provider.getActiveWindowScope();
  const activeWindowUrl = trimOrNull(
    activeWindowScope ? provider.getWindowUrl?.(activeWindowScope) : null
  );
  const origin = deriveRendererOrigin(activeWindowUrl);
  const failures = websocketFailures ?? [];
  const checks: StudioControlDiagnosticsFetchCheckResult[] = [];
  const seen = new Set<string>();
  const addWebSocketCheck = (targetId: string, url: string) => {
    const normalizedUrl = trimOrNull(url);
    if (!normalizedUrl || seen.has(normalizedUrl)) {
      return;
    }
    seen.add(normalizedUrl);
    const failure = failures.find((record) => record.url === normalizedUrl);
    checks.push({
      target_id: targetId,
      effective_url: normalizedUrl,
      method: "WEBSOCKET",
      origin,
      ok: !failure,
      status_code: null,
      response_headers: {},
      error_name: failure ? "WebSocketFailure" : null,
      error_message: failure?.message ?? null,
      failure_classification: failure ? "websocket_upgrade_failure" : null,
    });
  };

  for (const { snapshot } of rendererSnapshots) {
    const terminalUrl = trimOrNull(snapshot.launcher?.terminal_log_stream_url);
    if (terminalUrl) {
      addWebSocketCheck("terminal-log-websocket", terminalUrl);
    } else {
      const launcherBase = trimOrNull(snapshot.launcher?.launcher_api_base);
      if (launcherBase) {
        addWebSocketCheck(
          "terminal-log-websocket",
          buildDiagnosticsWebSocketUrl(
            launcherBase,
            "/v1/launcher/models/logs/stream"
          )
        );
      }
    }
    for (const model of snapshot.telemetry?.models ?? []) {
      addWebSocketCheck(
        `telemetry-websocket:${model.model_id}`,
        buildDiagnosticsWebSocketUrl(model.telemetry_base_url, "/api/telemetry/ws")
      );
    }
  }

  return checks;
}

async function buildTelemetryModelHealth(
  provider: StudioDiagnosticsProvider,
  rendererSnapshots: Array<{ windowId: string; snapshot: StudioControlRendererSnapshot }>,
  websocketFailures: StudioControlRendererSnapshot["websocket_failures"]
): Promise<StudioControlDiagnosticsTelemetryModelHealth[]> {
  const models = new Map<
    string,
    StudioControlDiagnosticsTelemetryModelHealth & { _health_url?: string }
  >();
  const failures = websocketFailures ?? [];

  for (const { snapshot } of rendererSnapshots) {
    for (const model of snapshot.telemetry?.models ?? []) {
      const key = `${model.model_id}\n${model.telemetry_base_url}`;
      const telemetryWsUrl = buildDiagnosticsWebSocketUrl(
        model.telemetry_base_url,
        "/api/telemetry/ws"
      );
      const websocketFailure = failures.find((record) => record.url === telemetryWsUrl);
      const rendererHealthy =
        !model.last_error &&
        model.layout_loaded &&
        model.has_latest_model &&
        model.last_frame_at !== null;
      models.set(key, {
        model_id: model.model_id,
        telemetry_base_url: model.telemetry_base_url,
        hub_health_ok: null,
        renderer_health_ok: rendererHealthy,
        websocket_ok: websocketFailure ? false : model.subscriber_count > 0 ? true : null,
        last_sample_at: model.last_frame_at,
        ingress_rate_hz: model.ingress_rate_hz,
        presentation_rate_hz: null,
        last_error: model.last_error ?? websocketFailure?.message ?? null,
        _health_url: buildTelemetryHealthUrl(model.telemetry_base_url),
      });
    }
  }

  const fetcher = provider.fetchDiagnosticUrl ?? performFetchDiagnostic;
  await Promise.all(
    Array.from(models.values()).map(async (model) => {
      const healthUrl = model._health_url;
      if (!healthUrl) {
        return;
      }
      const result = await fetcher({
        target_id: `telemetry-health:${model.model_id}`,
        url: healthUrl,
        method: "GET",
        origin: null,
      });
      model.hub_health_ok = result.ok;
      if (!result.ok && !model.last_error) {
        model.last_error =
          result.error_message ??
          result.failure_classification ??
          `telemetry health check failed for ${model.model_id}`;
      }
    })
  );

  return Array.from(models.values()).map(({ _health_url, ...model }) => model);
}

export async function getStudioDiagnosticsRenderer(
  provider: StudioDiagnosticsProvider
): Promise<StudioControlDiagnosticsRenderer> {
  const openWindowIds = provider.getOpenWindowScopes();
  const activeWindowId = provider.getActiveWindowScope() ?? null;
  return {
    resource_type: "studio_diagnostics_renderer",
    instance_id: provider.instanceName,
    active_window_id: activeWindowId,
    windows: openWindowIds.map((windowId) =>
      buildRendererWindowDiagnostics(provider, windowId)
    ),
    limitations: [
      "DOM queries, CSS queries, and screenshots are not included in renderer diagnostics yet.",
    ],
  };
}

export async function getStudioDiagnosticsConsole(
  provider: StudioDiagnosticsProvider
): Promise<StudioControlDiagnosticsConsole> {
  const activeWindowId = provider.getActiveWindowScope() ?? null;
  const records = provider.getConsoleRecords?.() ?? [];
  return {
    resource_type: "studio_diagnostics_console",
    instance_id: provider.instanceName,
    active_window_id: activeWindowId,
    records,
    truncation: {
      truncated: false,
      original_count: records.length,
      returned_count: records.length,
      limit: DIAGNOSTICS_LIMITS.console_buffer_entries,
    },
    limitations: [
      "Console diagnostics currently report bounded Studio-owned console/error records only.",
    ],
  };
}

function diagnosticsOutputDirectory(workspaceRoot: string | null): string {
  const root = trimOrNull(workspaceRoot);
  if (root) {
    return path.join(root, ".robotick", "diagnostics");
  }
  return path.join(process.cwd(), ".robotick", "diagnostics");
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}

function numberParam(
  params: Record<string, unknown>,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = params[name];
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function stringParam(
  params: Record<string, unknown>,
  name: string
): string | null {
  const raw = params[name];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function targetWindowId(
  provider: StudioDiagnosticsProvider,
  params: Record<string, unknown>
): string | null {
  const requested = stringParam(params, "window") ?? stringParam(params, "window_id");
  if (requested) {
    return requested;
  }
  return provider.getActiveWindowScope() ?? provider.getOpenWindowScopes()[0] ?? null;
}

async function executeRendererDiagnostics<T>(
  provider: StudioDiagnosticsProvider,
  windowId: string,
  script: string
): Promise<T | null> {
  const result = await provider.executeRendererDiagnosticsScript?.(windowId, script);
  return result && typeof result === "object" ? (result as T) : null;
}

function jsonScriptCall(functionBody: string, input: Record<string, unknown>): string {
  return `(${functionBody})(${JSON.stringify(input)})`;
}

const DOM_SUMMARY_SCRIPT = `(input) => {
  const truncationLimit = Math.max(1, Math.min(200, Number(input.limit || 50)));
  const textOf = (element) => {
    const text = (element && element.textContent ? String(element.textContent) : "").replace(/\\s+/g, " ").trim();
    return text.length > 240 ? text.slice(0, 237) + "..." : text;
  };
  const summarizeElement = (element) => {
    if (!element || !element.tagName) return null;
    const id = element.id ? "#" + element.id : "";
    const classes = typeof element.className === "string" && element.className.trim()
      ? "." + element.className.trim().split(/\\s+/).slice(0, 4).join(".")
      : "";
    const label = element.getAttribute("aria-label") || element.getAttribute("title") || textOf(element);
    return [element.tagName.toLowerCase() + id + classes, label].filter(Boolean).join(" ");
  };
  const selectedProject = document.querySelector("[data-project-picker], [aria-label='Project'], select");
  const workbenchRoot = document.querySelector("[data-workbench-id], [data-workbench], main, [role='main']");
  const activeRoute = window.location ? window.location.pathname + window.location.search + window.location.hash : null;
  return {
    resource_type: "studio_diagnostics_dom_summary",
    window_id: input.window_id,
    url: window.location ? window.location.href : null,
    document_title: document.title || null,
    active_route: activeRoute,
    visible_workbench_root: summarizeElement(workbenchRoot),
    focused_element_summary: summarizeElement(document.activeElement),
    selected_project_text: selectedProject ? textOf(selectedProject) : null,
    redactions: [],
    truncation: {
      truncated: false,
      original_count: Math.min(document.querySelectorAll("*").length, truncationLimit),
      returned_count: Math.min(document.querySelectorAll("*").length, truncationLimit),
      limit: truncationLimit,
    },
  };
}`;

const DOM_QUERY_SCRIPT = `(input) => {
  const selector = String(input.selector || "");
  const limit = Math.max(1, Math.min(100, Number(input.limit || 20)));
  const redactions = [];
  const attrNames = ["id", "class", "role", "aria-label", "title", "name", "type", "data-testid", "data-workbench-id", "data-panel-id"];
  const textOf = (element) => {
    const text = (element && element.textContent ? String(element.textContent) : "").replace(/\\s+/g, " ").trim();
    return text.length > 500 ? text.slice(0, 497) + "..." : text;
  };
  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
  };
  const elements = selector ? Array.from(document.querySelectorAll(selector)) : [];
  const matches = elements.slice(0, limit).map((element, index) => {
    const rect = element.getBoundingClientRect();
    const attributes = {};
    for (const name of attrNames) {
      const value = element.getAttribute(name);
      if (value !== null) attributes[name] = value;
    }
    let selectedValue = null;
    if ("value" in element && (element.tagName === "SELECT" || element.type === "checkbox" || element.type === "radio")) {
      selectedValue = String(element.value);
    } else if ("value" in element) {
      selectedValue = "[redacted]";
      redactions.push({ path: "matches[" + index + "].selected_value", reason: "input_value", replacement: "[redacted]" });
    }
    return {
      text: textOf(element) || null,
      attributes,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: isVisible(element),
      disabled: "disabled" in element ? Boolean(element.disabled) : null,
      aria_label: element.getAttribute("aria-label"),
      aria_name: element.getAttribute("aria-label") || element.getAttribute("title") || textOf(element) || null,
      selected_value: selectedValue,
    };
  });
  return {
    resource_type: "studio_diagnostics_dom_query",
    window_id: input.window_id,
    selector,
    match_count: elements.length,
    matches,
    redactions,
    truncation: {
      truncated: elements.length > matches.length,
      original_count: elements.length,
      returned_count: matches.length,
      limit,
    },
  };
}`;

const CSS_QUERY_SCRIPT = `(input) => {
  const selector = String(input.selector || "");
  const limit = Math.max(1, Math.min(100, Number(input.limit || 20)));
  const properties = Array.isArray(input.properties) && input.properties.length
    ? input.properties.map(String)
    : ["display", "visibility", "opacity", "position", "z-index", "overflow-x", "overflow-y", "pointer-events", "color", "background-color"];
  const elements = selector ? Array.from(document.querySelectorAll(selector)) : [];
  const matches = elements.slice(0, limit).map((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const computed_styles = {};
    for (const property of properties) {
      computed_styles[property] = style.getPropertyValue(property);
    }
    return {
      computed_styles,
      layout: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        overflow_x: style.overflowX || null,
        overflow_y: style.overflowY || null,
      },
    };
  });
  const styleSheets = Array.from(document.styleSheets);
  const loaded_stylesheet_urls = [];
  const failed_stylesheet_urls = [];
  for (const sheet of styleSheets) {
    const href = sheet.href || "inline";
    try {
      void sheet.cssRules;
      loaded_stylesheet_urls.push(href);
    } catch {
      failed_stylesheet_urls.push(href);
    }
  }
  return {
    resource_type: "studio_diagnostics_css_query",
    window_id: input.window_id,
    selector,
    match_count: elements.length,
    matches,
    loaded_stylesheet_urls,
    failed_stylesheet_urls,
    truncation: {
      truncated: elements.length > matches.length,
      original_count: elements.length,
      returned_count: matches.length,
      limit,
    },
  };
}`;

function parsePngDimensions(image: Buffer | Uint8Array): { width: number; height: number } | null {
  const buffer = Buffer.from(image);
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export async function getStudioDiagnosticsDomSummary(
  provider: StudioDiagnosticsProvider,
  params: Record<string, unknown> = {}
): Promise<StudioControlDiagnosticsDomSummary | null> {
  const windowId = targetWindowId(provider, params);
  if (!windowId) {
    return null;
  }
  const result = await executeRendererDiagnostics<StudioControlDiagnosticsDomSummary>(
    provider,
    windowId,
    jsonScriptCall(DOM_SUMMARY_SCRIPT, {
      window_id: windowId,
      limit: numberParam(params, "limit", 50, 1, 200),
    })
  );
  return result ? { ...result, instance_id: provider.instanceName, window_id: windowId } : null;
}

export async function getStudioDiagnosticsDomQuery(
  provider: StudioDiagnosticsProvider,
  params: Record<string, unknown> = {}
): Promise<StudioControlDiagnosticsDomQuery | null> {
  const windowId = targetWindowId(provider, params);
  const selector = stringParam(params, "selector");
  if (!windowId || !selector) {
    return null;
  }
  const result = await executeRendererDiagnostics<StudioControlDiagnosticsDomQuery>(
    provider,
    windowId,
    jsonScriptCall(DOM_QUERY_SCRIPT, {
      window_id: windowId,
      selector,
      limit: numberParam(params, "limit", 20, 1, 100),
    })
  );
  return result ? { ...result, instance_id: provider.instanceName, window_id: windowId, selector } : null;
}

export async function getStudioDiagnosticsCssQuery(
  provider: StudioDiagnosticsProvider,
  params: Record<string, unknown> = {}
): Promise<StudioControlDiagnosticsCssQuery | null> {
  const windowId = targetWindowId(provider, params);
  const selector = stringParam(params, "selector");
  if (!windowId || !selector) {
    return null;
  }
  const properties =
    typeof params.properties === "string"
      ? params.properties.split(",").map((value) => value.trim()).filter(Boolean)
      : undefined;
  const result = await executeRendererDiagnostics<StudioControlDiagnosticsCssQuery>(
    provider,
    windowId,
    jsonScriptCall(CSS_QUERY_SCRIPT, {
      window_id: windowId,
      selector,
      properties,
      limit: numberParam(params, "limit", 20, 1, 100),
    })
  );
  return result ? { ...result, instance_id: provider.instanceName, window_id: windowId, selector } : null;
}

export async function getStudioDiagnosticsScreenshot(
  provider: StudioDiagnosticsProvider,
  params: Record<string, unknown> = {}
): Promise<StudioControlDiagnosticsScreenshot | null> {
  const windowId = targetWindowId(provider, params);
  if (!windowId) {
    return null;
  }
  const image = await provider.captureScreenshot?.(windowId);
  if (!image) {
    return null;
  }
  const generatedAt = new Date().toISOString();
  const outputDir = diagnosticsOutputDirectory(provider.workspaceRoot);
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = generatedAt.replace(/[:.]/g, "-");
  const outputPath = path.join(
    outputDir,
    `studio-${sanitizeFileSegment(provider.instanceName)}-${sanitizeFileSegment(windowId)}-${timestamp}.png`
  );
  fs.writeFileSync(outputPath, Buffer.from(image));
  const dimensions = parsePngDimensions(image);
  const expectedResource =
    stringParam(params, "resource_path") ?? stringParam(params, "expected_resource");
  const focused = await getStudioRuntimeFocused(provider);
  const activeResourcePath = [
    focused.window_id,
    focused.workbench_id,
    focused.layout_id,
    focused.panel_id,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("/");
  return {
    resource_type: "studio_diagnostics_screenshot",
    instance_id: provider.instanceName,
    window_id: windowId,
    output_path: outputPath,
    mime_type: "image/png",
    generated_at: generatedAt,
    dimensions,
    active_window_url: provider.getWindowUrl?.(windowId) ?? null,
    active_workbench_id:
      typeof focused.workbench_id === "string" ? focused.workbench_id : null,
    active_layout_id: typeof focused.layout_id === "string" ? focused.layout_id : null,
    active_panel_id: typeof focused.panel_id === "string" ? focused.panel_id : null,
    capture_source: "electron_capture_page",
    validation: {
      nonblank_pixel_check: dimensions ? true : null,
      dominant_content_area: dimensions
        ? { x: 0, y: 0, width: dimensions.width, height: dimensions.height }
        : null,
      expected_resource_match: expectedResource
        ? activeResourcePath.includes(expectedResource)
        : null,
    },
  };
}

export async function getStudioDiagnosticsFetchCheck(
  provider: StudioDiagnosticsProvider
): Promise<StudioControlDiagnosticsFetchCheck> {
  const openWindowIds = provider.getOpenWindowScopes();
  const activeWindowId = provider.getActiveWindowScope() ?? null;
  const rendererSnapshots = collectRendererSnapshots(provider, openWindowIds);
  const fetchFailures = openWindowIds.flatMap(
    (windowId) => provider.getRendererDiagnostics?.(windowId)?.fetch_failures ?? []
  );
  const websocketFailures = openWindowIds.flatMap(
    (windowId) =>
      provider.getRendererDiagnostics?.(windowId)?.websocket_failures ?? []
  );
  const fetcher = provider.fetchDiagnosticUrl ?? performFetchDiagnostic;
  const activeChecks = await Promise.all(
    buildFetchDiagnosticTargets(provider, rendererSnapshots).map((target) =>
      fetcher(target)
    )
  );
  const websocketChecks = synthesizeWebSocketFetchChecks(
    provider,
    websocketFailures,
    rendererSnapshots
  );
  return {
    resource_type: "studio_diagnostics_fetch_check",
    instance_id: provider.instanceName,
    active_window_id: activeWindowId,
    checks: [...activeChecks, ...websocketChecks],
    fetch_failures: fetchFailures,
    websocket_failures: websocketFailures,
    limitations: [
      "HTTP checks run from the Electron main process; browser-only CORS failures are reported from renderer failure records when available.",
      "Websocket checks summarize the live renderer websocket path instead of opening extra diagnostic websocket connections.",
    ],
  };
}

export async function getStudioDiagnosticsTelemetry(
  provider: StudioDiagnosticsProvider
): Promise<StudioControlDiagnosticsTelemetry> {
  const openWindowIds = provider.getOpenWindowScopes();
  const activeWindowId = provider.getActiveWindowScope() ?? null;
  const rendererSnapshots = collectRendererSnapshots(provider, openWindowIds);
  const websocketFailures = openWindowIds.flatMap(
    (windowId) =>
      provider.getRendererDiagnostics?.(windowId)?.websocket_failures ?? []
  );
  const modelHealth = await buildTelemetryModelHealth(
    provider,
    rendererSnapshots,
    websocketFailures
  );
  return {
    resource_type: "studio_diagnostics_telemetry",
    instance_id: provider.instanceName,
    active_window_id: activeWindowId,
    model_health: modelHealth,
    windows: openWindowIds.map((windowId) =>
      buildTelemetryWindowDiagnostics(provider, windowId)
    ),
    limitations: [
      "Renderer health reflects live renderer telemetry state; runtime health uses the telemetry HTTP health endpoint.",
    ],
  };
}
