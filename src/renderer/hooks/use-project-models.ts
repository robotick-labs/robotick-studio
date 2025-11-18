import { useLauncherData } from "../core/launcher/LauncherDataContext";

export function useProjectModels(
  _projectPath: string | null | undefined,
  _pollIntervalMs = 5000
) {
  const { projectModels } = useLauncherData();
  return {
    models: projectModels.data.map((descriptor) => descriptor.modelPath),
    loading: projectModels.loading,
    error: projectModels.error,
  };
}
