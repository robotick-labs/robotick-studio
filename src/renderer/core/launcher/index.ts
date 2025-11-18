/**
 * Public launcher API surface.
 *
 * Components should import providers, hooks, and launcher utilities from this
 * module instead of touching files under `internal/`. Anything not exported
 * here is considered implementation detail.
 */

// Project selection + profile context.
export {
  ProjectProvider,
  useProjectContext,
} from "./internal/ProjectContext";

// Launcher status, run/stop controls, and related events.
export {
  LauncherProvider,
  useLauncherContext,
  launcherEvents,
} from "./internal/LauncherContext";
export type { LauncherStatus } from "./internal/LauncherContext";

// Launcher data (projects, models, RC modules) + helpers for telemetry lookup.
export {
  LauncherDataProvider,
  useLauncherData,
  waitForProjectModelsLoaded,
  waitForModelDescriptorByName,
  findModelDescriptorInState,
  getProjectModelsStateSnapshot,
} from "./internal/LauncherDataContext";

// Project/model convenience hooks for UI.
export { useProjectMetas } from "./internal/use-project-metas";
export { useProjectModels } from "./internal/use-project-models";
export { useProjectChangeConfirmation } from "./internal/use-project-change-confirmation";

// REST helpers that UI code occasionally needs (project settings, launcher logs, etc.).
export {
  fetchProjectSettingsData,
  fetchProjectRemoteControlSettings,
  requestLauncherRun,
  requestLauncherStop,
  fetchLauncherStatus,
  getLauncherLogStreamUrl,
  fetchProjectModelPaths,
} from "./internal/launcher-interface";
export type { ProjectModelDescriptor } from "./internal/launcher-interface";
export { default as currentProject } from "./internal/launcher-interface";

// Project metadata helpers (launcher "projects" REST).
export {
  fetchProjectMetas,
  fetchProjectPaths,
} from "./internal/projects-api";
export type { ProjectMeta } from "./internal/projects-api";

// Remote-control module descriptors.
export type {
  RcModuleDescriptor,
  RcSettingsResponse,
} from "./internal/remote-control-types";
