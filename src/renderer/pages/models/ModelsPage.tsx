import React, { useEffect } from "react";
import { useProjectContext } from "../../core/ProjectContext";

import { DocumentStore } from "./document/documentStore";
import {
  initNodeGraph,
  type NodeGraphAPI,
} from "./view/node-graph/initNodeGraph";
import {
  initPropertyPanel,
  type PropertyPanelAPI,
} from "./view/properties/InitPropertyPanel";

export default function ModelsPage() {
  const { projectPath } = useProjectContext();

  useEffect(() => {
    let disposed = false;
    let graphApi: NodeGraphAPI | null = null;
    let panelApi: PropertyPanelAPI | null = null;
    const store = new DocumentStore();

    async function start() {
      if (!projectPath) {
        resetDom();
        return;
      }

      try {
        await store.load(projectPath);
        if (disposed) return;

        graphApi = initNodeGraph("#graph", store);
        panelApi = initPropertyPanel("#property-panel", store);
      } catch (err) {
        if (!disposed) {
          console.warn("Failed to initialise models page", err);
        }
      }
    }

    start();

    return () => {
      disposed = true;
      graphApi?.dispose();
      panelApi?.dispose?.();
      resetDom();
    };
  }, [projectPath]);

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

function resetDom() {
  const svg = document.getElementById("graph");
  if (svg) {
    svg.innerHTML = "<defs></defs>";
  }
  const panel = document.getElementById("property-panel");
  if (panel) {
    panel.innerHTML = "";
  }
}
