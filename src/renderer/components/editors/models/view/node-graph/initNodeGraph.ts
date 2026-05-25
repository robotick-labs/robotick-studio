import { GraphDoc } from "./layout/editorNodeGraph";
import { createSvgLayers, SvgView } from "./render/svgView";
import { RectilinearRouter } from "./routing/rectilinearRouter";
import { DocumentStore } from "../../document/documentStore";
import {
  buildGraphDocFromModel,
  type ModelSortKey,
} from "./layout/buildGraphDocFromModel";
export type {
  ModelSortKey,
} from "./layout/buildGraphDocFromModel";
import { SlotDragController } from "../../controllers/slotDragController";
import { SelectionController } from "../../controllers/selectionController";
import type {
  EdgeVisibilityMode,
  RemoteConnectionVisibility,
} from "./render/graphDisplayState";
export type {
  EdgeVisibilityMode,
  RemoteConnectionVisibility,
} from "./render/graphDisplayState";

export const nodeSize = { width: 168, height: 40 } as const;
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
  refreshLayout: () => Promise<void>;
  /** Stop listening to store/events and detach anything we hooked */
  dispose: () => void;
  /** Access the live graph document (read-only usage preferred) */
  getDoc: () => GraphDoc;
  /** Update read-only graph display behavior */
  setDisplayOptions: (options: Partial<GraphDisplayOptions>) => void;
  /** Replace the collapsed model set used by the layout */
  setCollapsedModelIds: (modelIds: string[]) => void;
  /** Read current selected node id */
  getSelectedNodeId: () => string | null;
  /** Set selected node id and re-render */
  setSelectedNodeId: (nodeId: string | null) => void;
  /** Replace model ordering and refresh layout */
  setModelSortKey: (sortKey: ModelSortKey) => void;
};

export type GraphDisplayOptions = {
  edgeVisibilityMode: EdgeVisibilityMode;
  remoteConnectionVisibility: RemoteConnectionVisibility;
  focusDimming: boolean;
  expandedModelIds: string[];
};

export type GraphLayoutOptions = {
  collapsedModelIds: string[];
  modelSortKey: ModelSortKey;
};

const DEFAULT_DISPLAY_OPTIONS: GraphDisplayOptions = {
  edgeVisibilityMode: "selected-model",
  remoteConnectionVisibility: "hidden",
  focusDimming: true,
  expandedModelIds: [],
};

