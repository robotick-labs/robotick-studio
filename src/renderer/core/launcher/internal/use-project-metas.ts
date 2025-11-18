import { useLauncherData } from "./LauncherDataContext";

export function useProjectMetas(_pollIntervalMs = 5000) {
  const { projectMetas } = useLauncherData();
  return {
    projects: projectMetas.data,
    loading: projectMetas.loading,
    error: projectMetas.error,
  };
}
