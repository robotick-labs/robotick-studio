export type ProjectModelDescriptor<T = unknown> = {
  modelPath: string;
  modelShortName: string;
  modelName: string;
  telemetryPort: number;
  telemetryBaseUrl: string;
  telemetryPushRateHz: number;
  data: T;
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
  registry?: Array<{
    type: string;
    metadata?: {
      name?: string;
      structs?: Record<
        string,
        {
          name?: string | null;
          fields?: Array<{
            name: string;
            type: string;
            default?: string;
            element_count?: number;
            primitive_kind?: string;
            enum_values?: string[];
          }>;
        }
      >;
    };
  }>;
  shared_types?: {
    primitives?: Record<string, Record<string, unknown>>;
    structs?: Record<string, Record<string, unknown>>;
  };
};

export type LauncherDiagnostics = {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type LauncherLogRef = {
  kind?: string;
  path?: string;
};

export type LauncherRuntimeModelRecord = {
  id?: string;
  project_id?: string;
  project_path?: string;
  model_id?: string;
  lifecycle?: string;
  readiness?: string;
  freshness?: "live" | "stopped" | "pending" | "failed";
  operation?: {
    action?: string;
    pid?: number;
    pid_alive?: boolean;
  } | null;
  pid?: number;
  pid_alive?: boolean;
  health?: {
    configured?: boolean;
    healthy?: boolean;
    error?: string | null;
    checked_at?: string;
  };
  log_path?: string | null;
  updated_at?: string;
};

export type LauncherRuntimeStatusResponse = {
  resource_type?: string;
  state?: string;
  models?: LauncherRuntimeModelRecord[];
};

export type LauncherStatusResponse = {
  resource_type?: string;
  ability?: {
    name?: string;
    version?: string;
    status?: string;
    details?: Record<string, unknown>;
  };
  runtime?: LauncherRuntimeStatusResponse;
};

export type LegacyLauncherModelStatus = {
  stage?: string;
  status?: string;
  lifecycle?: string;
  readiness?: string;
  freshness?: "live" | "stale" | "stopped" | "pending" | "failed";
  diagnostics?: LauncherDiagnostics[];
  logRefs?: LauncherLogRef[];
};

export type LegacyLauncherStatus = {
  status: string;
  phase?: string | null;
  profile?: string | null;
  models?: Record<string, LegacyLauncherModelStatus>;
};

export type LauncherModelLogEvent = {
  project_id: string;
  model_id: string;
  source_kind: string;
  path: string;
  offset: number;
  line: string;
  timestamp?: string;
};

export type LauncherModelLogsSnapshot = {
  resource_type: "robotick_launcher_model_logs";
  project_id: string;
  model_id: string;
  sources: Array<{
    source_kind: string;
    path: string;
    label?: string;
    clear_offset?: number;
    read_offset?: number;
    available?: boolean;
  }>;
  events: LauncherModelLogEvent[];
};

export type LauncherModelLogsBatch = {
  resource_type: "robotick_launcher_model_logs_batch";
  project_id: string;
  models: LauncherModelLogsSnapshot[];
};

export type ElectronLauncherDiagnosticsSnapshot = {
  current_project_path: string;
  launcher_profile: string;
  static_hub_endpoint: string | null;
  cached_hub_endpoint: string | null;
  launcher_api_base: string;
  terminal_log_stream_url: string;
  last_runtime_fetch_at: string | null;
  last_runtime_fetch_error: string | null;
  status_cache: {
    project_path: string | null;
    launcher_profile: string | null;
    age_ms: number | null;
    ttl_ms: number;
    hit_count: number;
    miss_count: number;
  };
  timings?: {
    list_project_paths_ms?: number;
    project_settings_ms?: number;
    project_remote_control_settings_ms?: number;
    project_model_paths_ms?: number;
    project_models_ms?: number;
    launcher_status_ms?: number;
    launcher_log_snapshot_ms?: number;
  };
};

export type LauncherBridgePlatform = "local" | "native";

export type LauncherProjectPathPayload = {
  projectPath?: string;
};

export type LauncherProjectProfilePayload = {
  projectPath?: string;
  launcherProfile?: string;
};

export type LauncherProjectModelsPayload = LauncherProjectProfilePayload & {
  force?: boolean;
};

export type LauncherModelControlPayload = {
  projectPath?: string;
  platform?: LauncherBridgePlatform;
  modelId?: string;
};

export type LauncherTargetPayload = {
  projectPath?: string;
  target?: string;
};

export type LauncherLogSnapshotPayload = {
  projectPath?: string;
  tail?: number;
};

export type RobotickLauncherBridge = {
  readonly listProjectPaths: () => Promise<unknown>;
  readonly getProjectSettings: (projectPath: string) => Promise<unknown>;
  readonly getProjectRemoteControlSettings: (projectPath: string) => Promise<unknown>;
  readonly listProjectModelPaths: (projectPath: string) => Promise<unknown>;
  readonly getWorkloadsRegistry: (
    projectPath: string,
    target?: string,
  ) => Promise<unknown>;
  readonly getCoreModelSchema: (
    projectPath: string,
    target?: string,
  ) => Promise<unknown>;
  readonly getProjectModels: (
    projectPath: string,
    launcherProfile: string,
    options?: { force?: boolean },
  ) => Promise<unknown>;
  readonly clearProjectModelCache: (
    projectPath?: string,
    launcherProfile?: string,
  ) => Promise<unknown>;
  readonly run: (projectPath: string, launcherProfile: string) => Promise<unknown>;
  readonly runModel: (
    projectPath: string,
    platform: LauncherBridgePlatform,
    modelId: string,
  ) => Promise<unknown>;
  readonly stop: (projectPath: string) => Promise<unknown>;
  readonly stopModel: (
    projectPath: string,
    platform: LauncherBridgePlatform,
    modelId: string,
  ) => Promise<unknown>;
  readonly restart: (projectPath: string, launcherProfile: string) => Promise<unknown>;
  readonly restartModel: (
    projectPath: string,
    platform: LauncherBridgePlatform,
    modelId: string,
  ) => Promise<unknown>;
  readonly getStatus: (
    projectPath: string,
    launcherProfile: string,
  ) => Promise<unknown>;
  readonly getLogStreamUrl: (projectPath: string) => Promise<unknown>;
  readonly getLogSnapshot: (projectPath: string, tail?: number) => Promise<unknown>;
  readonly clearLogs: (projectPath: string) => Promise<unknown>;
  readonly getDiagnostics: (
    projectPath: string,
    launcherProfile: string,
  ) => Promise<unknown>;
};
