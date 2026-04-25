import React from "react";
import {
  getEditorEntry,
  listEditorEntries,
} from "../../services/EditorRegistry";
import {
  FloatingPanelLayer,
  FloatingPanelsScopeProvider,
  spawnFloatingPanel,
} from "./floating-panels";
import type { PanelContextMenuState } from "./PanelContextMenu";
import { useContextMenu } from "../context-menu/ContextMenuProvider";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import { PanelInstanceProvider } from "./PanelInstanceContext";
import styles from "./PanelLayout.module.css";
import { addWindowEventListener } from "../../utils/domEnvironment";
import {
  readStorageValue,
  removeStorageValue,
  setStorageValue,
} from "../../services/storage";

type PanelLeafNode = {
  id: string;
  kind: "leaf";
  editorId: string;
};

type PanelSplitNode = {
  id: string;
  kind: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [PanelNode, PanelNode];
};

type PanelNode = PanelLeafNode | PanelSplitNode;

const STORAGE_PREFIX = "panelLayout:";
const DEFAULT_RATIO = 0.5;
const MIN_RATIO = 0.05;
const MAX_RATIO = 0.85;

type PanelLayoutProps = {
  workspaceId: string;
  defaultEditorId: string;
  allowedEditors?: string[];
};

type EditorOption = {
  id: string;
  label: string;
};

let panelIdCounter = 0;
/**
 * Generate a unique identifier for a panel.
 *
 * @returns A unique string to use as the panel's identifier
 */
function generatePanelId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  panelIdCounter += 1;
  return `panel-${panelIdCounter}`;
}

function clampRatio(value: number) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

function createLeaf(editorId: string): PanelLeafNode {
  return { id: generatePanelId(), kind: "leaf", editorId };
}

function nodeContains(node: PanelNode, panelId: string): boolean {
  if (node.kind === "leaf") {
    return node.id === panelId;
  }
  return (
    nodeContains(node.children[0], panelId) ||
    nodeContains(node.children[1], panelId)
  );
}

function countLeaves(node: PanelNode): number {
  if (node.kind === "leaf") return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

/**
 * Validate and normalize a raw panel layout object into a sanitized panel tree node.
 *
 * The function accepts an untrusted value and returns a well-formed PanelNode if the
 * input represents a valid leaf or split node. For leaf nodes it resolves the editor
 * id against the allowed set and ensures an id exists. For split nodes it validates
 * direction and children, recursively sanitizes both children, clamps the ratio, and
 * ensures an id exists.
 *
 * @param raw - Untrusted input to validate and sanitize
 * @param fallbackEditorId - Editor id to use when a leaf's editor is missing or not allowed
 * @param allowedEditors - Set of permitted editor ids used to validate leaf editor assignments
 * @returns A sanitized `PanelNode` when `raw` is valid, or `null` when the input is invalid
 */
function sanitizeNode(
  raw: unknown,
  fallbackEditorId: string,
  allowedEditors: Set<string>
): PanelNode | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (data.kind === "leaf") {
    const editorId = typeof data.editorId === "string" ? data.editorId : null;
    const resolvedEditor =
      editorId && allowedEditors.has(editorId) ? editorId : fallbackEditorId;
    const id =
      typeof data.id === "string" && data.id ? data.id : generatePanelId();
    return { id, kind: "leaf", editorId: resolvedEditor };
  }
  if (
    data.kind === "split" &&
    (data.direction === "horizontal" || data.direction === "vertical") &&
    Array.isArray(data.children) &&
    data.children.length === 2
  ) {
    const first = sanitizeNode(
      data.children[0],
      fallbackEditorId,
      allowedEditors
    );
    const second = sanitizeNode(
      data.children[1],
      fallbackEditorId,
      allowedEditors
    );
    if (!first || !second) return null;
    const ratio =
      typeof data.ratio === "number" ? clampRatio(data.ratio) : DEFAULT_RATIO;
    const id =
      typeof data.id === "string" && data.id ? data.id : generatePanelId();
    return {
      id,
      kind: "split",
      direction: data.direction,
      ratio,
      children: [first, second],
    };
  }
  return null;
}

/**
 * Load a persisted panel layout for a workspace and return a validated layout tree, or a fresh leaf using the fallback editor when no valid layout exists.
 *
 * @param workspaceId - Identifier used to locate the persisted layout for the workspace
 * @param fallbackEditorId - Editor id to use when returning a new leaf or replacing invalid/unsupported editor entries
 * @param allowedEditors - Set of editor ids permitted in the returned layout; any editor not in this set will be replaced by `fallbackEditorId`
 * @returns A sanitized PanelNode representing the workspace layout, or a single-leaf node using `fallbackEditorId` if the stored layout is missing or invalid
 */
