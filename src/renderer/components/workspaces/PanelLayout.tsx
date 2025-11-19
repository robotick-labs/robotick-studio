import React from "react";
import { getEditorEntry, listEditorEntries } from "../../services/EditorRegistry";
import styles from "./PanelLayout.module.css";

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

type ContextMenuState = {
  panelId: string;
  x: number;
  y: number;
  horizontalRatio: number;
  verticalRatio: number;
};

type EditorOption = {
  id: string;
  label: string;
};

let panelIdCounter = 0;
function generatePanelId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
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

function sanitizeNode(
  raw: unknown,
  fallbackEditorId: string,
  allowedEditors: Set<string>,
): PanelNode | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (data.kind === "leaf") {
    const editorId = typeof data.editorId === "string" ? data.editorId : null;
    const resolvedEditor = editorId && allowedEditors.has(editorId)
      ? editorId
      : fallbackEditorId;
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
      allowedEditors,
    );
    const second = sanitizeNode(
      data.children[1],
      fallbackEditorId,
      allowedEditors,
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

function loadLayout(
  workspaceId: string,
  fallbackEditorId: string,
  allowedEditors: Set<string>,
): PanelNode {
  if (typeof window === "undefined") {
    return createLeaf(fallbackEditorId);
  }
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${workspaceId}`);
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

function saveLayout(workspaceId: string, layout: PanelNode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${workspaceId}`,
      JSON.stringify(layout),
    );
  } catch {
    // Ignore write failures (e.g., storage disabled)
  }
}

