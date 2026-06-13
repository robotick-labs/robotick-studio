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
  fetchHubHealth?: (
    endpoint: string
  ) => Promise<StudioControlDiagnosticsHubHealth | null>;
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

export async function getStudioDiagnosticsScreenshot(
  provider: StudioDiagnosticsProvider
): Promise<StudioControlDiagnosticsScreenshot | null> {
  const windowId = provider.getActiveWindowScope() ?? provider.getOpenWindowScopes()[0] ?? null;
  if (!windowId) {
    return null;
  }
  const image = await provider.captureScreenshot?.(windowId);
  if (!image) {
    return null;
  }
  const outputDir = diagnosticsOutputDirectory(provider.workspaceRoot);
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    outputDir,
    `studio-${sanitizeFileSegment(provider.instanceName)}-${sanitizeFileSegment(windowId)}-${timestamp}.png`
  );
  fs.writeFileSync(outputPath, Buffer.from(image));
  return {
    resource_type: "studio_diagnostics_screenshot",
    instance_id: provider.instanceName,
    window_id: windowId,
    output_path: outputPath,
    mime_type: "image/png",
  };
}

export async function getStudioDiagnosticsFetchCheck(
  provider: StudioDiagnosticsProvider
): Promise<StudioControlDiagnosticsFetchCheck> {
  const openWindowIds = provider.getOpenWindowScopes();
  const activeWindowId = provider.getActiveWindowScope() ?? null;
  const fetchFailures = openWindowIds.flatMap(
    (windowId) => provider.getRendererDiagnostics?.(windowId)?.fetch_failures ?? []
  );
  const websocketFailures = openWindowIds.flatMap(
    (windowId) =>
      provider.getRendererDiagnostics?.(windowId)?.websocket_failures ?? []
  );
  return {
    resource_type: "studio_diagnostics_fetch_check",
    instance_id: provider.instanceName,
    active_window_id: activeWindowId,
    fetch_failures: fetchFailures,
    websocket_failures: websocketFailures,
    limitations: [
      "This view reports recent recorded renderer fetch and websocket failures only.",
    ],
  };
}

export async function getStudioDiagnosticsTelemetry(
  provider: StudioDiagnosticsProvider
): Promise<StudioControlDiagnosticsTelemetry> {
  const openWindowIds = provider.getOpenWindowScopes();
  const activeWindowId = provider.getActiveWindowScope() ?? null;
  return {
    resource_type: "studio_diagnostics_telemetry",
    instance_id: provider.instanceName,
    active_window_id: activeWindowId,
    windows: openWindowIds.map((windowId) =>
      buildTelemetryWindowDiagnostics(provider, windowId)
    ),
    limitations: [
      "This view reflects renderer-published telemetry state only.",
    ],
  };
}
