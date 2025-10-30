// src/js/pages/models/view/node-graph/initNodeGraph.ts
import { GraphDoc } from "./layout/editorNodeGraph";
import { createSvgLayers, SvgView } from "./render/svgView";
import { RectilinearRouter } from "./routing/rectilinearRouter";
import { DocumentStore } from "../../document/documentStore";
import { buildGraphDocFromModel } from "./layout/buildGraphDocFromModel";
import { SlotDragController } from "../../controllers/slotDragController";
import { SelectionController } from "../../controllers/selectionController";

export const nodeSize = { width: 140, height: 40 } as const;
export const marginX = 20;
export const spacing = 180;

export type NodeGraphAPI = {
  svg: SVGSVGElement;
  view: SvgView;
  /** Recompute layout + render SVG */
  render: () => void;
  /** Attach graph controllers (selection, drag) */
  attachControllers: () => void;
  /** Force layout rebuild (use after structural edits) */
  refreshLayout: () => void;
  /** Stop listening to store/events and detach anything we hooked */
  dispose: () => void;
  /** Access the live graph document (read-only usage preferred) */
  getDoc: () => GraphDoc;
};

export function initNodeGraph(
  svgSelector: string,
  store: DocumentStore
): NodeGraphAPI {
  const svgEl = document.querySelector(svgSelector);
  if (!svgEl || !(svgEl instanceof SVGSVGElement)) {
    throw new Error(`${svgSelector} not found or not an SVGSVGElement`);
  }

  // Keep the graph's state local to this instance
  const doc = new GraphDoc();

  // Initial build (so we know sizes before first paint)
  buildGraphDocFromModel(store, doc);

  const layers = createSvgLayers(svgEl);

  const router = new RectilinearRouter();
  const view = new SvgView(svgEl, layers, router);

  const render = () => {
    view.render(doc);
  };

  const attachControllers = () => {
    new SelectionController(svgEl).attach();
    new SlotDragController(svgEl, doc, view, store).attachAll();
  };

  // ——— Store subscription (render on any store mutation) ———
  const unsubscribeStore = store.subscribe(render);

  // ——— Graph-specific events (kept local to this module) ———
  const plusClickHandler = (e: Event) => {
    const ce = e as CustomEvent<{ sectionIndex: number; laneIndex: number }>;
    const { sectionIndex, laneIndex } = ce.detail;
    const section = doc.sections[sectionIndex];
    const modelId = section.modelId;
    const nextName = suggestName(store, modelId, "NewWorkload");
    store.insertAt(modelId, laneIndex, section.maxNodes, {
      name: nextName,
      type: "TemplateWorkload",
    });
    // No manual render: store.subscribe(render) will handle it.
  };

  const renameHandler = (e: Event) => {
    const ce = e as CustomEvent<{ nodeId: string; newName: string }>;
    const { nodeId, newName } = ce.detail;
    const n = doc.getNode(nodeId);
    if (!n) return;
    const modelId = n.meta?.modelId!;
    store.rename(modelId, n.label, newName);
    // No manual render: handled by store subscription
  };

  window.addEventListener(
    "models-graph:plus-click",
    plusClickHandler as EventListener
  );
  window.addEventListener(
    "models-graph:rename-requested",
    renameHandler as EventListener
  );

  // First paint + attach controllers (idempotent if caller repeats)
  render();
  attachControllers();

  const refreshLayout = () => {
    buildGraphDocFromModel(store, doc);
    render();
  };

  const dispose = () => {
    // Clean up all listeners we installed
    unsubscribeStore?.();
    window.removeEventListener(
      "models-graph:plus-click",
      plusClickHandler as EventListener
    );
    window.removeEventListener(
      "models-graph:rename-requested",
      renameHandler as EventListener
    );
    // If you later add controller-level detach(), call them here.
  };

  const getDoc = () => doc;

  return {
    svg: svgEl,
    view,
    render,
    attachControllers,
    refreshLayout,
    dispose,
    getDoc,
  };
}

function suggestName(
  store: DocumentStore,
  modelId: string,
  base: string
): string {
  let i = 1;
  const m = store.get(modelId)!;
  const exists = (name: string) => m.workloads.some((w) => w.name === name);
  while (exists(`${base}${i}`)) i++;
  return `${base}${i}`;
}
