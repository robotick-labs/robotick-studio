import { ProjectProvider, useProjectContext } from "./ProjectContext";
import {
  LauncherProvider,
  useLauncherContext,
  launcherEvents,
} from "./LauncherContext";
import {
  LauncherDataProvider,
  useLauncherData,
  waitForProjectModelsLoaded,
  waitForModelDescriptorByName,
  findModelDescriptorInState,
  getProjectModelsStateSnapshot,
} from "./LauncherDataContext";
import { useProjectSettingsList } from "./use-project-settings-list";
import { useProjectModels } from "./use-project-models";
import { useProjectChangeConfirmation } from "./use-project-change-confirmation";
import { useProjectLockStatuses } from "./use-project-lock-statuses";

export const ProjectReact = {
  Provider: ProjectProvider,
  use: useProjectContext,
};

export const LauncherReact = {
  Provider: LauncherProvider,
  use: useLauncherContext,
  events: launcherEvents,
};

export const ProjectDataReact = {
  Provider: LauncherDataProvider,
  use: useLauncherData,
  waitForProjectModelsLoaded,
  waitForModelDescriptorByName,
  findModelDescriptorInState,
  getProjectModelsStateSnapshot,
};

export const ProjectReactHooks = {
  useSettingsList: useProjectSettingsList,
  useModels: useProjectModels,
  useChangeConfirmation: useProjectChangeConfirmation,
  useLockStatuses: useProjectLockStatuses,
};

export type { LauncherStatus } from "./LauncherContext";
export type {
  ProjectLockStatus,
  ProjectModelDescriptor,
} from "./launcher-interface";
export type { ProjectSettingsSummary } from "./projects-api";
