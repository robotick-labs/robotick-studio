// src/js/pages/models/models.tsx  (your main editor entry stays here)

import { GraphDoc } from "./view/node-graph/editorNodeGraph";
import { ModelStore } from "./document/documentStore";
import { loadAllModels } from "./services/projectModelsLoader";

import { initNodeGraph } from "./view/node-graph/initNodeGraph";
import { initPropertyPanel } from "./view/properties/initPropertyPanel";
import { buildGraphDocFromModel } from "./view/node-graph/layout/project";

export async function init(): Promise<void> {
  // Core doc + store
  const doc = new GraphDoc();
  const store = new ModelStore();

  // Init views
  const graph = initNodeGraph("#graph", doc, store);
  const panel = initPropertyPanel("#property-panel", doc);

  // Initial data load
  const models = await loadAllModels();
  store.load(models);
  buildGraphDocFromModel(store, doc);

  // First paint
  graph.render();
  panel.render();

  // Controllers (node-graph centric)
  graph.attachControllers();

  // Event plumbing
  const renderAll = () => {
    buildGraphDocFromModel(store, doc);
    graph.render();
    panel.render();
  };

  window.addEventListener("models-graph:store-updated", renderAll);

  window.addEventListener("models-graph:plus-click", (e: any) => {
    const { sectionIndex, laneIndex } = e.detail;
    const section = doc.sections[sectionIndex];
    const modelId = section.modelId;

    const nextName = suggestName(store, modelId, "new_workload_");
    store.insertAt(modelId, laneIndex, section.maxNodes, {
      name: nextName,
      type: "TemplateWorkload",
    });

    renderAll();
  });

  window.addEventListener("models-graph:selection-changed", () =>
    panel.render()
  );

  window.addEventListener("models-graph:rename-requested", (e: any) => {
    const { nodeId, newName } = e.detail;
    const n = doc.getNode(nodeId);
    if (!n) return;
    const modelId = n.meta?.modelId!;
    store.rename(modelId, n.label, newName);
    renderAll();
  });
}

function suggestName(store: ModelStore, modelId: string, base: string): string {
  let i = 1;
  const m = store.get(modelId)!;
  const exists = (name: string) => m.workloads.some((w) => w.name === name);
  while (exists(`${base}${i}`)) i++;
  return `${base}${i}`;
}
