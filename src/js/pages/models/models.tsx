// src/js/pages/models/models.tsx  (editor bootstrap)
import { GraphDoc } from "./view/node-graph/editorNodeGraph";
import { ModelStore } from "./document/documentStore";
import { loadAllModels } from "./services/projectModelsLoader";
import { initNodeGraph } from "./view/node-graph/initNodeGraph";
import { initPropertyPanel } from "./view/properties/initPropertyPanel";
import { buildGraphDocFromModel } from "./view/node-graph/layout/project";

export async function init(): Promise<void> {
  const doc = new GraphDoc();
  const store = new ModelStore();

  const models = await loadAllModels();
  store.load(models);
  buildGraphDocFromModel(store, doc);

  initPropertyPanel("#property-panel", store);
  const graph = initNodeGraph("#graph", doc, store);

  // initial render and controllers are handled by initNodeGraph + panel React subscription
  graph.render();
  graph.attachControllers();
}
