import React, { useEffect, useRef } from "react";
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
import styles from "./styles/ModelsPage.module.css";

export default function ModelsPage() {
  const { projectPath } = useProjectContext();
  const graphRef = useRef<SVGSVGElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const graphEl = graphRef.current;
    const panelEl = panelRef.current;
    if (!graphEl || !panelEl) {
      return;
    }

    let disposed = false;
    let graphApi: NodeGraphAPI | null = null;
    let panelApi: PropertyPanelAPI | null = null;
    const store = new DocumentStore();

    async function start() {
      if (!projectPath) {
        resetDom(graphEl, panelEl);
        return;
      }

      try {
        await store.load(projectPath);
        if (disposed) return;

        graphApi = initNodeGraph(graphEl, store);
        panelApi = initPropertyPanel(panelEl, store);
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
      resetDom(graphEl, panelEl);
    };
  }, [projectPath]);

  return (
    <div className={styles.layout}>
      <div className={styles.mainPanel}>
        <div className={styles.graphPanel}>
          <svg ref={graphRef} className={styles.graph}>
            <defs />
          </svg>
        </div>
      </div>
      <div className={styles.propertyPanel} ref={panelRef} />
    </div>
  );
}

function resetDom(
  graphEl?: SVGSVGElement | null,
  panelEl?: HTMLElement | null
) {
  if (graphEl) {
    graphEl.innerHTML = "<defs></defs>";
  }
  if (panelEl) {
    panelEl.innerHTML = "";
  }
}
