import { ProjectProvider, useProjectContext } from "./internal/ProjectContext";

import {
  LauncherProvider,
  useLauncherContext,
  launcherEvents,
} from "./internal/LauncherContext";
import type { LauncherStatus } from "./internal/LauncherContext";

import {
  LauncherDataProvider,
  useLauncherData,
  waitForProjectModelsLoaded,
  waitForModelDescriptorByName,
  findModelDescriptorInState,
  getProjectModelsStateSnapshot,
} from "./internal/LauncherDataContext";

import { useProjectSettingsList } from "./internal/use-project-settings-list";
import { useProjectModels } from "./internal/use-project-models";
import { useProjectChangeConfirmation } from "./internal/use-project-change-confirmation";

import {
  fetchProjectSettingsData,
  fetchProjectRemoteControlSettings,
  requestLauncherRun,
  requestLauncherStop,
  fetchLauncherStatus,
  getLauncherLogStreamUrl,
  fetchProjectModelPaths,
} from "./internal/launcher-interface";
import currentProject from "./internal/launcher-interface";

import {
  listProjectPaths,
  getProjectSettings,
  fetchProjectSettingsList,
  fetchProjectModels,
} from "./internal/projects-api";

import type { ProjectSettingsSummary } from "./internal/projects-api";
import type { ProjectModelDescriptor } from "./internal/launcher-interface";
import type {
  RcModuleDescriptor,
  RcSettingsResponse,
} from "./internal/remote-control-types";

/**
 * ---------------------------------------------------------------------------
 * Public Launcher API
 *
 * This file groups the public surface by *concept*, not by file structure.
 * UI code should import everything from here. Everything under `internal/`
 * is implementation detail and not part of the external contract.
 * ---------------------------------------------------------------------------
 */
export const Launcher = {
  /**
   * Imperative calls to the Python Launcher backend.
   * These perform single actions (start/stop/status/logs) and do not
   * subscribe to anything. Think “RPC over REST”.
   */
  Service: {
    run: requestLauncherRun, // POST /launcher/run
    stop: requestLauncherStop, // POST /launcher/stop
    status: fetchLauncherStatus, // GET /launcher/status
    logs: {
      // URL for live streamed logs; consumer chooses SSE/WebSocket/etc.
      streamUrl: getLauncherLogStreamUrl,
    },
  },

  /**
   * React-facing launcher state.
   * - Provider: attaches launcher state to the component tree
   * - use: read launcher status inside components
   * - events: event emitter for run success/fail transitions
   */
  Context: {
    Provider: LauncherProvider,
    use: useLauncherContext,
    events: launcherEvents,
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
    listPaths: listProjectPaths, // Enumerate project directories

    settings: {
      get: getProjectSettings, // Load the active settings profile
      list: fetchProjectSettingsList, // Discover available settings profiles
      raw: fetchProjectSettingsData, // Raw settings.json blob
    },

    remoteControl: {
      getSettings: fetchProjectRemoteControlSettings, // RC config for project
    },

    models: {
      listPaths: fetchProjectModelPaths, // Model file paths on disk
      listDescriptors: fetchProjectModels, // Full model descriptors (parsed)
    },

    // Deprecated convenience; kept for backwards compatibility
    current: currentProject,
  },

  /**
   * React-facing project selection state.
   * Components read/write “which project is active” through here.
   */
  Context: {
    Provider: ProjectProvider,
    use: useProjectContext,
  },

  /**
   * Higher-level convenience hooks used by UI screens.
   * These wrap state, loading flags, sorting, confirmation prompts, etc.
   */
  Hooks: {
    useSettingsList: useProjectSettingsList, // Settings profiles including loading states
    useModels: useProjectModels, // Derived model descriptors
    useChangeConfirmation: useProjectChangeConfirmation, // “Are you sure?” helper
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
  Provider: LauncherDataProvider,
  use: useLauncherData,

  waitForProjectModelsLoaded, // Resolve once *all* model descriptors are present
  waitForModelDescriptorByName, // Resolve once the named model is available
  findModelDescriptorInState, // Non-async lookup inside internal state
  getProjectModelsStateSnapshot, // Snapshot of the internal model state
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
  ProjectModelDescriptor,
  ProjectSettingsSummary,
  RcModuleDescriptor,
  RcSettingsResponse,
};
