import type { ProjectMeta } from "./projects-api";

const PROJECT_METAS_CACHE_KEY = "robotick-hub.cache.projectMetas";

export function loadCachedProjectMetas(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(PROJECT_METAS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ProjectMeta =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as ProjectMeta).path === "string"
    );
  } catch {
    return [];
  }
}

export function saveCachedProjectMetas(metas: ProjectMeta[]): void {
  try {
    localStorage.setItem(PROJECT_METAS_CACHE_KEY, JSON.stringify(metas));
  } catch {
    /* ignore */
  }
}
