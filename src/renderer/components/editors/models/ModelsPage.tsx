import React, { useEffect, useMemo, useRef, useState } from "react";
import { Project } from "../../../data-sources/launcher";
import {
  definePanelPersistence,
  defineStudioPanel,
  usePanelInstance,
  usePanelSettings,
} from "../../workspaces/PanelInstanceContext";

const useProjectContext = Project.Context.use;

import { DocumentStore } from "./document/documentStore";
import { editorSelectionStore } from "./document/editorSelectionStore";
import {
  initNodeGraph,
  type EdgeVisibilityMode,
  type ModelSortKey,
  type NodeGraphAPI,
  type RemoteConnectionVisibility,
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

type GraphViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ModelsViewState = {
  edgeVisibilityMode: EdgeVisibilityMode;
  remoteConnectionVisibility?: RemoteConnectionVisibility;
  selectedNodeId: string | null;
  showPropertyPanel?: boolean;
  collapsedModelIds?: string[];
};

type ModelsPageSettings = {
  viewport?: GraphViewport;
  viewState: ModelsViewState;
  modelSortKey: ModelSortKey;
};

function defaultModelsViewState(): ModelsViewState {
  return {
    edgeVisibilityMode: "selected-model",
    remoteConnectionVisibility: "hidden",
    selectedNodeId: null,
    showPropertyPanel: true,
    collapsedModelIds: [],
  };
}

function defaultModelsPageSettings(): ModelsPageSettings {
  return {
    viewState: defaultModelsViewState(),
    modelSortKey: "model_path",
  };
}

function parseViewportValue(raw: unknown): GraphViewport | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const parsed = raw as Partial<GraphViewport>;
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
}

function parseCollapsedModelIdsValue(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw.filter((id): id is string => typeof id === "string");
}

function parseModelsViewStateValue(raw: unknown): ModelsViewState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const parsed = raw as Partial<ModelsViewState> | null;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const edgeVisibilityMode = parsed.edgeVisibilityMode;
  const remoteConnectionVisibility = parsed.remoteConnectionVisibility;
  const selectedNodeId =
    typeof parsed.selectedNodeId === "string" ? parsed.selectedNodeId : null;
  const collapsedModelIds = parseCollapsedModelIdsValue(parsed.collapsedModelIds);
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
    remoteConnectionVisibility:
      remoteConnectionVisibility === "visible" ? "visible" : "hidden",
    selectedNodeId,
    showPropertyPanel,
    collapsedModelIds,
  };
}

function parseModelSortKeyValue(raw: unknown): ModelSortKey {
  return raw === "telemetry_port" || raw === "model_name" || raw === "model_path"
    ? raw
    : "model_path";
}

