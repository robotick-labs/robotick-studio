import {
  EMPTY_STUDIO_PERSISTENCE_MODEL,
  hasStudioResourceFiles,
  loadStudioResourceFiles,
} from "./resources";
import type { StudioPersistenceStore } from "./store";
import type { StudioPersistenceLoadResult } from "./types";

export async function loadStudioPersistence(
  projectPath: string,
  store: StudioPersistenceStore
): Promise<StudioPersistenceLoadResult> {
  const resources = await loadStudioResourceFiles(projectPath, store);
  if (hasStudioResourceFiles(resources)) {
    return { source: "canonical", model: resources };
  }
  return { source: "empty", model: EMPTY_STUDIO_PERSISTENCE_MODEL };
}
