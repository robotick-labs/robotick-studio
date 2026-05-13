import React, { useEffect, useMemo, useRef, useState } from "react";
import { Project } from "../../../data-sources/launcher";
import {
  buildNamespacedKey,
  createPanelInstanceId,
  readStorageValue,
  setStorageValue,
} from "../../../services/storage";
import { usePanelInstance } from "../../workspaces/PanelInstanceContext";

const useProjectContext = Project.Context.use;

import { DocumentStore } from "./document/documentStore";
import { editorSelectionStore } from "./document/editorSelectionStore";
import {
  initNodeGraph,
  type EdgeVisibilityMode,
  type GraphLayoutDirection,
  type ModelSortKey,
  type NodeGraphAPI,
} from "./view/node-graph/initNodeGraph";
import {
  initPropertyPanel,
  type PropertyPanelAPI,
} from "./view/properties/InitPropertyPanel";
import styles from "./styles/ModelsPage.module.css";

const MODEL_SORT_OPTIONS: ReadonlyArray<{ value: ModelSortKey; label: string }> = [
  { value: "telemetry_port", label: "Telemetry Port" },
  { value: "model_name", label: "Model Name" },
  { value: "model_path", label: "Model Path" },
];

const LAYOUT_DIRECTION_OPTIONS: ReadonlyArray<{
  value: GraphLayoutDirection;
  label: string;
}> = [
  { value: "horizontal", label: "Horizontal - Stacked" },
  { value: "vertical", label: "Vertical - Stacked" },
];