function sanitizeModelsPageSettings(value: unknown): ModelsPageSettings {
  const defaults = defaultModelsPageSettings();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const data = value as Partial<ModelsPageSettings>;
  const viewState = parseModelsViewStateValue(data.viewState) ?? defaults.viewState;
  return {
    viewport: parseViewportValue(data.viewport) ?? undefined,
    viewState: {
      edgeVisibilityMode: viewState.edgeVisibilityMode,
      remoteConnectionVisibility:
        viewState.remoteConnectionVisibility ?? "hidden",
      selectedNodeId: viewState.selectedNodeId,
      showPropertyPanel: viewState.showPropertyPanel ?? true,
      collapsedModelIds: viewState.collapsedModelIds ?? [],
    },
    modelSortKey: parseModelSortKeyValue(data.modelSortKey),
  };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function modelsViewStateEqual(
  left: ModelsViewState,
  right: ModelsViewState,
): boolean {
  return (
    left.edgeVisibilityMode === right.edgeVisibilityMode &&
    (left.remoteConnectionVisibility ?? "hidden") ===
      (right.remoteConnectionVisibility ?? "hidden") &&
    left.selectedNodeId === right.selectedNodeId &&
    (left.showPropertyPanel ?? true) === (right.showPropertyPanel ?? true) &&
    arraysEqual(left.collapsedModelIds ?? [], right.collapsedModelIds ?? [])
  );
}

export const modelsPagePersistence = definePanelPersistence<ModelsPageSettings>({
  schemaVersion: 1,
  defaults: defaultModelsPageSettings(),
  sanitize: sanitizeModelsPageSettings,
});

export function ModelsPage() {
  const { projectPath } = useProjectContext();
  const { workspaceId, panelId } = usePanelInstance();
  const [settings, updateSettings] = usePanelSettings(modelsPagePersistence);
  const settingsRef = useRef(settings);
  const updateSettingsRef = useRef(updateSettings);
  const graphRef = useRef<SVGSVGElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const workspaceIdentifier = workspaceId ?? "workspace";
  const panelIdentifier = panelId ?? "default";
  const selectionScopeKey = useMemo(
    () =>
      `models:${workspaceIdentifier}:${panelIdentifier}:${projectPath ?? "no-project"}`,
    [panelIdentifier, projectPath, workspaceIdentifier]
  );
  const viewState = settings.viewState;
  const modelSortKey = settings.modelSortKey;
  const edgeVisibilityMode = viewState.edgeVisibilityMode;
  const remoteConnectionVisibility =
    viewState.remoteConnectionVisibility ?? "hidden";
  const selectedNodeId = viewState.selectedNodeId;
  const collapsedModelIds = viewState.collapsedModelIds ?? [];
  const [collapseStateInitialized, setCollapseStateInitialized] = useState(false);
  const showPropertyPanel = viewState.showPropertyPanel ?? true;
  const graphApiRef = useRef<NodeGraphAPI | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    updateSettingsRef.current = updateSettings;
  }, [updateSettings]);

  const replaceViewState = React.useCallback(
    (
      next:
        | ModelsViewState
        | ((current: ModelsViewState) => ModelsViewState)
    ) => {
      const current = settingsRef.current.viewState;
      const resolved = typeof next === "function" ? next(current) : next;
      const normalized: ModelsViewState = {
        ...resolved,
        remoteConnectionVisibility:
          resolved.remoteConnectionVisibility ?? "hidden",
        showPropertyPanel: resolved.showPropertyPanel ?? true,
        collapsedModelIds: resolved.collapsedModelIds ?? [],
      };
      if (modelsViewStateEqual(current, normalized)) {
        return;
      }
      updateSettings({
        viewState: normalized,
      });
    },
    [updateSettings]
  );

  const setSelectedNodeId = React.useCallback(
    (nodeId: string | null) => {
      replaceViewState((current) => ({
        ...current,
        selectedNodeId: nodeId,
      }));
    },
    [replaceViewState]
  );

  const setCollapsedModelIds = React.useCallback(
    (
      next:
        | string[]
        | ((current: string[]) => string[])
    ) => {
      replaceViewState((current) => ({
        ...current,
        collapsedModelIds:
          typeof next === "function"
            ? next(current.collapsedModelIds ?? [])
            : next,
      }));
    },
    [replaceViewState]
  );

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
        const storedState = settingsRef.current.viewState;
        const storedCollapsed = storedState?.collapsedModelIds;
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
            remoteConnectionVisibility,
            focusDimming: true,
            expandedModelIds: [],
          },
          {
            collapsedModelIds: initialCollapsed,
            modelSortKey,
          },
          {
            selectionScope: selectionScopeKey,
            initialSelectedNodeId: selectedNodeId,
            onSelectedNodeIdChange: setSelectedNodeId,
            onToggleCollapsedModel: (modelId) => {
              setCollapsedModelIds((current) => {
                if (current.includes(modelId)) {
                  return current.filter((id) => id !== modelId);
                }
                return [...current, modelId];
              });
            },
          }
        );
        graphApiRef.current = graphApi;
        await graphApi.refreshLayout();
        if (disposed) return;
        panelApi = initPropertyPanel(
          panelElement,
          store,
          selectionScopeKey,
          projectPath
        );
        const storedViewport = settingsRef.current.viewport;
        const defaultViewport = computeDefaultViewport(graphElement);
        const initialViewport = defaultViewport ?? storedViewport ?? null;
        if (initialViewport) {
          setViewBox(graphElement, initialViewport);
        }
        disposeViewportControls = attachViewportControls(
          graphElement,
          (viewport) => updateSettingsRef.current({ viewport })
        );
        const appliedViewport = getViewBox(graphElement);
        if (appliedViewport) {
          updateSettingsRef.current({ viewport: appliedViewport });
        }

        const prevDispose = disposeViewportControls;
        disposeViewportControls = () => {
          prevDispose?.();
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
    projectPath,
    selectionScopeKey,
    modelSortKey,
  ]);

  useEffect(() => {
    if (!collapseStateInitialized) {
      return;
    }
    replaceViewState((current) => ({
      ...current,
      collapsedModelIds,
    }));
  }, [collapseStateInitialized, collapsedModelIds, replaceViewState]);

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
    graphApi.setCollapsedModelIds(collapsedModelIds);
    const allModelIds = graphApi.getDoc().sections.map((section) => section.modelId);
    const expandedModelIds = allModelIds.filter(
      (modelId) => !collapsedModelIds.includes(modelId)
    );
    graphApiRef.current?.setDisplayOptions({
      edgeVisibilityMode,
      remoteConnectionVisibility,
      focusDimming: true,
      expandedModelIds,
    });
  }, [collapsedModelIds, edgeVisibilityMode, remoteConnectionVisibility]);

  return (
    <div className={styles.layout}>
      <div className={styles.mainPanel}>
        <button
          className={styles.propertyPanelToggle}
          type="button"
          aria-label={showPropertyPanel ? "Hide properties panel" : "Show properties panel"}
          title={showPropertyPanel ? "Hide properties panel" : "Show properties panel"}
          onClick={() =>
            replaceViewState((current) => ({
              ...current,
              showPropertyPanel: !(current.showPropertyPanel ?? true),
            }))
          }
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
                replaceViewState((current) => ({
                  ...current,
                  edgeVisibilityMode: event.target.value as EdgeVisibilityMode,
                }))
              }
            >
              <option value="none">None</option>
              <option value="selected-node">Selected Node Only</option>
              <option value="selected-model">Selected Node - Model</option>
              <option value="expanded-models">Expanded Models</option>
              <option value="all">All</option>
            </select>
            <label htmlFor="models-remote-connections">Remote</label>
            <select
              id="models-remote-connections"
              value={remoteConnectionVisibility}
              onChange={(event) =>
                replaceViewState((current) => ({
                  ...current,
                  remoteConnectionVisibility:
                    event.target.value as RemoteConnectionVisibility,
                }))
              }
            >
              <option value="hidden">Hidden</option>
              <option value="visible">Visible</option>
            </select>
          </div>
          <div className={styles.viewportSortControls}>
            <label htmlFor="models-model-sort">Sort models by:</label>
            <select
              id="models-model-sort"
              value={modelSortKey}
              onChange={(event) =>
                updateSettings({
                  modelSortKey: event.target.value as ModelSortKey,
                })
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
}

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
export const contribution = defineStudioPanel({
  component: ModelsPage,
  persistence: modelsPagePersistence,
});

export default ModelsPage;