function loadLayout(
  workspaceId: string,
  fallbackEditorId: string,
  allowedEditors: Set<string>
): PanelNode {
  try {
    const raw = readStorageValue(`${STORAGE_PREFIX}${workspaceId}`);
    if (!raw) {
      return createLeaf(fallbackEditorId);
    }
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeNode(parsed, fallbackEditorId, allowedEditors);
    return sanitized ?? createLeaf(fallbackEditorId);
  } catch {
    return createLeaf(fallbackEditorId);
  }
}

/**
 * Persist the given panel layout for a workspace in durable storage.
 *
 * @param workspaceId - Identifier for the workspace; used as the storage key
 * @param layout - The root panel node representing the layout to persist
 *
 * @remarks
 * Write failures (for example, when storage is unavailable or disabled) are ignored. */
function saveLayout(workspaceId: string, layout: PanelNode) {
  try {
    setStorageValue(`${STORAGE_PREFIX}${workspaceId}`, JSON.stringify(layout));
  } catch {
    // Ignore write failures (e.g., storage disabled)
  }
}

/**
 * Apply `updater` to the leaf node whose `id` equals `targetId` and return the resulting panel tree.
 *
 * The `updater` is invoked with the matching leaf node and should return the replacement node for that position.
 *
 * @param node - The root panel node to traverse
 * @param targetId - The id of the leaf to update
 * @param updater - Function that receives the matching leaf and returns the node that should replace it
 * @returns The updated root `PanelNode`; if no leaf with `targetId` is found, returns the original `node`
 */
function updateNode(
  node: PanelNode,
  targetId: string,
  updater: (leaf: PanelLeafNode) => PanelNode
): PanelNode {
  if (node.kind === "leaf") {
    if (node.id !== targetId) {
      return node;
    }
    return updater(node);
  }

  const first = updateNode(node.children[0], targetId, updater);
  const second = updateNode(node.children[1], targetId, updater);
  if (first === node.children[0] && second === node.children[1]) {
    return node;
  }

  return {
    ...node,
    children: [first, second],
  };
}

function removePanel(node: PanelNode, targetId: string): PanelNode | null {
  if (node.kind === "leaf") {
    return node.id === targetId ? null : node;
  }

  const first = removePanel(node.children[0], targetId);
  const second = removePanel(node.children[1], targetId);

  if (!first && !second) {
    return null;
  }

  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  if (first === node.children[0] && second === node.children[1]) {
    return node;
  }

  return {
    ...node,
    children: [first, second],
  };
}

/**
 * Update the ratio of a split node within a panel tree and return the updated tree.
 *
 * Traverses the tree and, when a split node with `splitId` is found, replaces its
 * `ratio` with the provided `ratio` (clamped to the allowed range). All other
 * nodes are preserved; if no matching split is found the original tree is returned.
 *
 * @param node - The root panel node to traverse
 * @param splitId - The identifier of the split node to update
 * @param ratio - The desired split ratio; it will be clamped to the valid range
 * @returns The new panel tree with the updated split ratio (or the original tree if not found)
 */
function updateSplitRatio(
  node: PanelNode,
  splitId: string,
  ratio: number
): PanelNode {
  if (node.kind === "split") {
    if (node.id === splitId) {
      return { ...node, ratio: clampRatio(ratio) };
    }
    return {
      ...node,
      children: [
        updateSplitRatio(node.children[0], splitId, ratio),
        updateSplitRatio(node.children[1], splitId, ratio),
      ],
    };
  }
  return node;
}

/**
 * Render a workspace-scoped, persistent panel layout that hosts editor instances and provides splitting, resizing, assignment, closing, maximizing, and floating-panel operations.
 *
 * The component loads and persists the layout per `workspaceId`, enforces `allowedEditors` when provided, and exposes interactive behaviors (split, assign editor, close, resize splits, toggle maximize, reset layout, and spawn floating panels) via UI controls and a context menu.
 *
 * @returns The React element for the panel layout UI
 */
