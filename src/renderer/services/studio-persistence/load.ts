import {
  EMPTY_STUDIO_PERSISTENCE_MODEL,
  hasStudioResourceFiles,
  loadStudioResourceFiles,
  writeStudioResourceFiles,
} from "./resources";
import { migrateLegacyStorageToStudioResources } from "./scaffolding/legacy-migration";
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

  const legacy = await store.readLegacyRendererStorage(projectPath);
  if (!legacy) {
    return { source: "empty", model: EMPTY_STUDIO_PERSISTENCE_MODEL };
  }

  const migrated = migrateLegacyStorageToStudioResources(legacy, {
    projectPath,
  });
  if (!hasStudioResourceFiles(migrated)) {
    return { source: "empty", model: EMPTY_STUDIO_PERSISTENCE_MODEL };
  }

  await writeStudioResourceFiles(projectPath, store, migrated);
  return { source: "legacy", model: migrated };
}
