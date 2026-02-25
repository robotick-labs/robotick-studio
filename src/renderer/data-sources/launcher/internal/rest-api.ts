import {
  fetchProjectSettingsData,
  fetchProjectRemoteControlSettings,
  requestLauncherRun,
  requestLauncherStop,
  fetchLauncherStatus,
  getLauncherLogStreamUrl,
  fetchProjectModelPaths,
} from "./launcher-interface";

import {
  listProjectPaths,
  getProjectSettings,
  fetchProjectSettingsList,
  fetchProjectModels,
} from "./projects-api";

export const LauncherRest = {
  run: requestLauncherRun,
  stop: requestLauncherStop,
  status: fetchLauncherStatus,
  logsStreamUrl: getLauncherLogStreamUrl,
  fetchProjectRemoteControlSettings,
  fetchProjectSettingsData,
} as const;

export const ProjectRest = {
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
} as const;
