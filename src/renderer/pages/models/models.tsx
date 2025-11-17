import React, { useEffect } from "react";

import { DocumentStore } from "./document/documentStore";
import { initNodeGraph } from "./view/node-graph/initNodeGraph";
import { initPropertyPanel } from "./view/properties/initPropertyPanel";

export default function ModelsPage() {
  useEffect(() => {
    async function start() {
      const store = new DocumentStore();
      await store.load();

      // IMPORTANT: The selectors (#graph, #property-panel)
      // must match the DOM we render below.
      initNodeGraph("#graph", store);
      initPropertyPanel("#property-panel", store);
    }

    start();
  }, []);

  return (
    <div id="layout">
      <div id="main-panel">
        <div id="graph-panel">
          <svg id="graph">
            <defs></defs>
          </svg>
        </div>
      </div>
      <div id="property-panel"></div>
    </div>
  );
}