export function initNodeGraph(
  svgElement: SVGSVGElement | null,
  store: DocumentStore,
  initialDisplayOptions?: Partial<GraphDisplayOptions>,
  initialLayoutOptions?: Partial<GraphLayoutOptions>,
  options?: {
    selectionScope?: string;
    initialSelectedNodeId?: string | null;
    onSelectedNodeIdChange?: (nodeId: string | null) => void;
    onToggleCollapsedModel?: (modelId: string) => void;
  },
): NodeGraphAPI {
  if (!svgElement) {
    throw new Error("initNodeGraph requires an SVGSVGElement");
  }

  // Keep the graph's state local to this instance
  const doc = new GraphDoc();

  let layoutOptions: GraphLayoutOptions = {
    collapsedModelIds: initialLayoutOptions?.collapsedModelIds ?? [],
    modelSortKey: initialLayoutOptions?.modelSortKey ?? "model_path",
  };

  const layers = createSvgLayers(svgElement);

  const router = new RectilinearRouter();
  const selectionScope = options?.selectionScope ?? "default";
  const view = new SvgView(svgElement, layers, router, selectionScope);
  const selectionController = new SelectionController(
    svgElement,
    {
      onSelectNode: (nodeId) => {
        selectedNodeId = nodeId;
        options?.onSelectedNodeIdChange?.(nodeId);
        renderSelectionState();
      },
      onToggleCollapsedModel: (modelId) => {
        options?.onToggleCollapsedModel?.(modelId);
      },
    },
  );
  const slotDragController = new SlotDragController(svgElement, doc, store);
  let selectedNodeId: string | null = options?.initialSelectedNodeId ?? null;
  let displayOptions: GraphDisplayOptions = {
    ...DEFAULT_DISPLAY_OPTIONS,
    ...initialDisplayOptions,
  };

  const render = () => {
    view.render(doc, {
      selectedNodeId,
      edgeVisibilityMode: displayOptions.edgeVisibilityMode,
      remoteConnectionVisibility: displayOptions.remoteConnectionVisibility,
      focusDimming: displayOptions.focusDimming,
      expandedModelIds: displayOptions.expandedModelIds,
    });
  };

  const renderSelectionState = () => {
    view.updateSelectionState(doc, {
      selectedNodeId,
      edgeVisibilityMode: displayOptions.edgeVisibilityMode,
      remoteConnectionVisibility: displayOptions.remoteConnectionVisibility,
      focusDimming: displayOptions.focusDimming,
      expandedModelIds: displayOptions.expandedModelIds,
    });
  };

  const attachControllers = () => {
    selectionController.attach();
    slotDragController.attachAll();
  };

  let refreshCounter = 0;
  const refreshLayout = async (): Promise<void> => {
    const refreshId = ++refreshCounter;
    const nextDoc = new GraphDoc();
    await buildGraphDocFromModel(store, nextDoc, {
      collapsedModelIds: layoutOptions.collapsedModelIds,
      modelSortKey: layoutOptions.modelSortKey,
    });
    if (refreshId !== refreshCounter) {
      return;
    }
    replaceGraphDoc(doc, nextDoc);
    render();
  };

  // ——— Store subscription (relayout + render on any store mutation) ———
  const unsubscribeStore = store.subscribe(() => {
    void refreshLayout();
  });

  // ——— Graph-specific events (kept local to this module) ———
  const plusClickHandler = (e: Event) => {
    const ce = e as CustomEvent<{
      sectionIndex: number;
      laneIndex: number;
      scope?: string;
    }>;
    if ((ce.detail?.scope ?? "default") !== selectionScope) {
      return;
    }
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
    const ce = e as CustomEvent<{
      nodeId: string;
      newName: string;
      scope?: string;
    }>;
    if ((ce.detail?.scope ?? "default") !== selectionScope) {
      return;
    }
    const { nodeId, newName } = ce.detail;
    const n = doc.getNode(nodeId);
    if (!n) return;
    const modelId = n.meta?.modelId!;
    store.rename(modelId, n.label, newName);
    // No manual render: handled by store subscription
  };

  svgElement.addEventListener(
    "models-graph:plus-click",
    plusClickHandler as EventListener,
  );
  svgElement.addEventListener(
    "models-graph:rename-requested",
    renameHandler as EventListener,
  );
  // First paint + attach controllers (idempotent if caller repeats)
  void refreshLayout();
  attachControllers();

  const dispose = () => {
    // Clean up all listeners we installed
    unsubscribeStore?.();
    svgElement.removeEventListener(
      "models-graph:plus-click",
      plusClickHandler as EventListener,
    );
    svgElement.removeEventListener(
      "models-graph:rename-requested",
      renameHandler as EventListener,
    );
    selectionController.detach();
    slotDragController.detach();
  };

  const getDoc = () => doc;
  const setDisplayOptions = (options: Partial<GraphDisplayOptions>) => {
    displayOptions = { ...displayOptions, ...options };
    render();
  };
  const setCollapsedModelIds = (modelIds: string[]) => {
    layoutOptions = { ...layoutOptions, collapsedModelIds: [...modelIds] };
    void refreshLayout();
  };
  const getSelectedNodeId = () => selectedNodeId;
  const setSelectedNodeId = (nodeId: string | null) => {
    selectedNodeId = nodeId;
    options?.onSelectedNodeIdChange?.(nodeId);
    renderSelectionState();
  };
  const setModelSortKey = (sortKey: ModelSortKey) => {
    layoutOptions = { ...layoutOptions, modelSortKey: sortKey };
    void refreshLayout();
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
    setCollapsedModelIds,
    getSelectedNodeId,
    setSelectedNodeId,
    setModelSortKey,
  };
}

function replaceGraphDoc(target: GraphDoc, source: GraphDoc): void {
  target.nodes.clear();
  for (const [id, node] of source.nodes) {
    target.nodes.set(id, {
      ...node,
      meta: node.meta ? { ...node.meta } : undefined,
    });
  }
  target.setSections(
    source.sections.map((section) => ({
      ...section,
      frame: section.frame ? { ...section.frame } : undefined,
      lanes: section.lanes?.map((lane) => ({
        ...lane,
        frame: { ...lane.frame },
      })),
      addSlots: section.addSlots?.map((slot) => ({
        ...slot,
        frame: { ...slot.frame },
      })),
    })),
  );
  target.setEdges(
    source.edges.map((edge) => ({
      ...edge,
      routePoints: edge.routePoints?.map((point) => ({ ...point })),
    })),
  );
}

function suggestName(
  store: DocumentStore,
  modelId: string,
  base: string,
): string {
  let i = 1;
  const m = store.get(modelId)!;
  const exists = (name: string) => m.workloads.some((w) => w.name === name);
  while (exists(`${base}${i}`)) i++;
  return `${base}${i}`;
}
