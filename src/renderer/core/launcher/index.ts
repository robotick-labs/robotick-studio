import {
  ProjectProvider,
  useProjectContext,
} from "./internal/ProjectContext";
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
import {
  useProjectSettingsList,
} from "./internal/use-project-settings-list";
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
 * Use the grouped objects below to quickly discover the surface you need.
 * Everything else inside `internal/` is considered private.
 */
export const Launcher = {
  /** Imperative REST actions that the Python launcher understands. */
  Service: {
    run: requestLauncherRun,
    stop: requestLauncherStop,
    status: fetchLauncherStatus,
    logs: {
      streamUrl: getLauncherLogStreamUrl,
    },
  },
  /** React state + events for launcher status. */
  Context: {
    Provider: LauncherProvider,
    use: useLauncherContext,
    events: launcherEvents,
  },
};

export const Project = {
  /** REST helpers for querying project paths/settings/models. */
  Service: {
    listPaths: listProjectPaths,
    settings: {
      get: getProjectSettings,
      list: fetchProjectSettingsList,
      raw: fetchProjectSettingsData,
    },
    remoteControl: {
      getSettings: fetchProjectRemoteControlSettings,
    },
    models: {
      listPaths: fetchProjectModelPaths,
      listDescriptors: fetchProjectModels,
    },
    current: currentProject,
  },
  /** React glue for current-project state. */
  Context: {
    Provider: ProjectProvider,
    use: useProjectContext,
  },
  /** Hooks that help UI surfaces consume project data. */
  Hooks: {
    useSettingsList: useProjectSettingsList,
    useModels: useProjectModels,
    useChangeConfirmation: useProjectChangeConfirmation,
  },
};

export const ProjectData = {
  /**
   * Provider/hook helpers for project model descriptors and RC modules.
   * Also exposes telemetry lookup utilities.
   */
  Provider: LauncherDataProvider,
  use: useLauncherData,
  waitForProjectModelsLoaded,
  waitForModelDescriptorByName,
  findModelDescriptorInState,
  getProjectModelsStateSnapshot,
};

export const RemoteControl = {
  /**
   * Type aliases used when building RC editors/config UIs.
   * (Import the actual TypeScript types via `import type { RcModuleDescriptor }`.)
   */
  Types: {
    Module: null as unknown as RcModuleDescriptor,
    Settings: null as unknown as RcSettingsResponse,
  },
};

// Re-export types for convenience.
export type {
  LauncherStatus,
  ProjectModelDescriptor,
  ProjectSettingsSummary,
  RcModuleDescriptor,
  RcSettingsResponse,
};