export default function ModelsPage() {
  const { projectPath } = useProjectContext();
  const panelInstance = usePanelInstance();
  const fallbackPanelIdRef = useRef<string | null>(null);
  if (!panelInstance.panelId) {
    fallbackPanelIdRef.current ??= createPanelInstanceId();
  }
  const graphRef = useRef<SVGSVGElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const workspaceIdentifier = panelInstance.workspaceId ?? "workspace";
  const panelIdentifier =
    panelInstance.panelId ?? fallbackPanelIdRef.current ?? "default";
  const viewportStorageKey = useMemo(
    () =>
      buildNamespacedKey(
        "robotick-studio.models.viewport",
        workspaceIdentifier,
        panelIdentifier,
        projectPath ?? "no-project"
      ),
    [panelIdentifier, projectPath, workspaceIdentifier]
  );
  const panelViewStateStorageKey = useMemo(
    () =>
      buildNamespacedKey(
        "robotick-studio.models.view-state",
        workspaceIdentifier,
        panelIdentifier,
        projectPath ?? "no-project"
      ),
    [panelIdentifier, projectPath, workspaceIdentifier]
  );
  const selectionScopeKey = useMemo(
    () =>
      `models:${workspaceIdentifier}:${panelIdentifier}:${projectPath ?? "no-project"}`,
    [panelIdentifier, projectPath, workspaceIdentifier]
  );
  const initialViewState = useMemo(
    () => readModelsViewState(panelViewStateStorageKey),
    [panelViewStateStorageKey]
  );
  const modelSortStorageKey = useMemo(
    () =>
      buildNamespacedKey(
        "robotick-studio.models.sort",
        workspaceIdentifier,
        panelIdentifier,
        projectPath ?? "no-project"
      ),
    [panelIdentifier, projectPath, workspaceIdentifier]
  );
  const layoutDirectionStorageKey = useMemo(
    () =>
      buildNamespacedKey(
        "robotick-studio.models.layout-direction",
        workspaceIdentifier,
        panelIdentifier,
        projectPath ?? "no-project"
      ),
    [panelIdentifier, projectPath, workspaceIdentifier]
  );
  const [modelSortKey, setModelSortKey] = useState<ModelSortKey>(() =>
    readModelSortKey(modelSortStorageKey)
  );
  const [layoutDirection, setLayoutDirection] = useState<GraphLayoutDirection>(
    () => readLayoutDirection(layoutDirectionStorageKey)
  );
  const [edgeVisibilityMode, setEdgeVisibilityMode] =
    useState<EdgeVisibilityMode>(
      initialViewState?.edgeVisibilityMode ?? "selected-model"
    );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialViewState?.selectedNodeId ?? null
  );
  const [collapsedModelIds, setCollapsedModelIds] = useState<string[]>(
    () =>
      initialViewState?.collapsedModelIds ??
      readCollapsedModelIds(
        buildNamespacedKey(
          "robotick-studio.models.collapsed",
          workspaceIdentifier,
          panelIdentifier,
          projectPath ?? "no-project"
        )
      ) ??
      []
  );
  const [collapseStateInitialized, setCollapseStateInitialized] = useState(false);
  const [showPropertyPanel, setShowPropertyPanel] = useState(
    initialViewState?.showPropertyPanel ?? true
  );
  const graphApiRef = useRef<NodeGraphAPI | null>(null);

  useEffect(() => {
    const stored = readModelsViewState(panelViewStateStorageKey);
    setEdgeVisibilityMode(stored?.edgeVisibilityMode ?? "selected-model");
    setSelectedNodeId(stored?.selectedNodeId ?? null);
    setShowPropertyPanel(stored?.showPropertyPanel ?? true);
  }, [panelViewStateStorageKey]);

  useEffect(() => {
    setModelSortKey(readModelSortKey(modelSortStorageKey));
  }, [modelSortStorageKey]);

  useEffect(() => {
    setLayoutDirection(readLayoutDirection(layoutDirectionStorageKey));
  }, [layoutDirectionStorageKey]);

  useEffect(() => {
    const stored = readModelsViewState(panelViewStateStorageKey);
    const legacyCollapsed = readCollapsedModelIds(
      buildNamespacedKey(
        "robotick-studio.models.collapsed",
        workspaceIdentifier,
        panelIdentifier,
        projectPath ?? "no-project"
      )
    );
    setCollapsedModelIds(stored?.collapsedModelIds ?? legacyCollapsed ?? []);
  }, [
    panelIdentifier,
    panelViewStateStorageKey,
    projectPath,
    workspaceIdentifier,
  ]);

  useEffect(() => {
    const graphEl = graphRef.current;
    const panelEl = panelRef.current;
    if (!graphEl || !panelEl) {
      return;
    }
    const graphElement: SVGSVGElement = graphEl;
    const panelElement: HTMLDivElement = panelEl;
    setCollapseStateInitialized(false);

    let disposed = false;
    let graphApi: NodeGraphAPI | null = null;
    let panelApi: PropertyPanelAPI | null = null;
    let disposeViewportControls: (() => void) | null = null;
    const store = new DocumentStore();

    async function start() {
      if (!projectPath) {
        resetDom(graphElement, panelElement);
        return;
      }

      try {
        await store.load(projectPath);
        if (disposed) return;

        const allModelIds = store.getModelIds();
        const storedState = readModelsViewState(panelViewStateStorageKey);
        const storedCollapsed =
          storedState?.collapsedModelIds ??
          readCollapsedModelIds(
            buildNamespacedKey(
              "robotick-studio.models.collapsed",
              workspaceIdentifier,
              panelIdentifier,
              projectPath ?? "no-project"
            )
          );
        const initialCollapsed =
          storedCollapsed == null
            ? allModelIds
            : storedCollapsed.filter((modelId) => allModelIds.includes(modelId));
        setCollapsedModelIds(initialCollapsed);
        setCollapseStateInitialized(true);

        graphApi = initNodeGraph(
          graphElement,
          store,
          {
            edgeVisibilityMode,
            focusDimming: true,
            expandedModelIds: [],
          },
          {
            collapsedModelIds: initialCollapsed,
            modelSortKey,
            layoutDirection,
          },
          {
            selectionScope: selectionScopeKey,
            initialSelectedNodeId: selectedNodeId,
          }
        );
        graphApiRef.current = graphApi;
        panelApi = initPropertyPanel(
          panelElement,
          store,
          selectionScopeKey,
          projectPath
        );
        const storedViewport = readViewport(viewportStorageKey);
        if (storedViewport) {
          setViewBox(graphElement, storedViewport);
        } else {
          const defaultViewport = computeDefaultViewport(graphElement);
          if (defaultViewport) {
            setViewBox(graphElement, defaultViewport);
          }
        }
        disposeViewportControls = attachViewportControls(
          graphElement,
          (viewport) => writeViewport(viewportStorageKey, viewport)
        );
        const initialViewport = getViewBox(graphElement);
        if (initialViewport) {
          writeViewport(viewportStorageKey, initialViewport);
        }

        const onToggleCollapsed = (event: Event) => {
          const ce = event as CustomEvent<{ modelId?: string; scope?: string }>;
          if ((ce.detail?.scope ?? "default") !== selectionScopeKey) {
            return;
          }
          const modelId = ce.detail?.modelId;
          if (!modelId) {
            return;
          }
          setCollapsedModelIds((current) => {
            if (current.includes(modelId)) {
              return current.filter((id) => id !== modelId);
            }
            return [...current, modelId];
          });
        };
        graphElement.addEventListener(
          "models-graph:toggle-model-collapsed",
          onToggleCollapsed as EventListener
        );
        const onSelectionChanged = (event: Event) => {
          const ce = event as CustomEvent<{ nodeId?: string | null; scope?: string }>;
          if ((ce.detail?.scope ?? "default") !== selectionScopeKey) {
            return;
          }
          setSelectedNodeId(ce.detail?.nodeId ?? null);
        };
        window.addEventListener(
          "models-graph:selection-changed",
          onSelectionChanged as EventListener
        );
        const prevDispose = disposeViewportControls;
        disposeViewportControls = () => {
          prevDispose?.();
          graphElement.removeEventListener(
            "models-graph:toggle-model-collapsed",
            onToggleCollapsed as EventListener
          );
          window.removeEventListener(
            "models-graph:selection-changed",
            onSelectionChanged as EventListener
          );
        };
      } catch (err) {
        if (!disposed) {
          console.warn("Failed to initialise models page", err);
        }
      }
    }

    start();

    return () => {
      disposed = true;
      graphApiRef.current = null;
      graphApi?.dispose();
      panelApi?.dispose?.();
      disposeViewportControls?.();
      resetDom(graphElement, panelElement);
    };
  }, [
    panelIdentifier,
    panelViewStateStorageKey,
    projectPath,
    selectionScopeKey,
    viewportStorageKey,
    modelSortKey,
    workspaceIdentifier,
  ]);

  useEffect(() => {
    writeModelsViewState(panelViewStateStorageKey, {
      edgeVisibilityMode,
      selectedNodeId,
      showPropertyPanel,
      ...(collapseStateInitialized ? { collapsedModelIds } : {}),
    });
  }, [
    collapseStateInitialized,
    collapsedModelIds,
    edgeVisibilityMode,
    panelViewStateStorageKey,
    showPropertyPanel,
    selectedNodeId,
  ]);

  useEffect(() => {
    editorSelectionStore.setSelection(selectedNodeId, selectionScopeKey);
  }, [selectedNodeId, selectionScopeKey]);

  useEffect(() => {
    const graphApi = graphApiRef.current;
    if (!graphApi) {
      return;
    }
    graphApi.setModelSortKey(modelSortKey);
  }, [modelSortKey]);

  useEffect(() => {
    const graphApi = graphApiRef.current;
    if (!graphApi) {
      return;
    }
    graphApi.setLayoutDirection(layoutDirection);
  }, [layoutDirection]);

  useEffect(() => {
    const graphApi = graphApiRef.current;
    if (!graphApi) {
      return;
    }
    graphApi.setCollapsedModelIds(collapsedModelIds);
    const allModelIds = graphApi.getDoc().sections.map((section) => section.modelId);
    const expandedModelIds = allModelIds.filter(
      (modelId) => !collapsedModelIds.includes(modelId)
    );
    graphApiRef.current?.setDisplayOptions({
      edgeVisibilityMode,
      focusDimming: true,
      expandedModelIds,
    });
    graphApiRef.current?.setSelectedNodeId(selectedNodeId);
  }, [collapsedModelIds, edgeVisibilityMode, selectedNodeId]);

  useEffect(() => {
    setStorageValue(modelSortStorageKey, modelSortKey);
  }, [modelSortKey, modelSortStorageKey]);

  useEffect(() => {
    setStorageValue(layoutDirectionStorageKey, layoutDirection);
  }, [layoutDirection, layoutDirectionStorageKey]);

  return (
    <div className={styles.layout}>
      <div className={styles.mainPanel}>
        <button
          className={styles.propertyPanelToggle}
          type="button"
          aria-label={showPropertyPanel ? "Hide properties panel" : "Show properties panel"}
          title={showPropertyPanel ? "Hide properties panel" : "Show properties panel"}
          onClick={() => setShowPropertyPanel((value) => !value)}
        >
          {showPropertyPanel ? "›" : "‹"}
        </button>

        <div className={styles.graphPanel}>
          <div className={styles.viewportControls}>
            <label htmlFor="models-edge-visibility">Connections</label>
            <select
              id="models-edge-visibility"
              value={edgeVisibilityMode}
              onChange={(event) =>
                setEdgeVisibilityMode(event.target.value as EdgeVisibilityMode)
              }
            >
              <option value="none">None</option>
              <option value="selected-node">Selected Node Only</option>
              <option value="selected-model">Selected Node - Model</option>
              <option value="expanded-models">Expanded Models</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className={styles.viewportSortControls}>
            <label htmlFor="models-layout-direction">Draw Mode:</label>
            <select
              id="models-layout-direction"
              value={layoutDirection}
              onChange={(event) =>
                setLayoutDirection(event.target.value as GraphLayoutDirection)
              }
            >
              {LAYOUT_DIRECTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label htmlFor="models-model-sort">Sort models by:</label>
            <select
              id="models-model-sort"
              value={modelSortKey}
              onChange={(event) =>
                setModelSortKey(event.target.value as ModelSortKey)
              }
            >
              {MODEL_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <svg ref={graphRef} className={styles.graph}>
            <defs />
          </svg>
        </div>
      </div>
      <div
        className={`${styles.propertyPanel} ${
          showPropertyPanel ? "" : styles.propertyPanelCollapsed
        }`}
        ref={panelRef}
      />
    </div>
  );
}

function resetDom(
  graphEl?: SVGSVGElement | null,
  panelEl?: HTMLElement | null
) {
  if (graphEl) {
    graphEl.innerHTML = "<defs></defs>";
    graphEl.removeAttribute("viewBox");
  }
  if (panelEl) {
    panelEl.innerHTML = "";
  }
}

type GraphViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ModelsViewState = {
  edgeVisibilityMode: EdgeVisibilityMode;
  selectedNodeId: string | null;
  showPropertyPanel?: boolean;
  collapsedModelIds?: string[];
};

const MOUSE_BUTTON = {
  LEFT: 0,
  MIDDLE: 1,
  RIGHT: 2,
} as const;

function attachViewportControls(
  svg: SVGSVGElement,
  onViewportChanged: (viewport: GraphViewport) => void
): () => void {
  const MIN_VIEWBOX_WIDTH = 300;
  const MAX_VIEWBOX_WIDTH = 50000;
  const PAN_HOLD_DELAY_MS = 100;
  const CONTEXT_MENU_SUPPRESS_WINDOW_MS = 400;

  const applyViewport = (viewport: GraphViewport): void => {
    setViewBox(svg, viewport);
    onViewportChanged(viewport);
  };
  const clientToWorld = (
    clientX: number,
    clientY: number
  ): { x: number; y: number } | null => {
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return null;
    }
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const world = point.matrixTransform(ctm.inverse());
    return { x: world.x, y: world.y };
  };

  const onWheel = (event: WheelEvent) => {
    const current = getViewBox(svg);
    if (!current) {
      return;
    }

    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const normalizedX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const normalizedY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const worldX = current.x + normalizedX * current.width;
    const worldY = current.y + normalizedY * current.height;

    const zoomFactor = Math.exp(event.deltaY * 0.0015);
    const nextWidth = clamp(
      current.width * zoomFactor,
      MIN_VIEWBOX_WIDTH,
      MAX_VIEWBOX_WIDTH
    );
    const scale = nextWidth / current.width;
    const nextHeight = current.height * scale;
    const nextX = worldX - normalizedX * nextWidth;
    const nextY = worldY - normalizedY * nextHeight;

    applyViewport({
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
    });
  };

  let dragState:
    | {
        startClientX: number;
        startClientY: number;
        lastClientX: number;
        lastClientY: number;
        mouseDownTimeMs: number;
        startViewBox: GraphViewport;
        panArmed: boolean;
        isPanning: boolean;
      }
    | null = null;
  let suppressContextMenuUntilMs = 0;
  let armPanTimer: number | null = null;

  const clearArmPanTimer = () => {
    if (armPanTimer == null) {
      return;
    }
    window.clearTimeout(armPanTimer);
    armPanTimer = null;
  };

  const shouldSuppressContextMenu = () => {
    const heldLongEnough =
      dragState != null &&
      performance.now() - dragState.mouseDownTimeMs >= PAN_HOLD_DELAY_MS;
    return (
      heldLongEnough ||
      dragState?.panArmed === true ||
      dragState?.isPanning === true ||
      performance.now() < suppressContextMenuUntilMs
    );
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!dragState) {
      return;
    }

    dragState.lastClientX = event.clientX;
    dragState.lastClientY = event.clientY;

    if (!dragState.isPanning) {
      if (!dragState.panArmed) {
        return;
      }
      dragState.isPanning = true;
      svg.style.cursor = "grabbing";
    }
    event.preventDefault();

    const startWorld = clientToWorld(dragState.startClientX, dragState.startClientY);
    const currentWorld = clientToWorld(event.clientX, event.clientY);
    if (!startWorld || !currentWorld) {
      return;
    }

    const deltaX = currentWorld.x - startWorld.x;
    const deltaY = currentWorld.y - startWorld.y;

    applyViewport({
      x: dragState.startViewBox.x - deltaX,
      y: dragState.startViewBox.y - deltaY,
      width: dragState.startViewBox.width,
      height: dragState.startViewBox.height,
    });
  };

  const stopDragging = () => {
    clearArmPanTimer();
    if (
      dragState &&
      (dragState.panArmed ||
        dragState.isPanning ||
        performance.now() - dragState.mouseDownTimeMs >= PAN_HOLD_DELAY_MS)
    ) {
      suppressContextMenuUntilMs =
        performance.now() + CONTEXT_MENU_SUPPRESS_WINDOW_MS;
    }
    dragState = null;
    svg.style.cursor = "";
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };

  const onMouseUp = () => {
    stopDragging();
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== MOUSE_BUTTON.RIGHT && event.button !== MOUSE_BUTTON.MIDDLE) {
      return;
    }

    const viewBox = getViewBox(svg);
    if (!viewBox) {
      return;
    }

    dragState = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      mouseDownTimeMs: performance.now(),
      startViewBox: viewBox,
      panArmed: false,
      isPanning: false,
    };
    armPanTimer = window.setTimeout(() => {
      if (!dragState) {
        armPanTimer = null;
        return;
      }
      dragState.panArmed = true;
      dragState.startClientX = dragState.lastClientX;
      dragState.startClientY = dragState.lastClientY;
      dragState.startViewBox = getViewBox(svg) ?? dragState.startViewBox;
      svg.style.cursor = "grab";
      armPanTimer = null;
    }, PAN_HOLD_DELAY_MS);

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const onWindowContextMenu = (event: MouseEvent) => {
    if (!shouldSuppressContextMenu()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressContextMenuUntilMs = 0;
  };

  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("mousedown", onMouseDown);
  window.addEventListener("contextmenu", onWindowContextMenu, true);

  return () => {
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("contextmenu", onWindowContextMenu, true);
    stopDragging();
  };
}

