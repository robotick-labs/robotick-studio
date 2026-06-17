export type StudioControlCollection = {
  name: string;
  resource_type: string;
  item_count: number;
};

export type StudioControlCommandProvider =
  | "electron_main"
  | "renderer_assisted"
  | "renderer";

export type StudioControlCommandAvailability = {
  requires_live_instance: boolean;
  requires_renderer: boolean;
  resource_scope: "instance" | "resource" | "diagnostics" | "project" | "telemetry";
};

export type StudioControlCommandDescriptor = {
  id: string;
  title: string;
  description: string;
  provider: StudioControlCommandProvider;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  availability: StudioControlCommandAvailability;
  read_only: boolean;
  destructive: boolean;
};

export type StudioControlResourceSummary = {
  resource_type: string;
  id: string;
  label?: string;
  [key: string]: unknown;
};

export type StudioControlStatus = {
  resource_type: string;
  id: string;
  child_collections?: StudioControlCollection[];
  child_resources?: StudioControlResourceSummary[];
  children?: Record<string, StudioControlResourceSummary[]>;
  state_sources?: Record<string, string>;
  [key: string]: unknown;
};

export type StudioControlProjectSelectionRequest = {
  project_path?: string;
};

export type StudioControlProjectSelectionResponse = {
  accepted: boolean;
  currentProjectPath: string;
  issue: {
    type: "locked" | "error";
    projectPath: string;
    instanceName?: string;
    pid?: number;
    message: string;
  } | null;
};

export type StudioControlActivationResponse = {
  accepted: boolean;
  changed: boolean;
  activated_path: string[];
  previous_active_path: string[] | null;
  message: string;
};

export type StudioControlDiagnosticsCapabilityVersions = {
  status: number;
  endpoints: number;
  renderer: number;
  console?: number;
  screenshot?: number;
};

export type StudioControlDiagnosticsLimits = {
  renderer_error_entries: number | null;
  console_buffer_entries: number | null;
  fetch_failure_entries: number | null;
  websocket_failure_entries: number | null;
};

export type StudioControlRedactionReason =
  | "input_value"
  | "token"
  | "auth_header"
  | "environment_secret"
  | "sensitive_query_param"
  | "plugin_defined";

export type StudioControlRedactionNotice = {
  path: string;
  reason: StudioControlRedactionReason;
  replacement: string;
};

export type StudioControlTruncationMetadata = {
  truncated: boolean;
  original_count: number | null;
  returned_count: number;
  limit: number | null;
};

export type StudioControlDiagnosticsStatus = {
  resource_type: "studio_diagnostics_status";
  instance_id: string;
  instance_name: string;
  pid: number;
  mode: string;
  started_at: string | null;
  selected_project_id: string | null;
  selected_project_path: string | null;
  project_directory: string | null;
  project_file_name: string | null;
  project_display_name: string | null;
  ui_project_label: string | null;
  active_window_id: string | null;
  focused_window_id: string | null;
  active_workbench_id: string | null;
  active_layout_id: string | null;
  active_panel_id: string | null;
  diagnostics_capability_versions: StudioControlDiagnosticsCapabilityVersions;
  diagnostics_limits: StudioControlDiagnosticsLimits;
  limitations: string[];
};

export type StudioControlDiagnosticsHubRecord = {
  endpoint: string;
  pid: number | null;
  source_path: string;
};

export type StudioControlDiagnosticsHubHealth = {
  endpoint: string;
  status: string;
  api_version: number | null;
  features: string[];
  tray_expected: boolean | null;
  tray_active: boolean | null;
};

export type StudioControlDiagnosticsEndpointWarning = {
  code: "stale_hub_endpoint";
  message: string;
  startup_hub_endpoint: string | null;
  current_hub_endpoint: string | null;
  workspace_hub_endpoint: string | null;
};

export type StudioControlDiagnosticsEndpoints = {
  resource_type: "studio_diagnostics_endpoints";
  instance_id: string;
  startup_hub_endpoint: string | null;
  current_hub_endpoint: string | null;
  workspace_hub_record: StudioControlDiagnosticsHubRecord | null;
  hub_health: StudioControlDiagnosticsHubHealth | null;
  stale_endpoint_warnings: StudioControlDiagnosticsEndpointWarning[];
  renderer_origin: string | null;
  active_window_url: string | null;
  terminal_log_stream_url: string | null;
  telemetry_websocket_urls: string[];
  limitations: string[];
};

