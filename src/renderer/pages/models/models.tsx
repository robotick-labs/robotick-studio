// src/js/pages/models/models.tsx  (editor bootstrap)
import { DocumentStore } from "./document/documentStore";
import { initNodeGraph } from "./view/node-graph/initNodeGraph";
import { initPropertyPanel } from "./view/properties/initPropertyPanel";

export async function init(): Promise<void> {
  const store = new DocumentStore();

  // load general document-store (core models-data from json REST-API)
  await store.load();

  initPropertyPanel("#property-panel", store);

  initNodeGraph("#graph", store);
}