function getViewBox(svg: SVGSVGElement): GraphViewport | null {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width > 0 && viewBox.height > 0) {
    return {
      x: viewBox.x,
      y: viewBox.y,
      width: viewBox.width,
      height: viewBox.height,
    };
  }

  const raw = svg.getAttribute("viewBox");
  if (!raw) {
    return null;
  }

  const parts = raw.split(/\s+/).map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function setViewBox(svg: SVGSVGElement, viewport: GraphViewport): void {
  svg.setAttribute(
    "viewBox",
    `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readViewport(storageKey: string): GraphViewport | null {
  const raw = readStorageValue(storageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GraphViewport> | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }
    return { x, y, width, height };
  } catch {
    return null;
  }
}

function writeViewport(storageKey: string, viewport: GraphViewport): void {
  setStorageValue(storageKey, JSON.stringify(viewport));
}

function readCollapsedModelIds(storageKey: string): string[] | null {
  const raw = readStorageValue(storageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

function readModelsViewState(storageKey: string): ModelsViewState | null {
  const raw = readStorageValue(storageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ModelsViewState> | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const edgeVisibilityMode = parsed.edgeVisibilityMode;
    const selectedNodeId =
      typeof parsed.selectedNodeId === "string" ? parsed.selectedNodeId : null;
    const collapsedModelIds = Array.isArray(parsed.collapsedModelIds)
      ? parsed.collapsedModelIds.filter(
          (id): id is string => typeof id === "string"
        )
      : undefined;
    const showPropertyPanel =
      typeof parsed.showPropertyPanel === "boolean"
        ? parsed.showPropertyPanel
        : undefined;
    if (
      edgeVisibilityMode !== "none" &&
      edgeVisibilityMode !== "selected-node" &&
      edgeVisibilityMode !== "selected-model" &&
      edgeVisibilityMode !== "expanded-models" &&
      edgeVisibilityMode !== "all"
    ) {
      return null;
    }
    return {
      edgeVisibilityMode,
      selectedNodeId,
      showPropertyPanel,
      collapsedModelIds,
    };
  } catch {
    return null;
  }
}

function writeModelsViewState(storageKey: string, state: ModelsViewState): void {
  const existing = readModelsViewState(storageKey);
  const payload: ModelsViewState = {
    edgeVisibilityMode: state.edgeVisibilityMode,
    selectedNodeId: state.selectedNodeId,
  };
  if (state.showPropertyPanel !== undefined) {
    payload.showPropertyPanel = state.showPropertyPanel;
  } else if (existing?.showPropertyPanel !== undefined) {
    payload.showPropertyPanel = existing.showPropertyPanel;
  }
  if (state.collapsedModelIds !== undefined) {
    payload.collapsedModelIds = state.collapsedModelIds;
  } else if (existing?.collapsedModelIds !== undefined) {
    payload.collapsedModelIds = existing.collapsedModelIds;
  }
  setStorageValue(storageKey, JSON.stringify(payload));
}

function readModelSortKey(storageKey: string): ModelSortKey {
  const value = readStorageValue(storageKey);
  if (
    value === "telemetry_port" ||
    value === "model_name" ||
    value === "model_path"
  ) {
    return value;
  }
  return "model_path";
}

function readLayoutDirection(storageKey: string): GraphLayoutDirection {
  const value = readStorageValue(storageKey);
  if (value === "horizontal" || value === "vertical") {
    return value;
  }
  return "horizontal";
}

function computeDefaultViewport(svg: SVGSVGElement): GraphViewport | null {
  const DEFAULT_VIEWBOX_WIDTH = 1500;
  const bounds = svg.getBBox();
  if (!(bounds.width > 0 && bounds.height > 0)) {
    return null;
  }

  const rect = svg.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) {
    return null;
  }

  const width = DEFAULT_VIEWBOX_WIDTH;
  const height = width * (rect.height / rect.width);
  const contentCenterX = bounds.x + bounds.width / 2;
  const contentCenterY = bounds.y + bounds.height / 2;
  const x = contentCenterX - width / 2;
  const y = contentCenterY - height / 2;

  return { x, y, width, height };
}