export type StudioControlRendererErrorRecord = {
  window_id: string | null;
  recorded_at: string;
  type: string;
  message: string;
  source: string | null;
  lineno: number | null;
  colno: number | null;
  stack: string | null;
};

export type StudioControlDiagnosticsConsoleRecord = {
  window_id: string | null;
  recorded_at: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  source_url: string | null;
  line: number | null;
  column: number | null;
  stack: string | null;
  payload: Record<string, unknown> | null;
};

export type StudioControlRendererLauncherDiagnostics = {
  current_project_path: string;
  launcher_profile: string;
  static_hub_endpoint: string | null;
  cached_hub_endpoint: string | null;
  launcher_api_base: string;
  terminal_log_stream_url: string;
  bootstrap_issue: {
    type: "locked" | "error";
    projectPath: string;
    instanceName?: string;
    pid?: number;
    message: string;
  } | null;
  last_runtime_fetch_at: string | null;
  last_runtime_fetch_error: string | null;
};

export type StudioControlRendererProjectPickerDiagnostics = {
  selected_project_path: string;
  selected_value: string;
  rendered_label: string | null;
  project_display_name: string | null;
  project_file_name: string | null;
};

export type StudioControlRendererTelemetryModelDiagnostics = {
  model_id: string;
  telemetry_base_url: string;
  subscriber_count: number;
  last_frame_at: string | null;
  ingress_rate_hz: number;
  layout_loaded: boolean;
  has_latest_model: boolean;
  last_error: string | null;
};

export type StudioControlRendererTelemetryDiagnostics = {
  loading: boolean;
  error: string | null;
  model_count: number;
  models: StudioControlRendererTelemetryModelDiagnostics[];
};

export type StudioControlRendererFetchFailureRecord = {
  recorded_at: string;
  source: string;
  operation: string;
  url: string;
  status_code: number | null;
  message: string;
};

export type StudioControlRendererWebSocketFailureRecord = {
  recorded_at: string;
  source: string;
  phase: string;
  url: string;
  message: string;
  close_code: number | null;
};

export type StudioControlRendererSnapshot = {
  updated_at: string | null;
  launcher?: StudioControlRendererLauncherDiagnostics;
  project_picker?: StudioControlRendererProjectPickerDiagnostics;
  telemetry?: StudioControlRendererTelemetryDiagnostics;
  fetch_failures?: StudioControlRendererFetchFailureRecord[];
  websocket_failures?: StudioControlRendererWebSocketFailureRecord[];
};

export type StudioControlDiagnosticsRendererWindow = {
  window_id: string;
  url: string | null;
  snapshot: StudioControlRendererSnapshot | null;
  recent_errors: StudioControlRendererErrorRecord[];
};

export type StudioControlDiagnosticsRenderer = {
  resource_type: "studio_diagnostics_renderer";
  instance_id: string;
  active_window_id: string | null;
  windows: StudioControlDiagnosticsRendererWindow[];
  limitations: string[];
};

export type StudioControlDiagnosticsFetchCheck = {
  resource_type: "studio_diagnostics_fetch_check";
  instance_id: string;
  active_window_id: string | null;
  checks: StudioControlDiagnosticsFetchCheckResult[];
  fetch_failures: StudioControlRendererFetchFailureRecord[];
  websocket_failures: StudioControlRendererWebSocketFailureRecord[];
  limitations: string[];
};

export type StudioControlDiagnosticsFetchCheckFailureClass =
  | "stale_endpoint"
  | "cors"
  | "refused_connection"
  | "timeout"
  | "dns"
  | "non_ok_http"
  | "websocket_upgrade_failure"
  | "unknown";

export type StudioControlDiagnosticsFetchCheckResult = {
  target_id: string;
  effective_url: string;
  method: string;
  origin: string | null;
  ok: boolean;
  status_code: number | null;
  response_headers: Record<string, string>;
  error_name: string | null;
  error_message: string | null;
  failure_classification: StudioControlDiagnosticsFetchCheckFailureClass | null;
};

