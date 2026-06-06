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
  selected_target_project?: string | null;
};

type HubStudioProjectsResult = {
  projects: HubProjectSummary[];
  selectedTargetProject?: string;
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

function getSelectedProjectName(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const selectedProject = window.robotick?.environment?.selectedProject;
  return typeof selectedProject === "string" && selectedProject.trim().length > 0
    ? selectedProject.trim()
    : undefined;
}

function buildHubUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

async function fetchHubStudioProjects(): Promise<HubStudioProjectsResult | null> {
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
  return {
    projects: Array.isArray(payload.projects) ? payload.projects : [],
    selectedTargetProject:
      payload.selected_target_project?.trim() || getSelectedProjectName(),
  };
}

function sortProjectSummaries(
  summaries: ProjectSettingsSummary[],
  selectedTargetProject?: string,
): ProjectSettingsSummary[] {
  const selectedName = selectedTargetProject?.trim();
  return [...summaries].sort((a, b) => {
    if (selectedName) {
      const aSelected = a.name === selectedName || a.path.includes(`/${selectedName}/`);
      const bSelected = b.name === selectedName || b.path.includes(`/${selectedName}/`);
      if (aSelected !== bSelected) {
        return aSelected ? -1 : 1;
      }
    }
    return a.name.localeCompare(b.name);
  });
}

export async function listProjectPaths(): Promise<string[]> {
  const hubResult = await fetchHubStudioProjects().catch(() => null);
  if (hubResult) {
    return hubResult.projects
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
  const hubResult = await fetchHubStudioProjects().catch(() => null);
  if (hubResult) {
    const summaries: ProjectSettingsSummary[] = [];
    for (const project of hubResult.projects) {
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
    return sortProjectSummaries(summaries, hubResult.selectedTargetProject);
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
