// src/js/pages/models/models.tsx  (editor bootstrap)
import { ModelStore } from "./document/documentStore";
import { loadAllModels } from "./document/modelData";
import { initNodeGraph } from "./view/node-graph/initNodeGraph";
import { initPropertyPanel } from "./view/properties/initPropertyPanel";

export async function init(): Promise<void> {
  const store = new ModelStore();

  // load general document-store (core models-data from json REST-API)
  const models = await loadAllModels();
  store.load(models);

  initPropertyPanel("#property-panel", store);

  initNodeGraph("#graph", store);
}