export function PanelLayout({
  workspaceId,
  defaultEditorId,
  allowedEditors,
}: PanelLayoutProps) {
  const editorEntries = React.useMemo(() => {
    const entries = listEditorEntries();
    if (!allowedEditors || allowedEditors.length === 0) {
      return entries;
    }
    const allowed = new Set(allowedEditors);
    return entries.filter((entry) => allowed.has(entry.id));
  }, [allowedEditors]);

  if (!editorEntries.length) {
    throw new Error("No editors are registered for the panel layout");
  }

  const editorOptions: EditorOption[] = React.useMemo(
    () =>
      editorEntries.map((entry) => ({
        id: entry.id,
        label: entry.label,
      })),
    [editorEntries]
  );

  const allowedIdsKey = editorEntries.map((entry) => entry.id).join("|");
  const allowedIdSet = React.useMemo(
    () => new Set(editorEntries.map((entry) => entry.id)),
    [allowedIdsKey]
  );

  const fallbackEditorId = allowedIdSet.has(defaultEditorId)
    ? defaultEditorId
    : editorEntries[0].id;

  const [layout, setLayout] = React.useState<PanelNode>(() =>
    loadLayout(workspaceId, fallbackEditorId, allowedIdSet)
  );
  const [maximizedPanelId, setMaximizedPanelId] = React.useState<string | null>(
    null
  );
  React.useEffect(() => {
    setLayout(loadLayout(workspaceId, fallbackEditorId, allowedIdSet));
    setMaximizedPanelId(null);
  }, [workspaceId, fallbackEditorId, allowedIdsKey]);

  React.useEffect(() => {
    saveLayout(workspaceId, layout);
  }, [workspaceId, layout]);

  React.useEffect(() => {
    if (maximizedPanelId && !nodeContains(layout, maximizedPanelId)) {
      setMaximizedPanelId(null);
    }
  }, [layout, maximizedPanelId]);

  const onSplit = React.useCallback(
    (panelId: string, direction: "horizontal" | "vertical", ratio: number) => {
      setLayout((current) =>
        updateNode(current, panelId, (leaf) => ({
          id: leaf.id,
          kind: "split",
          direction,
          ratio: clampRatio(ratio || DEFAULT_RATIO),
          children: [createLeaf(leaf.editorId), createLeaf(leaf.editorId)],
        }))
      );
    },
    []
  );

  const onAssign = React.useCallback((panelId: string, editorId: string) => {
    setLayout((current) =>
      updateNode(current, panelId, (leaf) => ({
        ...leaf,
        editorId,
      }))
    );
  }, []);

  const onClosePanel = React.useCallback((panelId: string) => {
    setLayout((current) => {
      const result = removePanel(current, panelId);
      if (!result) {
        return current;
      }
      return result;
    });
  }, []);

  const onToggleMaximize = React.useCallback((panelId: string) => {
    setMaximizedPanelId((current) => (current === panelId ? null : panelId));
  }, []);

  const onResizeSplit = React.useCallback((splitId: string, ratio: number) => {
    setLayout((current) => updateSplitRatio(current, splitId, ratio));
  }, []);

  const resetLayout = React.useCallback(() => {
    const fresh = createLeaf(fallbackEditorId);
    removeStorageValue(`${STORAGE_PREFIX}${workspaceId}`);
    setLayout(fresh);
    setMaximizedPanelId(null);
  }, [fallbackEditorId, workspaceId]);

  const handleCreateFloatingPanel = React.useCallback(
    (editorId?: string) => {
      const targetEditor =
        editorId && allowedIdSet.has(editorId) ? editorId : fallbackEditorId;
      spawnFloatingPanel(workspaceId, {
        editorId: targetEditor,
      });
    },
    [allowedIdSet, fallbackEditorId, workspaceId]
  );

  const { showPanelMenu } = useContextMenu();
  const leafTotal = React.useMemo(() => countLeaves(layout), [layout]);
  const handleContextMenu = React.useCallback(
    (
      panelId: string,
      editorId: string,
      event: React.MouseEvent<HTMLDivElement>
    ) => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const horizontalRatio = rect.width
        ? (event.clientX - rect.left) / rect.width
        : DEFAULT_RATIO;
      const verticalRatio = rect.height
        ? (event.clientY - rect.top) / rect.height
        : DEFAULT_RATIO;
      const state: PanelContextMenuState = {
        panelId,
        x: event.clientX,
        y: event.clientY,
        horizontalRatio: clampRatio(horizontalRatio),
        verticalRatio: clampRatio(verticalRatio),
        editorId,
      };
      showPanelMenu({
        state,
        editorOptions,
        canClose: leafTotal > 1,
        isMaximized: maximizedPanelId === panelId,
        onSplit,
        onAssign: (targetEditorId: string) => onAssign(panelId, targetEditorId),
        onToggleMaximize: () => onToggleMaximize(panelId),
        onResetLayout: resetLayout,
        onClosePanel: () => onClosePanel(panelId),
        onCreateFloatingPanel: handleCreateFloatingPanel,
      });
    },
    [
      editorOptions,
      handleCreateFloatingPanel,
      leafTotal,
      maximizedPanelId,
      onAssign,
      onClosePanel,
      onSplit,
      onToggleMaximize,
      resetLayout,
      showPanelMenu,
    ]
  );

  return (
    <FloatingPanelsScopeProvider scope={workspaceId}>
      <div className={styles.panelLayoutShell}>
        <div className={styles.layoutTabs} aria-label="Workspace layout tabs">
          <button
            type="button"
            className={`${styles.layoutTab} ${styles.layoutTabActive}`}
          >
            Default
          </button>
          <button
            type="button"
            className={styles.layoutTab}
          >
            Auditory
          </button>
          <button
            type="button"
            className={styles.layoutTabAdd}
            aria-label="Create layout tab"
            title="Create layout tab"
          >
            +
          </button>
        </div>
        <div className={styles.panelLayout}>
          <PanelNodeView
            node={layout}
            maximizedPanelId={maximizedPanelId}
            editorOptions={editorOptions}
            onContextMenu={handleContextMenu}
            onAssign={onAssign}
            onToggleMaximize={onToggleMaximize}
            onSplit={onSplit}
            onResizeSplit={onResizeSplit}
            workspaceId={workspaceId}
          />
        </div>
      </div>
      <FloatingPanelLayer scope={workspaceId} editorEntries={editorEntries} />
    </FloatingPanelsScopeProvider>
  );
}

