import React, { useEffect, useMemo, useRef, useState } from "react";
import { Project } from "../../../data-sources/launcher";
import {
  buildNamespacedKey,
  readStorageValue,
  setStorageValue,
} from "../../../services/storage";
import { usePanelInstance } from "../../workspaces/PanelInstanceContext";

const useProjectContext = Project.Context.use;

import { DocumentStore } from "./document/documentStore";
import {
  initNodeGraph,
  type EdgeVisibilityMode,
  type NodeGraphAPI,
} from "./view/node-graph/initNodeGraph";
import {
  initPropertyPanel,
  type PropertyPanelAPI,
} from "./view/properties/InitPropertyPanel";
import styles from "./styles/ModelsPage.module.css";

export default function ModelsPage() {
  const { projectPath } = useProjectContext();
  const panelInstance = usePanelInstance();
  const graphRef = useRef<SVGSVGElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const workspaceIdentifier = panelInstance.workspaceId ?? "workspace";
  const panelIdentifier = panelInstance.panelId ?? "default";
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
  const collapsedModelsStorageKey = useMemo(
    () =>
      buildNamespacedKey(
        "robotick-studio.models.collapsed",
        workspaceIdentifier,
        panelIdentifier,
        projectPath ?? "no-project"
      ),
    [panelIdentifier, projectPath, workspaceIdentifier]
  );
  const [edgeVisibilityMode, setEdgeVisibilityMode] =
    useState<EdgeVisibilityMode>("selected-model");
  const [collapsedModelIds, setCollapsedModelIds] = useState<string[]>([]);
  const graphApiRef = useRef<NodeGraphAPI | null>(null);

  useEffect(() => {
    const storedCollapsed = readCollapsedModelIds(collapsedModelsStorageKey);
    setCollapsedModelIds(storedCollapsed ?? []);
  }, [collapsedModelsStorageKey]);

  useEffect(() => {
    const graphEl = graphRef.current;
    const panelEl = panelRef.current;
    if (!graphEl || !panelEl) {
      return;
    }
    const graphElement: SVGSVGElement = graphEl;
    const panelElement: HTMLDivElement = panelEl;

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
        const storedCollapsed = readCollapsedModelIds(collapsedModelsStorageKey);
        const initialCollapsed =
          storedCollapsed == null
            ? allModelIds
            : storedCollapsed.filter((modelId) => allModelIds.includes(modelId));
        setCollapsedModelIds(initialCollapsed);

        graphApi = initNodeGraph(graphElement, store, {
          edgeVisibilityMode,
          focusDimming: true,
          expandedModelIds: [],
        }, {
          collapsedModelIds: initialCollapsed,
        });
        graphApiRef.current = graphApi;
        panelApi = initPropertyPanel(panelElement, store);
        const storedViewport = readViewport(viewportStorageKey);
        if (storedViewport) {
          setViewBox(graphElement, storedViewport);
        } else {
          const fitWidthViewport = computeFitWidthViewport(graphElement);
          if (fitWidthViewport) {
            setViewBox(graphElement, fitWidthViewport);
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
          const ce = event as CustomEvent<{ modelId?: string }>;
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
        window.addEventListener(
          "models-graph:toggle-model-collapsed",
          onToggleCollapsed as EventListener
        );
        const prevDispose = disposeViewportControls;
        disposeViewportControls = () => {
          prevDispose?.();
          window.removeEventListener(
            "models-graph:toggle-model-collapsed",
            onToggleCollapsed as EventListener
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
  }, [projectPath, viewportStorageKey]);

  useEffect(() => {
    writeCollapsedModelIds(collapsedModelsStorageKey, collapsedModelIds);
  }, [collapsedModelIds, collapsedModelsStorageKey]);

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
  }, [collapsedModelIds, edgeVisibilityMode]);

  return (
    <div className={styles.layout}>
      <div className={styles.mainPanel}>
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

function attachViewportControls(
  svg: SVGSVGElement,
  onViewportChanged: (viewport: GraphViewport) => void
): () => void {
  const MIN_VIEWBOX_WIDTH = 300;
  const MAX_VIEWBOX_WIDTH = 50000;
  const PAN_EXCLUDE_SELECTOR = "g.workload-node, g.plus-slot";

  const applyViewport = (viewport: GraphViewport): void => {
    setViewBox(svg, viewport);
    onViewportChanged(viewport);
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
        startViewBox: GraphViewport;
      }
    | null = null;

  const onMouseMove = (event: MouseEvent) => {
    if (!dragState) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const dx = event.clientX - dragState.startClientX;
    const dy = event.clientY - dragState.startClientY;

    applyViewport({
      x: dragState.startViewBox.x - (dx / rect.width) * dragState.startViewBox.width,
      y: dragState.startViewBox.y - (dy / rect.height) * dragState.startViewBox.height,
      width: dragState.startViewBox.width,
      height: dragState.startViewBox.height,
    });
  };

  const stopDragging = () => {
    dragState = null;
    svg.style.cursor = "";
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };

  const onMouseUp = () => {
    stopDragging();
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 1) {
      return;
    }

    const targetElement = event.target as Element | null;
    if (targetElement?.closest(PAN_EXCLUDE_SELECTOR)) {
      return;
    }

    const viewBox = getViewBox(svg);
    if (!viewBox) {
      return;
    }

    dragState = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewBox: viewBox,
    };

    svg.style.cursor = "grabbing";
    event.preventDefault();
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const onAuxClick = (event: MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("mousedown", onMouseDown);
  svg.addEventListener("auxclick", onAuxClick);

  return () => {
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("mousedown", onMouseDown);
    svg.removeEventListener("auxclick", onAuxClick);
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

function writeCollapsedModelIds(storageKey: string, modelIds: string[]): void {
  setStorageValue(storageKey, JSON.stringify(modelIds));
}

function computeFitWidthViewport(svg: SVGSVGElement): GraphViewport | null {
  const margin = 40;
  const bounds = svg.getBBox();
  if (!(bounds.width > 0 && bounds.height > 0)) {
    return null;
  }

  const rect = svg.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) {
    return null;
  }

  const width = Math.ceil(bounds.width) + margin * 2;
  const height = width * (rect.height / rect.width);
  const x = Math.floor(bounds.x) - margin;
  const contentCenterY = bounds.y + bounds.height / 2;
  const y = contentCenterY - height / 2;

  return { x, y, width, height };
}
