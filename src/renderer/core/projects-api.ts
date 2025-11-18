import { HUB_API_BASE } from "./config";
import { buildUrl, fetchJSON } from "./http";

export type ProjectMeta = {
  path: string;
  name: string;
  description?: string;
};

type ProjectSettingsResponse = {
  name?: string;
  description?: string;
};

export async function fetchProjectPaths(): Promise<string[]> {
  const url = buildUrl(HUB_API_BASE, "/query/list-projects");
  return await fetchJSON<string[]>(url);
}

export async function fetchProjectSettings(
  projectPath: string
): Promise<ProjectSettingsResponse> {
  const url = buildUrl(HUB_API_BASE, "/query/get-project-settings", {
    project_path: projectPath,
  });
  return await fetchJSON<ProjectSettingsResponse>(url);
}

export async function fetchProjectMetas(): Promise<ProjectMeta[]> {
  const paths = await fetchProjectPaths();
  const metas = await Promise.all(
    paths.map(async (path) => {
      try {
        const settings = await fetchProjectSettings(path);
        return {
          path,
          name: settings.name?.trim() || path.split("/").pop() || path,
          description: settings.description?.trim(),
        };
      } catch (err) {
        console.warn("Failed to fetch project settings:", path, err);
        return null;
      }
    })
  );

  return metas
    .filter((meta): meta is ProjectMeta => Boolean(meta))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchProjectModels(
  projectPath: string
): Promise<string[]> {
  const url = buildUrl(HUB_API_BASE, "/query/list-project-models", {
    project_path: projectPath,
  });
  const models = await fetchJSON<string[]>(url);
  return models.sort();
}