type PanelNodeViewProps = {
  node: PanelNode;
  maximizedPanelId: string | null;
  editorOptions: EditorOption[];
  onContextMenu: (
    panelId: string,
    editorId: string,
    event: React.MouseEvent<HTMLDivElement>
  ) => void;
  onAssign: (panelId: string, editorId: string) => void;
  onToggleMaximize: (panelId: string) => void;
  onSplit: (
    panelId: string,
    direction: "horizontal" | "vertical",
    ratio: number
  ) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
  workspaceId: string;
};

/**
 * Render a panel layout node and its children, displaying either a split container or a leaf panel.
 *
 * Renders a split node as two resizable panes (with a SplitResizer when both sides are visible) and
 * renders a leaf node as a PanelLeaf. Visibility of child panes is determined by `maximizedPanelId`.
 *
 * @param node - The panel node (split or leaf) to render.
 * @param maximizedPanelId - The id of the currently maximized panel, or `null` when none; controls which panes are visible.
 * @param editorOptions - Available editor choices presented to leaf panels.
 * @param onContextMenu - Callback invoked to show the context menu for a panel.
 * @param onAssign - Callback to assign a different editor to a leaf panel.
 * @param onToggleMaximize - Callback to toggle maximize/restore for a panel.
 * @param onSplit - Callback to split a leaf panel into two panes.
 * @param onResizeSplit - Callback invoked when a split's ratio changes.
 * @param workspaceId - Identifier for the current workspace scope.
 * @returns A React element that renders the given `node` and its child panes.
 */
