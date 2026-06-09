import {
  createEmptyStudioPersistenceModel,
  hasStudioDocument,
  loadStudioDocument,
} from "./resources";
import type { StudioPersistenceStore } from "./store";
import type { StudioPersistenceLoadResult } from "./types";

export async function loadStudioPersistence(
  projectPath: string,
  store: StudioPersistenceStore
): Promise<StudioPersistenceLoadResult> {
  const document = await loadStudioDocument(projectPath, store);
  if (hasStudioDocument(document)) {
    return { source: "canonical", model: document };
  }
  return {
    source: "empty",
    model: createEmptyStudioPersistenceModel(projectPath),
  };
}