export type StudioControlDiagnosticsTelemetryWindow = {
  window_id: string;
  telemetry: StudioControlRendererTelemetryDiagnostics | null;
};

export type StudioControlDiagnosticsTelemetry = {
  resource_type: "studio_diagnostics_telemetry";
  instance_id: string;
  active_window_id: string | null;
  model_health: StudioControlDiagnosticsTelemetryModelHealth[];
  windows: StudioControlDiagnosticsTelemetryWindow[];
  limitations: string[];
};

export type StudioControlDiagnosticsTelemetryModelHealth = {
  model_id: string;
  telemetry_base_url: string;
  hub_health_ok: boolean | null;
  renderer_health_ok: boolean | null;
  websocket_ok: boolean | null;
  last_sample_at: string | null;
  ingress_rate_hz: number | null;
  presentation_rate_hz: number | null;
  last_error: string | null;
};

export type StudioControlDiagnosticsDomSummary = {
  resource_type: "studio_diagnostics_dom_summary";
  instance_id: string;
  window_id: string;
  url: string | null;
  document_title: string | null;
  active_route: string | null;
  visible_workbench_root: string | null;
  focused_element_summary: string | null;
  selected_project_text: string | null;
  redactions: StudioControlRedactionNotice[];
  truncation: StudioControlTruncationMetadata;
};

export type StudioControlDiagnosticsDomQueryMatch = {
  text: string | null;
  attributes: Record<string, string>;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  visible: boolean | null;
  disabled: boolean | null;
  aria_label: string | null;
  aria_name: string | null;
  selected_value: string | null;
};

export type StudioControlDiagnosticsDomQuery = {
  resource_type: "studio_diagnostics_dom_query";
  instance_id: string;
  window_id: string;
  selector: string;
  match_count: number;
  matches: StudioControlDiagnosticsDomQueryMatch[];
  redactions: StudioControlRedactionNotice[];
  truncation: StudioControlTruncationMetadata;
};

export type StudioControlDiagnosticsCssQueryMatch = {
  computed_styles: Record<string, string>;
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
    overflow_x: string | null;
    overflow_y: string | null;
  } | null;
};

export type StudioControlDiagnosticsCssQuery = {
  resource_type: "studio_diagnostics_css_query";
  instance_id: string;
  window_id: string;
  selector: string;
  match_count: number;
  matches: StudioControlDiagnosticsCssQueryMatch[];
  loaded_stylesheet_urls: string[];
  failed_stylesheet_urls: string[];
  truncation: StudioControlTruncationMetadata;
};

export type StudioControlDiagnosticsScreenshot = {
  resource_type: "studio_diagnostics_screenshot";
  instance_id: string;
  window_id: string;
  output_path: string;
  mime_type: "image/png";
  generated_at: string;
  dimensions: {
    width: number;
    height: number;
  } | null;
  active_window_url: string | null;
  active_workbench_id: string | null;
  active_layout_id: string | null;
  active_panel_id: string | null;
  capture_source: "electron_capture_page";
  validation: {
    nonblank_pixel_check: boolean | null;
    dominant_content_area: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    expected_resource_match: boolean | null;
  };
};

export type StudioControlDiagnosticsConsole = {
  resource_type: "studio_diagnostics_console";
  instance_id: string;
  active_window_id: string | null;
  records: StudioControlDiagnosticsConsoleRecord[];
  truncation: StudioControlTruncationMetadata;
  limitations: string[];
};

export type StudioControlDiagnosticsSnapshot = {
  resource_type: "studio_diagnostics_snapshot";
  instance_id: string;
  generated_at: string;
  status: StudioControlDiagnosticsStatus | null;
  endpoints: StudioControlDiagnosticsEndpoints | null;
  renderer: StudioControlDiagnosticsRenderer | null;
  console: {
    records: StudioControlDiagnosticsConsoleRecord[];
    truncation: StudioControlTruncationMetadata;
  } | null;
  fetch_check: StudioControlDiagnosticsFetchCheck | null;
  telemetry: StudioControlDiagnosticsTelemetry | null;
  dom_summary: StudioControlDiagnosticsDomSummary | null;
  screenshot: StudioControlDiagnosticsScreenshot | null;
  redactions: StudioControlRedactionNotice[];
};