function PanelNodeView({
  node,
  maximizedPanelId,
  editorOptions,
  onContextMenu,
  onAssign,
  onToggleMaximize,
  onSplit,
  onResizeSplit,
  workspaceId,
}: PanelNodeViewProps) {
  const splitContainerRef = React.useRef<HTMLDivElement | null>(null);
  if (node.kind === "split") {
    const firstVisible =
      !maximizedPanelId || nodeContains(node.children[0], maximizedPanelId);
    const secondVisible =
      !maximizedPanelId || nodeContains(node.children[1], maximizedPanelId);
    const layoutClass =
      node.direction === "horizontal"
        ? styles.splitHorizontal
        : styles.splitVertical;
    return (
      <div className={layoutClass} ref={splitContainerRef}>
        {firstVisible && (
          <div
            className={styles.splitPane}
            style={
              secondVisible
                ? {
                    flexBasis: `${node.ratio * 100}%`,
                  }
                : { flex: 1 }
            }
          >
            <PanelNodeView
              node={node.children[0]}
              maximizedPanelId={maximizedPanelId}
              editorOptions={editorOptions}
              onContextMenu={onContextMenu}
              onAssign={onAssign}
              onToggleMaximize={onToggleMaximize}
              onSplit={onSplit}
              onResizeSplit={onResizeSplit}
              workspaceId={workspaceId}
            />
          </div>
        )}
        {firstVisible && secondVisible && (
          <SplitResizer
            splitId={node.id}
            direction={node.direction}
            ratio={node.ratio}
            containerRef={splitContainerRef}
            onResize={onResizeSplit}
          />
        )}
        {secondVisible && (
          <div
            className={styles.splitPane}
            style={
              firstVisible
                ? {
                    flexBasis: `${(1 - node.ratio) * 100}%`,
                  }
                : { flex: 1 }
            }
          >
            <PanelNodeView
              node={node.children[1]}
              maximizedPanelId={maximizedPanelId}
              editorOptions={editorOptions}
              onContextMenu={onContextMenu}
              onAssign={onAssign}
              onToggleMaximize={onToggleMaximize}
              onSplit={onSplit}
              onResizeSplit={onResizeSplit}
              workspaceId={workspaceId}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <PanelLeaf
      node={node}
      editorOptions={editorOptions}
      onContextMenu={onContextMenu}
      onAssign={onAssign}
      onToggleMaximize={onToggleMaximize}
      onSplit={onSplit}
      isMaximized={maximizedPanelId === node.id}
      workspaceId={workspaceId}
    />
  );
}

type SplitResizerProps = {
  splitId: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onResize: (splitId: string, ratio: number) => void;
};

/**
 * Render a draggable divider for a split node and report ratio changes while dragging.
 *
 * Attaches global pointer listeners during a drag to compute the new split ratio within the given container and calls `onResize` with the clamped ratio.
 *
 * @param splitId - Identifier of the split node being resized
 * @param direction - Resize axis; `"horizontal"` means vertical divider (moves along X), `"vertical"` means horizontal divider (moves along Y)
 * @param ratio - Current split ratio in the range [0.05, 0.95]
 * @param containerRef - Ref to the container element used to measure bounds for ratio calculation
 * @param onResize - Callback invoked with `(splitId, ratio)` when the divider is moved
 */
function SplitResizer({
  splitId,
  direction,
  ratio,
  containerRef,
  onResize,
}: SplitResizerProps) {
  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const handleMove = (moveEvent: MouseEvent) => {
      const raw =
        direction === "horizontal"
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height;
      onResize(splitId, clampRatio(raw));
    };

    const handleUp = () => {
      removeMove();
      removeUp();
    };

    const removeMove = addWindowEventListener("mousemove", handleMove);
    const removeUp = addWindowEventListener("mouseup", handleUp);
  };

  const resizerClass =
    direction === "horizontal"
      ? `${styles.splitResizer} ${styles.resizerVertical}`
      : `${styles.splitResizer} ${styles.resizerHorizontal}`;

  const style =
    direction === "horizontal"
      ? { left: `${ratio * 100}%` }
      : { top: `${ratio * 100}%` };

  return (
    <div className={resizerClass} style={style} onMouseDown={handleMouseDown} />
  );
}

type PanelLeafProps = {
  node: PanelLeafNode;
  editorOptions: EditorOption[];
  onContextMenu: (
    panelId: string,
    editorId: string,
    event: React.MouseEvent<HTMLDivElement>
  ) => void;
  onAssign: (panelId: string, editorId: string) => void;
  onToggleMaximize: (panelId: string) => void;
  onSplit: (
    panelId: string,
    direction: "horizontal" | "vertical",
    ratio: number
  ) => void;
  isMaximized: boolean;
  workspaceId: string;
};

/**
 * Render a single leaf panel that hosts an editor and provides UI for splitting,
 * assigning a different editor, maximizing/restoring, and a live split-drag preview.
 *
 * @param node - The leaf node describing this panel (id and editorId).
 * @param editorOptions - Available editor choices shown in the editor selector.
 * @param onContextMenu - Invoked when the panel's context menu is requested.
 * @param onAssign - Called with (panelId, editorId) to change the panel's editor.
 * @param onToggleMaximize - Called with (panelId) to toggle maximize/restore for this panel.
 * @param onSplit - Called with (panelId, direction, ratio) when a split is committed via drag.
 * @param isMaximized - Whether this panel is currently maximized.
 * @param workspaceId - Workspace scope used for panel instance context.
 * @returns A React element representing the interactive leaf panel.
 */
function PanelLeaf({
  node,
  editorOptions,
  onContextMenu,
  onAssign,
  onToggleMaximize,
  onSplit,
  isMaximized,
  workspaceId,
}: PanelLeafProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [splitPreview, setSplitPreview] = React.useState<{
    direction: "horizontal" | "vertical";
    ratio: number;
  } | null>(null);

  const dragState = React.useRef<{
    removeMove: (() => void) | null;
    removeUp: (() => void) | null;
  }>({
    removeMove: null,
    removeUp: null,
  });
  const [editorPickerOpen, setEditorPickerOpen] = React.useState(false);
  const selectRef = React.useRef<HTMLSelectElement | null>(null);

  const startSplitDrag = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const panelElement = panelRef.current;
      if (!panelElement) return;
      const rect = panelElement.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      let baseDirection: "horizontal" | "vertical" | null = null;
      let latestDirection: "horizontal" | "vertical" | null = null;
      let latestRatio = DEFAULT_RATIO;

      const handleMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!baseDirection) {
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
            return;
          }
          baseDirection =
            Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
        }
        const direction =
          moveEvent.shiftKey && baseDirection
            ? baseDirection === "horizontal"
              ? "vertical"
              : "horizontal"
            : baseDirection ?? "horizontal";
        const ratioRaw =
          direction === "horizontal"
            ? (moveEvent.clientX - rect.left) / rect.width
            : (moveEvent.clientY - rect.top) / rect.height;
        latestDirection = direction;
        latestRatio = clampRatio(ratioRaw);
        setSplitPreview({ direction, ratio: latestRatio });
      };

      function cleanup() {
        dragState.current.removeMove?.();
        dragState.current.removeUp?.();
        dragState.current.removeMove = null;
        dragState.current.removeUp = null;
        setSplitPreview(null);
      }

      const handleUp = () => {
        if (latestDirection) {
          onSplit(node.id, latestDirection, latestRatio);
        }
        cleanup();
      };

      dragState.current.removeMove = addWindowEventListener(
        "mousemove",
        handleMove,
      );
      dragState.current.removeUp = addWindowEventListener("mouseup", handleUp);
    },
    [onSplit, node.id]
  );

  React.useEffect(() => {
    return () => {
      dragState.current.removeMove?.();
      dragState.current.removeUp?.();
    };
  }, []);

  const entry = getEditorEntry(node.editorId);
  const Component = entry.Component;

  return (
    <PanelInstanceProvider panelId={node.id} workspaceId={workspaceId}>
      <div
        className={styles.panelLeaf}
        ref={panelRef}
        onContextMenu={(event) => onContextMenu(node.id, node.editorId, event)}
      >
        {splitPreview && (
          <div
            className={`${styles.splitPreview} ${
              splitPreview.direction === "horizontal"
                ? styles.previewHorizontal
                : styles.previewVertical
            }`}
            style={
              splitPreview.direction === "horizontal"
                ? { left: `${splitPreview.ratio * 100}%` }
                : { top: `${splitPreview.ratio * 100}%` }
            }
          />
        )}

        <div className={styles.panelOverlay}>
          {editorPickerOpen ? (
            <select
              ref={selectRef}
              className={styles.panelSelector}
              value={node.editorId}
              onChange={(event) => {
                onAssign(node.id, event.target.value);
                setEditorPickerOpen(false);
              }}
              onBlur={() => setEditorPickerOpen(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setEditorPickerOpen(false);
                  selectRef.current?.blur();
                }
              }}
            >
              {editorOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <button
              className={styles.panelSelectorButton}
              onClick={(event) => {
                event.stopPropagation();
                setEditorPickerOpen(true);
                requestAnimationFrame(() => selectRef.current?.focus());
              }}
              aria-label="Open editor selector"
              title="Switch editor"
            >
              ▾
            </button>
          )}
          <button
            className={styles.panelHandle}
            title={`Drag to split • Double-click to ${
              isMaximized ? "restore" : "maximize"
            }`}
            onMouseDown={startSplitDrag}
            onDoubleClick={() => onToggleMaximize(node.id)}
          >
            ▣
          </button>
        </div>

        <div className={styles.panelBody}>
          <PanelErrorBoundary
            editorId={entry.id}
            onRetry={() => setSplitPreview(null)}
          >
            <React.Suspense
              fallback={<div className={styles.panelLoading}>Loading…</div>}
            >
              <Component />
            </React.Suspense>
          </PanelErrorBoundary>
        </div>
      </div>
    </PanelInstanceProvider>
  );
}
