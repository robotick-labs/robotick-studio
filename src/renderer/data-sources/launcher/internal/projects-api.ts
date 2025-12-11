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

/**
 * Build a list of project settings summaries for all discovered project paths.
 *
 * For each project path, attempts to load its settings and produce a ProjectSettingsSummary;
 * projects whose settings fail to load are omitted from the result. The returned list is
 * sorted by the summary `name` using locale-aware comparison.
 *
 * @returns An array of ProjectSettingsSummary objects sorted by `name`.
 */
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
    (meta): meta is ProjectSettingsSummary => meta != null
  );

  return validSummaries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetches model file paths for the given project.
 *
 * @param projectPath - The path of the project whose model paths should be retrieved
 * @returns An array of model file paths for the specified project
 */
export async function fetchProjectModels(
  projectPath: string
): Promise<string[]> {
  return await fetchProjectModelPaths(projectPath);
}