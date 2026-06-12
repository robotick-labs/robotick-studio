import {
  fetchProjectSettingsData,
  fetchProjectRemoteControlSettings,
  requestLauncherRun,
  requestLauncherRunModel,
  requestLauncherStop,
  requestLauncherStopModel,
  fetchLauncherStatus,
  getLauncherLogStreamUrl,
  fetchLauncherLogSnapshot,
  requestLauncherLogClear,
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
  runModel: requestLauncherRunModel,
  stop: requestLauncherStop,
  stopModel: requestLauncherStopModel,
  status: fetchLauncherStatus,
  logsStreamUrl: getLauncherLogStreamUrl,
  logsSnapshot: fetchLauncherLogSnapshot,
  logsClear: requestLauncherLogClear,
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
