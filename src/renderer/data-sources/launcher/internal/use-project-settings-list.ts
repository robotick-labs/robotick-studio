import { useLauncherData } from "./LauncherDataContext";

/**
 * Convenience hook that exposes the list of project settings summaries returned
 * by the launcher REST API. Components can use this to populate project pickers.
 */
export function useProjectSettingsList(_pollIntervalMs = 5000) {
  const { projectSettings } = useLauncherData();
  return {
    projects: projectSettings.data,
    loading: projectSettings.loading,
    error: projectSettings.error,
  };
}