function updateNode(
  node: PanelNode,
  targetId: string,
  updater: (leaf: PanelLeafNode) => PanelNode,
): PanelNode {
  if (node.kind === "leaf") {
    if (node.id !== targetId) {
      return node;
    }
    return updater(node);
  }

  const first = updateNode(node.children[0], targetId, updater);
  const second = updateNode(node.children[1], targetId, updater);
  if (
    first === node.children[0] &&
    second === node.children[1]
  ) {
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

function updateSplitRatio(
  node: PanelNode,
  splitId: string,
  ratio: number,
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
    [editorEntries],
  );

  const allowedIdsKey = editorEntries.map((entry) => entry.id).join("|");
  const allowedIdSet = React.useMemo(
    () => new Set(editorEntries.map((entry) => entry.id)),
    [allowedIdsKey],
  );

  const fallbackEditorId = allowedIdSet.has(defaultEditorId)
    ? defaultEditorId
    : editorEntries[0].id;

  const [layout, setLayout] = React.useState<PanelNode>(() =>
    loadLayout(workspaceId, fallbackEditorId, allowedIdSet),
  );
  const [maximizedPanelId, setMaximizedPanelId] = React.useState<string | null>(
    null,
  );
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(
    null,
  );

  React.useEffect(() => {
    setLayout(loadLayout(workspaceId, fallbackEditorId, allowedIdSet));
    setMaximizedPanelId(null);
  }, [workspaceId, fallbackEditorId, allowedIdsKey]);

  React.useEffect(() => {
    saveLayout(workspaceId, layout);
  }, [workspaceId, layout]);

  React.useEffect(() => {
    if (
      maximizedPanelId &&
      !nodeContains(layout, maximizedPanelId)
    ) {
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
          children: [
            createLeaf(leaf.editorId),
            createLeaf(leaf.editorId),
          ],
        })),
      );
    },
    [],
  );

  const onAssign = React.useCallback((panelId: string, editorId: string) => {
    setLayout((current) =>
      updateNode(current, panelId, (leaf) => ({
        ...leaf,
        editorId,
      })),
    );
  }, []);

  const onClosePanel = React.useCallback(
    (panelId: string) => {
      setLayout((current) => {
        const result = removePanel(current, panelId);
        if (!result) {
          return current;
        }
        return result;
      });
    },
    [],
  );

  const onToggleMaximize = React.useCallback(
    (panelId: string) => {
      setMaximizedPanelId((current) =>
        current === panelId ? null : panelId,
      );
    },
    [],
  );

  const onResizeSplit = React.useCallback((splitId: string, ratio: number) => {
    setLayout((current) => updateSplitRatio(current, splitId, ratio));
  }, []);

  const resetLayout = React.useCallback(() => {
    const fresh = createLeaf(fallbackEditorId);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${workspaceId}`);
    }
    setLayout(fresh);
    setMaximizedPanelId(null);
  }, [fallbackEditorId, workspaceId]);

  const handleContextMenu = React.useCallback(
    (panelId: string, event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const horizontalRatio = rect.width
        ? (event.clientX - rect.left) / rect.width
        : DEFAULT_RATIO;
      const verticalRatio = rect.height
        ? (event.clientY - rect.top) / rect.height
        : DEFAULT_RATIO;
      setContextMenu({
        panelId,
        x: event.clientX,
        y: event.clientY,
        horizontalRatio: clampRatio(horizontalRatio),
        verticalRatio: clampRatio(verticalRatio),
      });
    },
    [],
  );

  const leafTotal = React.useMemo(() => countLeaves(layout), [layout]);

  return (
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
      />

      {contextMenu && (
        <PanelContextMenu
          state={contextMenu}
          editorOptions={editorOptions}
          canClose={leafTotal > 1}
          isMaximized={maximizedPanelId === contextMenu.panelId}
          onSplitHorizontal={(ratio) =>
            onSplit(contextMenu.panelId, "horizontal", ratio)
          }
          onSplitVertical={(ratio) =>
            onSplit(contextMenu.panelId, "vertical", ratio)
          }
          onAssign={(editorId) => onAssign(contextMenu.panelId, editorId)}
          onToggleMaximize={() => onToggleMaximize(contextMenu.panelId)}
          onResetLayout={resetLayout}
          onClose={() => setContextMenu(null)}
          onClosePanel={() => onClosePanel(contextMenu.panelId)}
        />
      )}
    </div>
  );
}

type PanelNodeViewProps = {
  node: PanelNode;
  maximizedPanelId: string | null;
  editorOptions: EditorOption[];
  onContextMenu: (
    panelId: string,
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  onAssign: (panelId: string, editorId: string) => void;
  onToggleMaximize: (panelId: string) => void;
  onSplit: (panelId: string, direction: "horizontal" | "vertical", ratio: number) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
};

function PanelNodeView({
  node,
  maximizedPanelId,
  editorOptions,
  onContextMenu,
  onAssign,
  onToggleMaximize,
  onSplit,
  onResizeSplit,
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
    />
  );
}

type SplitResizerProps = {
  splitId: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  containerRef: React.RefObject<HTMLDivElement>;
  onResize: (splitId: string, ratio: number) => void;
};

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
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
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
    <div
      className={resizerClass}
      style={style}
      onMouseDown={handleMouseDown}
    />
  );
}

type PanelLeafProps = {
  node: PanelLeafNode;
  editorOptions: EditorOption[];
  onContextMenu: (
    panelId: string,
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  onAssign: (panelId: string, editorId: string) => void;
  onToggleMaximize: (panelId: string) => void;
  onSplit: (panelId: string, direction: "horizontal" | "vertical", ratio: number) => void;
};

function PanelLeaf({
  node,
  editorOptions,
  onContextMenu,
  onAssign,
  onToggleMaximize,
  onSplit,
}: PanelLeafProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [splitPreview, setSplitPreview] = React.useState<{
    direction: "horizontal" | "vertical";
    ratio: number;
  } | null>(null);

  const dragState = React.useRef<{
    moveHandler: ((event: MouseEvent) => void) | null;
    upHandler: (() => void) | null;
  }>({
    moveHandler: null,
    upHandler: null,
  });

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
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        dragState.current.moveHandler = null;
        dragState.current.upHandler = null;
        setSplitPreview(null);
      }

      const handleUp = () => {
        if (latestDirection) {
          onSplit(node.id, latestDirection, latestRatio);
        }
        cleanup();
      };

      dragState.current.moveHandler = handleMove;
      dragState.current.upHandler = handleUp;
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [onSplit, node.id],
  );

  React.useEffect(() => {
    return () => {
      if (dragState.current.moveHandler && dragState.current.upHandler) {
        window.removeEventListener("mousemove", dragState.current.moveHandler);
        window.removeEventListener("mouseup", dragState.current.upHandler);
      }
    };
  }, []);

  const entry = getEditorEntry(node.editorId);
  const Component = entry.Component;

  return (
    <div
      className={styles.panelLeaf}
      ref={panelRef}
      onContextMenu={(event) => onContextMenu(node.id, event)}
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
        <select
          className={styles.panelSelector}
          value={node.editorId}
          onChange={(event) => onAssign(node.id, event.target.value)}
        >
          {editorOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className={styles.panelHandle}
          title="Drag to split • Double-click to maximize"
          onMouseDown={startSplitDrag}
          onDoubleClick={() => onToggleMaximize(node.id)}
        >
          ▣
        </button>
      </div>

      <div className={styles.panelBody}>
        <React.Suspense fallback={<div className={styles.panelLoading}>Loading…</div>}>
          <Component />
        </React.Suspense>
      </div>
    </div>
  );
}

type PanelContextMenuProps = {
  state: ContextMenuState;
  editorOptions: EditorOption[];
  canClose: boolean;
  isMaximized: boolean;
  onSplitHorizontal: (ratio: number) => void;
  onSplitVertical: (ratio: number) => void;
  onAssign: (editorId: string) => void;
  onToggleMaximize: () => void;
  onClosePanel: () => void;
  onResetLayout: () => void;
  onClose: () => void;
};

function PanelContextMenu({
  state,
  editorOptions,
  canClose,
  isMaximized,
  onSplitHorizontal,
  onSplitVertical,
  onAssign,
  onToggleMaximize,
  onClosePanel,
  onResetLayout,
  onClose,
}: PanelContextMenuProps) {
  React.useEffect(() => {
    const close = () => onClose();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      className={styles.contextMenu}
      style={{ left: state.x, top: state.y }}
      role="menu"
    >
      <button
        className={styles.contextMenuItem}
        onClick={() => {
          onSplitHorizontal(state.horizontalRatio);
          onClose();
        }}
      >
        Split Horizontally
      </button>
      <button
        className={styles.contextMenuItem}
        onClick={() => {
          onSplitVertical(state.verticalRatio);
          onClose();
        }}
      >
        Split Vertically
      </button>

      <div className={styles.contextMenuDivider} />

      <div className={styles.contextMenuHeading}>Assign Tool</div>
      <div className={styles.contextMenuAssignments}>
        {editorOptions.map((option) => (
          <button
            key={option.id}
            className={styles.contextMenuItem}
            onClick={() => {
              onAssign(option.id);
              onClose();
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={styles.contextMenuDivider} />

      <button
        className={styles.contextMenuItem}
        onClick={() => {
          onToggleMaximize();
          onClose();
        }}
      >
        {isMaximized ? "Restore Panel Size" : "Maximize Panel"}
      </button>

      <button
        className={styles.contextMenuItem}
        disabled={!canClose}
        onClick={() => {
          onClosePanel();
          onClose();
        }}
      >
        Close Panel
      </button>

      <div className={styles.contextMenuDivider} />

      <button
        className={styles.contextMenuItem}
        onClick={() => {
          onResetLayout();
          onClose();
        }}
      >
        Reset Layout
      </button>
    </div>
  );
}
