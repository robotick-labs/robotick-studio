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
 * Launcher module public API.
 *
 * The grouped objects below make it obvious which surface you should use:
 * - `Launcher.Service`: imperative REST calls for starting/stopping the runtime.
 * - `Launcher.Context`: React provider/hook/event emitter for launcher status.
 * - `Project.Service`: REST helpers for project settings/models/RC config.
 * - `Project.Context`: current project selection provider/hook.
 * - `Project.Hooks`: UI conveniences (settings list, model paths, confirmations).
 * - `ProjectData`: React provider/hook for project-model telemetry data.
 * - `RemoteControl.Types`: type definitions for RC modules/settings.
 *
 * Everything under `internal/` is considered private.
 */

export const Launcher = {
  Service: {
    // Low-level REST calls. These do not store state; they simply hit endpoints.

    run: requestLauncherRun, // POST /launcher/run
    stop: requestLauncherStop, // POST /launcher/stop
    status: fetchLauncherStatus, // GET /launcher/status

    logs: {
      // Provides the URL for live log streaming.
      // The UI decides how to consume it (WebSocket, <iframe>, SSE, etc.).
      streamUrl: getLauncherLogStreamUrl,
    },
  },

  Context: {
    // React: live view of launcher state and lifecycle events.
    // Wrap <App> in this Provider to make state available.
    Provider: LauncherProvider,

    // Hook to access launcher state inside components:
    //   const { status, isRunning } = Launcher.Context.use();
    use: useLauncherContext,

    // Event emitter used by UI subcomponents when they need to respond
    // to "run started", "run failed", "logs cleared", etc.
    events: launcherEvents,
  },
};

export const Project = {
  Service: {
    // REST helpers to inspect or modify project data.
    // These are stateless and always hit the backend directly.

    listPaths: listProjectPaths, // Enumerate valid project paths on disk.

    settings: {
      get: getProjectSettings, // Load settings.json for current project.
      list: fetchProjectSettingsList, // Fetch list of available settings profiles.
      raw: fetchProjectSettingsData, // Low-level: fetch full raw settings blob.
    },

    remoteControl: {
      // Current RC configuration for this project.
      getSettings: fetchProjectRemoteControlSettings,
    },

    models: {
      listPaths: fetchProjectModelPaths, // Get paths to all model files.
      listDescriptors: fetchProjectModels, // Resolve full model descriptors.
    },
  },

  Context: {
    // React: stores the selected project and notifies components on change.
    Provider: ProjectProvider,
    use: useProjectContext, // "Which project is active right now?"
  },

  Hooks: {
    // "Convenience" hooks intended for UI-level components.

    useSettingsList: useProjectSettingsList, // Derived list + loading states.
    useModels: useProjectModels, // Derived model metadata for UI.
    useChangeConfirmation: useProjectChangeConfirmation,
    // Utility to show an "Are you sure?" dialog before switching projects.
  },
};

export const ProjectData = {
  // React provider + hooks for model/telemetry state.
  // This is the authoritative store for everything the UI knows about models,
  // descriptor lookup, RC modules, etc.

  Provider: LauncherDataProvider,
  use: useLauncherData,

  // Small utilities for async UI flows.
  waitForProjectModelsLoaded, // Promise resolves once model descriptors are ready.
  waitForModelDescriptorByName, // Promise resolves to a specific model descriptor.
  findModelDescriptorInState, // Synchronous lookup inside internal state.
  getProjectModelsStateSnapshot, // Return raw internal state for debugging/sync.
};

export const RemoteControl = {
  Types: {} as {
    // Type-only namespace. Used by UI editors and model inspectors.
    Module: RcModuleDescriptor; // Shape of one RC module (joystick/mixer/etc.)
    Settings: RcSettingsResponse; // Full RC config returned by backend.
  },
};

// ---------------------------------------------------------------------------
// Backwards-compatible named exports (legacy code still imports these directly)
// ---------------------------------------------------------------------------
export {
  ProjectProvider,
  useProjectContext,
  LauncherProvider,
  useLauncherContext,
  launcherEvents,
  LauncherDataProvider,
  useLauncherData,
  waitForProjectModelsLoaded,
  waitForModelDescriptorByName,
  findModelDescriptorInState,
  getProjectModelsStateSnapshot,
  useProjectSettingsList,
  useProjectModels,
  useProjectChangeConfirmation,
  fetchProjectSettingsData,
  fetchProjectRemoteControlSettings,
  requestLauncherRun,
  requestLauncherStop,
  fetchLauncherStatus,
  getLauncherLogStreamUrl,
  fetchProjectModelPaths,
  currentProject,
  listProjectPaths,
  getProjectSettings,
  fetchProjectSettingsList,
  fetchProjectModels,
};

export type {
  LauncherStatus,
  ProjectModelDescriptor,
  ProjectSettingsSummary,
  RcModuleDescriptor,
  RcSettingsResponse,
};
