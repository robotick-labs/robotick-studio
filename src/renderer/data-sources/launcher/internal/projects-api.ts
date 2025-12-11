import {
  fetchProjectModelPaths,
  fetchProjectPaths as fetchLauncherProjectPaths,
  fetchProjectSettingsData,
} from "./launcher-interface";

export type ProjectSettingsSummary = {
  path: string;
  name: string;
  description?: string;
};

type ProjectSettingsResponse = {
  name?: string;
  description?: string;
};

export async function listProjectPaths(): Promise<string[]> {
  return await fetchLauncherProjectPaths();
}

export async function getProjectSettings(
  projectPath: string
): Promise<ProjectSettingsResponse> {
  return await fetchProjectSettingsData<ProjectSettingsResponse>(projectPath);
}

export async function fetchProjectSettingsList(): Promise<ProjectSettingsSummary[]> {
  const paths = await listProjectPaths();
  const metas = await Promise.all(
    paths.map(async (path) => {
      try {
        const settings = await getProjectSettings(path);
        const summary: ProjectSettingsSummary = {
          path,
          name: settings.name?.trim() || path.split("/").pop() || path,
          description: settings.description?.trim(),
        };
        return summary;
      } catch (err) {
        console.warn("Failed to fetch project settings:", path, err);
        return null;
      }
    })
  );

  const validSummaries = metas.filter(
    (meta): meta is ProjectSettingsSummary => meta !== null
  );

  return validSummaries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchProjectModels(
  projectPath: string
): Promise<string[]> {
  return await fetchProjectModelPaths(projectPath);
}
