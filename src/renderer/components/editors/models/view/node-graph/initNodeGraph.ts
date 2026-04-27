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
  /** Update read-only graph display behavior */
  setDisplayOptions: (options: Partial<GraphDisplayOptions>) => void;
};

export type EdgeVisibilityMode =
  | "none"
  | "selected-node"
  | "selected-model"
  | "expanded-models"
  | "all";

export type GraphDisplayOptions = {
  edgeVisibilityMode: EdgeVisibilityMode;
  focusDimming: boolean;
  expandedModelIds: string[];
};

const DEFAULT_DISPLAY_OPTIONS: GraphDisplayOptions = {
  edgeVisibilityMode: "selected-model",
  focusDimming: true,
  expandedModelIds: [],
};

export function initNodeGraph(
  svgElement: SVGSVGElement | null,
  store: DocumentStore,
  initialDisplayOptions?: Partial<GraphDisplayOptions>
): NodeGraphAPI {
  if (!svgElement) {
    throw new Error("initNodeGraph requires an SVGSVGElement");
  }

  // Keep the graph's state local to this instance
  const doc = new GraphDoc();

  // Initial build (so we know sizes before first paint)
  buildGraphDocFromModel(store, doc);

  const layers = createSvgLayers(svgElement);

  const router = new RectilinearRouter();
  const view = new SvgView(svgElement, layers, router);
  const selectionController = new SelectionController(svgElement);
  const slotDragController = new SlotDragController(svgElement, doc, store);
  let selectedNodeId: string | null = null;
  let displayOptions: GraphDisplayOptions = {
    ...DEFAULT_DISPLAY_OPTIONS,
    ...initialDisplayOptions,
  };

  const render = () => {
    view.render(doc, {
      selectedNodeId,
      edgeVisibilityMode: displayOptions.edgeVisibilityMode,
      focusDimming: displayOptions.focusDimming,
      expandedModelIds: displayOptions.expandedModelIds,
    });
  };

  const attachControllers = () => {
    selectionController.attach();
    slotDragController.attachAll();
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
  const selectionChangedHandler = (e: Event) => {
    const ce = e as CustomEvent<{ nodeId?: string | null }>;
    selectedNodeId = ce.detail?.nodeId ?? null;
    render();
  };
  window.addEventListener(
    "models-graph:selection-changed",
    selectionChangedHandler as EventListener
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
    window.removeEventListener(
      "models-graph:selection-changed",
      selectionChangedHandler as EventListener
    );
    selectionController.detach();
    slotDragController.detach();
  };

  const getDoc = () => doc;
  const setDisplayOptions = (options: Partial<GraphDisplayOptions>) => {
    displayOptions = { ...displayOptions, ...options };
    render();
  };

  return {
    svg: svgElement,
    view,
    render,
    attachControllers,
    refreshLayout,
    dispose,
    getDoc,
    setDisplayOptions,
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
