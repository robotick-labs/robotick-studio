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

type HubProjectSummary = {
  name: string;
  project_dir: string;
  project_path?: string | null;
  display_name?: string | null;
  description?: string | null;
};

type HubStudioProjectsResponse = {
  projects?: HubProjectSummary[];
};

function getHubEndpoint(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const endpoint = window.robotick?.environment?.hubEndpoint;
  return typeof endpoint === "string" && endpoint.trim().length > 0
    ? endpoint.trim()
    : null;
}

function buildHubUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

async function fetchHubStudioProjects(): Promise<HubProjectSummary[] | null> {
  const hubEndpoint = getHubEndpoint();
  if (!hubEndpoint) {
    return null;
  }
  const response = await fetch(buildHubUrl(hubEndpoint, "/v1/studio/projects"));
  if (!response.ok) {
    throw new Error(
      `Hub project discovery failed ${response.status} ${response.statusText}`
    );
  }
  const payload = (await response.json()) as HubStudioProjectsResponse;
  return Array.isArray(payload.projects) ? payload.projects : [];
}

export async function listProjectPaths(): Promise<string[]> {
  const hubProjects = await fetchHubStudioProjects().catch(() => null);
  if (hubProjects) {
    return hubProjects
      .map((project) => project.project_path?.trim() || "")
      .filter((path) => path.length > 0)
      .sort();
  }
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
  const hubProjects = await fetchHubStudioProjects().catch(() => null);
  if (hubProjects) {
    const summaries: ProjectSettingsSummary[] = [];
    for (const project of hubProjects) {
      const path = project.project_path?.trim() || "";
      if (!path) {
        continue;
      }
      summaries.push({
          path,
          name:
            project.display_name?.trim() ||
            project.name?.trim() ||
            path.split("/").pop() ||
            path,
          description: project.description?.trim() || undefined,
      });
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

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
