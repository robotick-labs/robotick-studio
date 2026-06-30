import * as LauncherReact from "./internal/react-api";
import * as LauncherRest from "./internal/rest-api";
import * as LauncherServiceSurface from "./internal/LauncherService";
import type {
  RcModuleDescriptor,
  RcSettingsResponse,
} from "./internal/remote-control-types";

/**
 * Shared launcher service instance.
 * - React components should consume it via `LauncherServiceProvider` + `useLauncherService()`.
 * - Non-React modules (e.g. utility loaders) can import `launcherService` directly.
 */
const launcherService = LauncherServiceSurface.launcherService;

/**
 * ---------------------------------------------------------------------------
 * Public Launcher API
 *
 * This file groups the public surface by *concept*, not by file structure.
 * UI code should import everything from here. Everything under `internal/`
 * is private implementation and not part of the external contract.
 * ---------------------------------------------------------------------------
 */
export const Launcher = {
  /**
   * Imperative calls to the Python Launcher backend.
   * These perform single actions (start/stop/status/logs) and do not
   * subscribe to anything. Think “RPC over REST”.
   */
  Service: {
    run: LauncherRest.LauncherRest.run, // POST /v1/launcher/models/start
    stop: LauncherRest.LauncherRest.stop, // POST /v1/launcher/models/stop (project/model aggregate)
    status: LauncherRest.LauncherRest.status, // GET /v1/launcher/status
    logs: {
      // Empty until Studio log streaming is migrated off the legacy singleton socket.
      streamUrl: LauncherRest.LauncherRest.logsStreamUrl,
    },
  },

  /**
   * React-facing launcher state.
   * - Provider: attaches launcher state to the component tree
   * - use: read launcher status inside components
   * - events: event emitter for run success/fail transitions
   */
  Context: {
    Provider: LauncherReact.LauncherReact.Provider,
    use: LauncherReact.LauncherReact.use,
    events: LauncherReact.LauncherReact.events,
  },
};

export const Project = {
  /**
   * REST helpers for all project-level concerns:
   * - project root paths
   * - settings.json
   * - RC configuration
   * - model files + descriptors
   * Everything here is stateless and always hits the backend directly.
   */
  Service: {
    listPaths: LauncherRest.ProjectRest.listPaths, // Enumerate project directories

    settings: {
      get: LauncherRest.ProjectRest.settings.get, // Load the active settings profile
      list: LauncherRest.ProjectRest.settings.list, // Discover available settings profiles
      raw: LauncherRest.ProjectRest.settings.raw, // Raw settings.json blob
    },

    remoteControl: {
      getSettings: LauncherRest.ProjectRest.remoteControl.getSettings, // RC config for project
    },

    models: {
      listPaths: LauncherRest.ProjectRest.models.listPaths, // Model file paths on disk
      listDescriptors: LauncherRest.ProjectRest.models.listDescriptors, // Full model descriptors (parsed)
    },

    /**
     * @deprecated Prefer `useLauncherService()` within React or `launcherService`
     * for non-React modules. This alias remains for legacy code paths.
     */
    current: launcherService,
  },

  /**
   * React-facing project selection state.
   * Components read/write “which project is active” through here.
   */
  Context: {
    Provider: LauncherReact.ProjectReact.Provider,
    use: LauncherReact.ProjectReact.use,
  },

  /**
   * Higher-level convenience hooks used by UI screens.
   * These wrap state, loading flags, sorting, confirmation prompts, etc.
   */
  Hooks: {
    useSettingsList: LauncherReact.ProjectReactHooks.useSettingsList, // Settings profiles including loading states
    useModels: LauncherReact.ProjectReactHooks.useModels, // Derived model descriptors
    useChangeConfirmation:
      LauncherReact.ProjectReactHooks.useChangeConfirmation, // “Are you sure?” helper
    useLockStatuses:
      LauncherReact.ProjectReactHooks.useLockStatuses, // Project lock ownership for UI surfaces
  },
};

export const ProjectData = {
  /**
   * Model/telemetry state used across the Hub UI.
   *
   * This mirrors the internal launcher model registry and keeps all model
   * descriptors, RC module lists, and related telemetry synchronised.
   *
   * - Provider: attaches model data to the component tree
   * - use: read/update model data from any UI component
   * - waitFor*: async helpers used during loading and onboarding flows
   * - Synchronous lookup helpers:
   *      - findModelDescriptorInState()
   *      - getProjectModelsStateSnapshot()
   *   These return data immediately without going through React state.
   */
  Provider: LauncherReact.ProjectDataReact.Provider,
  use: LauncherReact.ProjectDataReact.use,

  waitForProjectModelsLoaded:
    LauncherReact.ProjectDataReact.waitForProjectModelsLoaded, // Resolve once *all* model descriptors are present
  waitForModelDescriptorByName:
    LauncherReact.ProjectDataReact.waitForModelDescriptorByName, // Resolve once the named model is available
  findModelDescriptorInState:
    LauncherReact.ProjectDataReact.findModelDescriptorInState, // Non-async lookup inside internal state
  getProjectModelsStateSnapshot:
    LauncherReact.ProjectDataReact.getProjectModelsStateSnapshot, // Snapshot of the internal model state
};

export const RemoteControl = {
  /**
   * Type-only namespace for Remote Control descriptors.
   * These types are used by RC editors, inspectors, and validation logic.
   */
  Types: {
    Module: null as unknown as RcModuleDescriptor,
    Settings: null as unknown as RcSettingsResponse,
  },
};

/**
 * Re-export TS types for convenience. UI code can import everything from here.
 */
export type {
  LauncherStatus,
  ProjectLockStatus,
  ProjectModelDescriptor,
  ProjectSettingsSummary,
} from "./internal/react-api";
export type {
  ProjectSelectionIssue,
  ProjectSelectionResult,
  ProjectSelectionState,
  WorkloadsRegistryEntry,
  WorkloadsRegistryField,
  WorkloadsRegistryResponse,
  WorkloadsRegistryStruct,
} from "./internal/launcher-interface";
export type {
  RcModuleDescriptor,
  RcSettingsResponse,
} from "./internal/remote-control-types";

export {
  LauncherServiceProvider,
  useLauncherService,
  createLauncherService,
  launcherService,
} from "./internal/LauncherService";
export type { LauncherService } from "./internal/LauncherService";
export { createMockLauncherService } from "./internal/__mocks__/LauncherService";
export {
  getTerminalMessageSource,
  type TerminalLogStats,
  getTerminalMessageTarget,
  getTerminalMessageTimestamp,
  terminalMessageText,
  terminalLogService,
  type TerminalLogService,
  type TerminalLogMessage,
  type TerminalLogTarget,
} from "./internal/terminal-log-service";
