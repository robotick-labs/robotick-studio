import React from "react";
import {
  useEditorRegistry,
} from "../../services/EditorRegistry";
import {
  clearFloatingPanels,
  FloatingPanelLayer,
  FloatingPanelsScopeProvider,
  replaceFloatingPanels,
  spawnFloatingPanel,
  subscribeFloatingPanels,
  type FloatingPanelRecord,
} from "./floating-panels";
import {
  PANEL_CONTEXT_MENU_ACTIONS_EVENT,
  type PanelContextMenuAction,
  type PanelContextMenuActionsEventDetail,
  type PanelContextMenuState,
} from "./PanelContextMenu";
import { useContextMenu } from "../context-menu/ContextMenuProvider";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import { PanelInstanceProvider } from "./PanelInstanceContext";
import { GenericDialog } from "../dialog/GenericDialog";
import styles from "./PanelLayout.module.css";
import { addWindowEventListener } from "../../utils/domEnvironment";
import { useProjectContext } from "../../data-sources/launcher/internal/ProjectContext";
import {
  getBrowserStudioPersistenceStore,
  loadStudioPersistence,
  writeStudioDocument,
  type StudioFloatingPanelInstance,
  type StudioPersistenceModel,
} from "../../services/studio-persistence";
import {
  applyWorkbenchLayoutState,
  buildLayoutResourceId,
  findLayoutResource,
  loadWorkbenchLayoutState,
  panelNodeFromResource,
  type PersistedPanelNode,
} from "./panel-layout-persistence";

type PanelLeafNode = {
  id: string;
  kind: "leaf";
  editorId: string;
  settings?: Record<string, unknown>;
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
const LAYOUT_TABS_STORAGE_PREFIX = "workbench-layout-tabs:";
const DEFAULT_WINDOW_SCOPE = "main";
const DEFAULT_LAYOUT_TAB_ID = "default";
const DEFAULT_LAYOUT_TAB_NAME = "Default";
const DEFAULT_RATIO = 0.5;
const MIN_RATIO = 0.05;
const MAX_RATIO = 0.85;
const PANEL_CONTEXT_MENU_TAP_MAX_MS = 100;
const PANEL_RMB_GESTURE_SUPPRESS_SELECTOR = "[data-suppress-panel-rmb-menu='active']";

function collectEditorContextMenuActions(
  event: React.MouseEvent<HTMLDivElement>
): PanelContextMenuAction[] {
  const target = event.target as Element | null;
  if (!target) return [];
  const actions: PanelContextMenuAction[] = [];
  target.dispatchEvent(
    new CustomEvent<PanelContextMenuActionsEventDetail>(
      PANEL_CONTEXT_MENU_ACTIONS_EVENT,
      {
        bubbles: true,
        detail: {
          actions,
          target,
          clientX: event.clientX,
          clientY: event.clientY,
        },
      }
    )
  );
  return actions;
}

type PanelLayoutProps = {
  workbenchId: string;
  workbenchLabel?: string;
  defaultEditorId: string;
  allowedEditors?: string[];
  windowScope?: string;
};

type EditorOption = {
  id: string;
  label: string;
};

type WorkbenchLayoutTab = {
  id: string;
  name: string;
};

type WorkbenchLayoutTabsState = {
  storageKey: string;
  tabs: WorkbenchLayoutTab[];
  activeTabId: string;
};

type PanelLayoutState = {
  storageKey: string;
  node: PanelNode;
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

function generateLayoutTabId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `layout-${Math.random().toString(36).slice(2, 9)}`;
}

function clampRatio(value: number) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

function getLayoutTabsStorageKey(windowScope: string, workbenchId: string) {
  return `${LAYOUT_TABS_STORAGE_PREFIX}${windowScope}:${workbenchId}`;
}

function getPanelLayoutStorageKey(
  windowScope: string,
  workbenchId: string,
  layoutTabId: string
) {
  return `${STORAGE_PREFIX}${windowScope}:${workbenchId}:${layoutTabId}`;
}

function getFloatingPanelScope(
  windowScope: string,
  workbenchId: string,
  layoutTabId: string
) {
  return `${windowScope}:${workbenchId}:${layoutTabId}`;
}

function getDefaultLayoutTabName(workbenchLabel?: string): string {
  const label = workbenchLabel?.trim();
  return label
    ? `${label} | ${DEFAULT_LAYOUT_TAB_NAME}`
    : DEFAULT_LAYOUT_TAB_NAME;
}

function createDefaultLayoutTab(workbenchLabel?: string): WorkbenchLayoutTab {
  return {
    id: DEFAULT_LAYOUT_TAB_ID,
    name: getDefaultLayoutTabName(workbenchLabel),
  };
}

function getNewLayoutTabName(index: number, workbenchLabel?: string): string {
  const label = workbenchLabel?.trim();
  return label ? `${label} | New Layout ${index}` : `New Layout ${index}`;
}

function createLeaf(editorId: string): PanelLeafNode {
  return { id: generatePanelId(), kind: "leaf", editorId, settings: {} };
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

function panelSettingsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!panelSettingsEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftEntries = Object.entries(left);
    const rightEntries = Object.entries(right);
    if (leftEntries.length !== rightEntries.length) {
      return false;
    }
    for (const [key, value] of leftEntries) {
      if (!panelSettingsEqual(value, (right as Record<string, unknown>)[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function toFloatingPanelRecords(
  panels: StudioFloatingPanelInstance[]
): FloatingPanelRecord[] {
  return panels.map((panel) => ({
    id: panel.id,
    editorId: panel.editorId,
    title: panel.label,
    settings: { ...(panel.settings ?? {}) },
    frame: { ...panel.frame },
  }));
}

function toStudioFloatingPanels(
  panels: FloatingPanelRecord[]
): StudioFloatingPanelInstance[] {
  return panels.map((panel) => ({
    id: panel.id,
    editorId: panel.editorId,
    label: panel.title,
    settings: { ...panel.settings },
    frame: {
      x: panel.frame?.x ?? 160,
      y: panel.frame?.y ?? 160,
      width: panel.frame?.width ?? 640,
      height: panel.frame?.height ?? 400,
      minWidth: panel.frame?.minWidth,
      minHeight: panel.frame?.minHeight,
    },
  }));
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
 * Render a workbench-scoped, persistent panel layout that hosts editor instances and provides splitting, resizing, assignment, closing, maximizing, and floating-panel operations.
 *
 * The component loads and persists the layout per `workbenchId`, enforces `allowedEditors` when provided, and exposes interactive behaviors (split, assign editor, close, resize splits, toggle maximize, reset layout, and spawn floating panels) via UI controls and a context menu.
 *
 * @returns The React element for the panel layout UI
 */
export function PanelLayout({
  workbenchId,
  workbenchLabel,
  defaultEditorId,
  allowedEditors,
  windowScope = DEFAULT_WINDOW_SCOPE,
}: PanelLayoutProps) {
  const { projectPath } = useProjectContext();
  const studioPersistenceStore = getBrowserStudioPersistenceStore();
  const studioPersistenceEnabled =
    Boolean(projectPath) && studioPersistenceStore !== null;
  const resourceModelRef = React.useRef<StudioPersistenceModel | null>(null);
  const persistenceHydratingRef = React.useRef(false);
  const { listEditorEntries, loading: registryLoading } = useEditorRegistry();
  const editorEntries = React.useMemo(() => {
    const entries = listEditorEntries();
    if (!allowedEditors || allowedEditors.length === 0) {
      return entries;
    }
    const allowed = new Set(allowedEditors);
    return entries.filter((entry) => allowed.has(entry.id));
  }, [allowedEditors, listEditorEntries]);

  if (!editorEntries.length) {
    throw new Error("No editors are registered for the panel layout");
  }

  const editorOptions: EditorOption[] = React.useMemo(
    () =>
      editorEntries
        .map((entry) => ({
          id: entry.id,
          label: entry.label,
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
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

  const layoutTabsStorageKey = React.useMemo(
    () => getLayoutTabsStorageKey(windowScope, workbenchId),
    [windowScope, workbenchId]
  );
  const [layoutTabsState, setLayoutTabsState] =
    React.useState<WorkbenchLayoutTabsState>(() => ({
      storageKey: layoutTabsStorageKey,
      tabs: [createDefaultLayoutTab(workbenchLabel)],
      activeTabId: DEFAULT_LAYOUT_TAB_ID,
    }));
  const activeLayoutTabId =
    layoutTabsState.storageKey === layoutTabsStorageKey
      ? layoutTabsState.activeTabId
      : DEFAULT_LAYOUT_TAB_ID;
  const activeLayoutResourceId = React.useMemo(
    () => buildLayoutResourceId(windowScope, workbenchId, activeLayoutTabId),
    [activeLayoutTabId, windowScope, workbenchId]
  );
  const visibleLayoutTabs =
    layoutTabsState.storageKey === layoutTabsStorageKey
      ? layoutTabsState.tabs
      : [createDefaultLayoutTab(workbenchLabel)];
  const panelLayoutStorageKey = React.useMemo(
    () =>
      getPanelLayoutStorageKey(windowScope, workbenchId, activeLayoutTabId),
    [windowScope, workbenchId, activeLayoutTabId]
  );
  const floatingPanelScope = React.useMemo(
    () => getFloatingPanelScope(windowScope, workbenchId, activeLayoutTabId),
    [windowScope, workbenchId, activeLayoutTabId]
  );
  const [floatingPanelsState, setFloatingPanelsState] = React.useState<
    StudioFloatingPanelInstance[]
  >([]);
  const [persistenceLoaded, setPersistenceLoaded] = React.useState(false);
  const [layoutState, setLayoutState] = React.useState<PanelLayoutState>(() => ({
    storageKey: panelLayoutStorageKey,
    node: createLeaf(fallbackEditorId),
  }));
  const layoutTabsStateRef = React.useRef(layoutTabsState);
  const layoutStateRef = React.useRef(layoutState);
  const floatingPanelsStateRef = React.useRef(floatingPanelsState);
  const pendingActivatedPanelRef = React.useRef<{
    layoutId: string;
    panelId: string;
  } | null>(null);
  const layout = layoutState.node;
  const currentLayoutStateKey = studioPersistenceEnabled
    ? activeLayoutResourceId
    : panelLayoutStorageKey;
  const layoutReady = layoutState.storageKey === currentLayoutStateKey;
  const setCurrentLayout = React.useCallback(
    (updater: (current: PanelNode) => PanelNode) => {
      setLayoutState((current) => {
        if (current.storageKey !== currentLayoutStateKey) {
          return current;
        }
        return {
          storageKey: current.storageKey,
          node: updater(current.node),
        };
      });
    },
    [currentLayoutStateKey]
  );
  const [maximizedPanelId, setMaximizedPanelId] = React.useState<string | null>(
    null
  );
  const [editingLayoutTab, setEditingLayoutTab] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const [draggingLayoutTabId, setDraggingLayoutTabId] =
    React.useState<string | null>(null);
  const [layoutTabDropIndicator, setLayoutTabDropIndicator] = React.useState<{
    targetId: string;
    position: "before" | "after";
  } | null>(null);
  const [layoutTabPendingClose, setLayoutTabPendingClose] =
    React.useState<WorkbenchLayoutTab | null>(null);
  const draggingLayoutTabIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    layoutTabsStateRef.current = layoutTabsState;
  }, [layoutTabsState]);

  React.useEffect(() => {
    layoutStateRef.current = layoutState;
  }, [layoutState]);

  React.useEffect(() => {
    floatingPanelsStateRef.current = floatingPanelsState;
  }, [floatingPanelsState]);

  const persistCurrentLayoutSnapshot = React.useCallback(() => {
    if (
      !persistenceLoaded ||
      registryLoading ||
      persistenceHydratingRef.current ||
      !studioPersistenceEnabled ||
      !projectPath ||
      !studioPersistenceStore
    ) {
      return resourceModelRef.current;
    }
    const currentTabsState = layoutTabsStateRef.current;
    const currentTabs =
      currentTabsState.storageKey === layoutTabsStorageKey
        ? currentTabsState.tabs
        : [createDefaultLayoutTab(workbenchLabel)];
    const currentActiveTabId =
      currentTabsState.storageKey === layoutTabsStorageKey
        ? currentTabsState.activeTabId
        : DEFAULT_LAYOUT_TAB_ID;
    const nextModel = applyWorkbenchLayoutState({
      model: resourceModelRef.current,
      workbenchId,
      workbenchLabel,
      windowScope,
      tabs: currentTabs.map((tab) => ({
        id: tab.id,
        name: tab.name,
        layoutId: buildLayoutResourceId(windowScope, workbenchId, tab.id),
      })),
      activeTabId: currentActiveTabId,
      layoutNode: layoutStateRef.current.node as PersistedPanelNode,
      floatingPanels: floatingPanelsStateRef.current,
      fallbackEditorId,
    });
    resourceModelRef.current = nextModel;
    void writeStudioDocument(projectPath, studioPersistenceStore, nextModel);
    return nextModel;
  }, [
    fallbackEditorId,
    layoutTabsStorageKey,
    persistenceLoaded,
    projectPath,
    registryLoading,
    studioPersistenceEnabled,
    studioPersistenceStore,
    windowScope,
    workbenchId,
    workbenchLabel,
  ]);

  const hydrateActiveLayout = React.useCallback(
    (tabId: string, model = resourceModelRef.current) => {
      const layoutId = buildLayoutResourceId(windowScope, workbenchId, tabId);
      const activeLayout = findLayoutResource(
        model,
        workbenchId,
        windowScope,
        layoutId
      );
      setLayoutState({
        storageKey: layoutId,
        node: activeLayout
          ? (panelNodeFromResource(
              activeLayout,
              fallbackEditorId,
              allowedIdSet,
              generatePanelId
            ) as PanelNode)
          : createLeaf(fallbackEditorId),
      });
      const nextFloatingPanels = activeLayout?.floatingPanels ?? [];
      setFloatingPanelsState(nextFloatingPanels);
      replaceFloatingPanels(
        getFloatingPanelScope(windowScope, workbenchId, tabId),
        toFloatingPanelRecords(nextFloatingPanels)
      );
      setMaximizedPanelId(null);
    },
    [allowedIdSet, fallbackEditorId, windowScope, workbenchId]
  );
  React.useEffect(() => {
    let cancelled = false;
    persistenceHydratingRef.current = true;
    setPersistenceLoaded(false);

    if (!studioPersistenceEnabled || !projectPath || !studioPersistenceStore) {
      const nextTabs: WorkbenchLayoutTabsState = {
        storageKey: layoutTabsStorageKey,
        tabs: [createDefaultLayoutTab(workbenchLabel)],
        activeTabId: DEFAULT_LAYOUT_TAB_ID,
      };
      setLayoutTabsState(nextTabs);
      setLayoutState({
        storageKey: getPanelLayoutStorageKey(
          windowScope,
          workbenchId,
          DEFAULT_LAYOUT_TAB_ID
        ),
        node: createLeaf(fallbackEditorId),
      });
      setFloatingPanelsState([]);
      replaceFloatingPanels(
        getFloatingPanelScope(windowScope, workbenchId, DEFAULT_LAYOUT_TAB_ID),
        []
      );
      setMaximizedPanelId(null);
      persistenceHydratingRef.current = false;
      setPersistenceLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    void loadStudioPersistence(projectPath, studioPersistenceStore)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        const workbenchState = loadWorkbenchLayoutState({
          model: loaded.model,
          workbenchId,
          workbenchLabel,
          windowScope,
          fallbackEditorId,
          allowedEditors: allowedIdSet,
          createPanelId: generatePanelId,
        });
        resourceModelRef.current = workbenchState.model;
        setLayoutTabsState({
          storageKey: layoutTabsStorageKey,
          tabs: workbenchState.tabs.map((tab) => ({
            id: tab.id,
            name: tab.name,
          })),
          activeTabId: workbenchState.activeTabId,
        });
        setLayoutState({
          storageKey: workbenchState.activeLayout.id,
          node: panelNodeFromResource(
            workbenchState.activeLayout,
            fallbackEditorId,
            allowedIdSet,
            generatePanelId
          ) as PanelNode,
        });
        const nextScope = getFloatingPanelScope(
          windowScope,
          workbenchId,
          workbenchState.activeTabId
        );
        setFloatingPanelsState(workbenchState.floatingPanels);
        replaceFloatingPanels(
          nextScope,
          toFloatingPanelRecords(workbenchState.floatingPanels)
        );
        setMaximizedPanelId(null);
        persistenceHydratingRef.current = false;
        setPersistenceLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          persistenceHydratingRef.current = false;
          setPersistenceLoaded(true);
        }
      });

    return () => {
      cancelled = true;
      persistenceHydratingRef.current = false;
    };
  }, [
    allowedIdsKey,
    fallbackEditorId,
    layoutTabsStorageKey,
    projectPath,
    studioPersistenceEnabled,
    studioPersistenceStore,
    windowScope,
    workbenchLabel,
    workbenchId,
  ]);

  React.useEffect(() => {
    return subscribeFloatingPanels(floatingPanelScope, (panels) => {
      setFloatingPanelsState(toStudioFloatingPanels(panels));
    });
  }, [floatingPanelScope]);

  React.useEffect(() => {
    if (studioPersistenceEnabled || layoutState.storageKey === panelLayoutStorageKey) {
      return;
    }
    setLayoutState({
      storageKey: panelLayoutStorageKey,
      node: createLeaf(fallbackEditorId),
    });
    setFloatingPanelsState([]);
    replaceFloatingPanels(floatingPanelScope, []);
    setMaximizedPanelId(null);
  }, [
    activeLayoutTabId,
    allowedIdsKey,
    fallbackEditorId,
    floatingPanelScope,
    layoutState.storageKey,
    panelLayoutStorageKey,
    studioPersistenceEnabled,
  ]);

  React.useEffect(() => {
    if (!studioPersistenceEnabled || !persistenceLoaded) {
      return;
    }
    const activeLayout = findLayoutResource(
      resourceModelRef.current,
      workbenchId,
      windowScope,
      activeLayoutResourceId
    );
    if (!activeLayout) {
      replaceFloatingPanels(floatingPanelScope, []);
      setFloatingPanelsState([]);
      return;
    }
    setLayoutState({
      storageKey: activeLayout.id,
      node: panelNodeFromResource(
        activeLayout,
        fallbackEditorId,
        allowedIdSet,
        generatePanelId
      ) as PanelNode,
    });
    setFloatingPanelsState(activeLayout.floatingPanels ?? []);
    replaceFloatingPanels(
      floatingPanelScope,
      toFloatingPanelRecords(activeLayout.floatingPanels ?? [])
    );
    setMaximizedPanelId(null);
  }, [
    activeLayoutResourceId,
    allowedIdsKey,
    fallbackEditorId,
    floatingPanelScope,
    layoutState.storageKey,
    persistenceLoaded,
    studioPersistenceEnabled,
  ]);

  React.useEffect(() => {
    if (!studioPersistenceEnabled || !projectPath || !studioPersistenceStore) {
      return;
    }
    if (!studioPersistenceStore.onDocumentChanged) {
      return;
    }
    return studioPersistenceStore.onDocumentChanged((changedProjectPath) => {
      if (changedProjectPath !== projectPath) {
        return;
      }
      void loadStudioPersistence(projectPath, studioPersistenceStore).then(
        (loaded) => {
          resourceModelRef.current = loaded.model;
        }
      );
    });
  }, [
    projectPath,
    studioPersistenceEnabled,
    studioPersistenceStore,
  ]);

  React.useEffect(() => {
    if (
      !persistenceLoaded ||
      !layoutReady ||
      registryLoading ||
      persistenceHydratingRef.current
    ) {
      return;
    }
    if (!studioPersistenceEnabled || !projectPath || !studioPersistenceStore) {
      return;
    }
    const nextModel = applyWorkbenchLayoutState({
      model: resourceModelRef.current,
      workbenchId,
      workbenchLabel,
      windowScope,
      tabs: visibleLayoutTabs.map((tab) => ({
        id: tab.id,
        name: tab.name,
        layoutId: buildLayoutResourceId(windowScope, workbenchId, tab.id),
      })),
      activeTabId: activeLayoutTabId,
      layoutNode: layoutState.node as PersistedPanelNode,
      floatingPanels: floatingPanelsState,
      fallbackEditorId,
    });
    resourceModelRef.current = nextModel;
    void writeStudioDocument(projectPath, studioPersistenceStore, nextModel);
  }, [
    activeLayoutTabId,
    fallbackEditorId,
    floatingPanelsState,
    layoutReady,
    layoutState,
    layoutTabsState,
    layoutTabsStorageKey,
    persistenceLoaded,
    projectPath,
    registryLoading,
    studioPersistenceEnabled,
    studioPersistenceStore,
    visibleLayoutTabs,
    windowScope,
    workbenchId,
    workbenchLabel,
  ]);

  React.useEffect(() => {
    if (maximizedPanelId && !nodeContains(layout, maximizedPanelId)) {
      setMaximizedPanelId(null);
    }
  }, [layout, maximizedPanelId]);

  React.useEffect(() => {
    const pending = pendingActivatedPanelRef.current;
    if (
      !pending ||
      pending.layoutId !== activeLayoutResourceId ||
      !nodeContains(layout, pending.panelId)
    ) {
      return;
    }
    pendingActivatedPanelRef.current = null;
    setMaximizedPanelId(pending.panelId);
  }, [activeLayoutResourceId, layout]);

  React.useEffect(() => {
    if (
      editingLayoutTab &&
      !visibleLayoutTabs.some((tab) => tab.id === editingLayoutTab.id)
    ) {
      setEditingLayoutTab(null);
    }
  }, [editingLayoutTab, visibleLayoutTabs]);

  React.useEffect(() => {
    if (
      layoutTabPendingClose &&
      !visibleLayoutTabs.some((tab) => tab.id === layoutTabPendingClose.id)
    ) {
      setLayoutTabPendingClose(null);
    }
  }, [layoutTabPendingClose, visibleLayoutTabs]);

  const onSplit = React.useCallback(
    (panelId: string, direction: "horizontal" | "vertical", ratio: number) => {
      setCurrentLayout((current) =>
        updateNode(current, panelId, (leaf) => ({
          id: leaf.id,
          kind: "split",
          direction,
          ratio: clampRatio(ratio || DEFAULT_RATIO),
          children: [createLeaf(leaf.editorId), createLeaf(leaf.editorId)],
        }))
      );
    },
    [setCurrentLayout]
  );

  const onAssign = React.useCallback((panelId: string, editorId: string) => {
    setCurrentLayout((current) =>
      updateNode(current, panelId, (leaf) => ({
        ...leaf,
        editorId,
        settings: {},
      }))
    );
  }, [setCurrentLayout]);

  const onSetPanelSettings = React.useCallback(
    (panelId: string, settings: Record<string, unknown>) => {
      setCurrentLayout((current) =>
        updateNode(current, panelId, (leaf) => {
          if (panelSettingsEqual(leaf.settings ?? {}, settings)) {
            return leaf;
          }
          return {
            ...leaf,
            settings: { ...settings },
          };
        })
      );
    },
    [setCurrentLayout]
  );

  const onUpdatePanelSettings = React.useCallback(
    (panelId: string, partial: Record<string, unknown>) => {
      setCurrentLayout((current) =>
        updateNode(current, panelId, (leaf) => {
          const nextSettings = {
            ...(leaf.settings ?? {}),
            ...partial,
          };
          if (panelSettingsEqual(leaf.settings ?? {}, nextSettings)) {
            return leaf;
          }
          return {
            ...leaf,
            settings: nextSettings,
          };
        })
      );
    },
    [setCurrentLayout]
  );

  const onClosePanel = React.useCallback((panelId: string) => {
    setCurrentLayout((current) => {
      const result = removePanel(current, panelId);
      if (!result) {
        return current;
      }
      return result;
    });
  }, [setCurrentLayout]);

  const onToggleMaximize = React.useCallback((panelId: string) => {
    setMaximizedPanelId((current) => (current === panelId ? null : panelId));
  }, []);

  const onResizeSplit = React.useCallback((splitId: string, ratio: number) => {
    setCurrentLayout((current) => updateSplitRatio(current, splitId, ratio));
  }, [setCurrentLayout]);

  const resetLayout = React.useCallback(() => {
    const fresh = createLeaf(fallbackEditorId);
    clearFloatingPanels(floatingPanelScope);
    setFloatingPanelsState([]);
    setLayoutState({
      storageKey: currentLayoutStateKey,
      node: fresh,
    });
    setMaximizedPanelId(null);
  }, [
    currentLayoutStateKey,
    fallbackEditorId,
    floatingPanelScope,
  ]);

  const handleSelectLayoutTab = React.useCallback(
    (tabId: string) => {
      const nextModel = persistCurrentLayoutSnapshot();
      hydrateActiveLayout(tabId, nextModel);
      setLayoutTabsState((current) => {
        if (
          current.storageKey !== layoutTabsStorageKey ||
          !current.tabs.some((tab) => tab.id === tabId)
        ) {
          return current;
        }
        return {
          ...current,
          activeTabId: tabId,
        };
      });
    },
    [hydrateActiveLayout, layoutTabsStorageKey, persistCurrentLayoutSnapshot]
  );

  React.useEffect(() => {
    window.robotick?.studioControl?.reportActiveResource({
      window_id: windowScope,
      workbench_id: workbenchId,
      layout_id: activeLayoutResourceId,
      ...(maximizedPanelId ? { panel_id: maximizedPanelId } : {}),
    });
  }, [activeLayoutResourceId, maximizedPanelId, windowScope, workbenchId]);

  React.useEffect(() => {
    const applyActivation = (event: { activated_path: string[] }) => {
        const path = event.activated_path;
        const [collection, windowId, workbenchCollection, targetWorkbenchId] = path;
        if (
          collection !== "windows" ||
          windowId !== windowScope ||
          workbenchCollection !== "workbenches" ||
          targetWorkbenchId !== workbenchId
        ) {
          return;
        }
        const layoutIndex = path.indexOf("layouts");
        if (layoutIndex === -1) {
          return;
        }
        const layoutId = path[layoutIndex + 1];
        if (!layoutId) {
          return;
        }
        const tabId = layoutId.startsWith(`${windowScope}:${workbenchId}:`)
          ? layoutId.slice(`${windowScope}:${workbenchId}:`.length)
          : layoutId;
        const hasTab =
          layoutTabsStateRef.current.storageKey === layoutTabsStorageKey &&
          layoutTabsStateRef.current.tabs.some((tab) => tab.id === tabId);
        if (hasTab && activeLayoutTabId !== tabId) {
          handleSelectLayoutTab(tabId);
        }
        const panelIndex = path.indexOf("panels");
        const panelId = panelIndex === -1 ? null : path[panelIndex + 1] ?? null;
        if (panelId) {
          if (activeLayoutResourceId === layoutId && nodeContains(layoutStateRef.current.node, panelId)) {
            setMaximizedPanelId(panelId);
          } else {
            pendingActivatedPanelRef.current = { layoutId, panelId };
          }
          window.robotick?.studioControl?.reportActiveResource({
            window_id: windowScope,
            workbench_id: workbenchId,
            layout_id: layoutId,
            panel_id: panelId,
          });
        } else {
          window.robotick?.studioControl?.reportActiveResource({
            window_id: windowScope,
            workbench_id: workbenchId,
            layout_id: layoutId,
          });
        }
    };
    const unsubscribe =
      window.robotick?.studioControl?.onActivationChanged?.(applyActivation);
    const lastActivation = window.robotick?.studioControl?.getLastActivation?.();
    if (lastActivation) {
      applyActivation(lastActivation);
    }
    return unsubscribe;
  }, [
    activeLayoutTabId,
    activeLayoutResourceId,
    handleSelectLayoutTab,
    layoutTabsStorageKey,
    windowScope,
    workbenchId,
  ]);

  const handleAddLayoutTab = React.useCallback(() => {
    persistCurrentLayoutSnapshot();
    const id = generateLayoutTabId();
    setLayoutTabsState((current) => {
      if (current.storageKey !== layoutTabsStorageKey) {
        return current;
      }
      const nextIndex = current.tabs.length + 1;
      const tab = {
        id,
        name: getNewLayoutTabName(nextIndex, workbenchLabel),
      };
      return {
        ...current,
        tabs: [...current.tabs, tab],
        activeTabId: id,
      };
    });
    setLayoutState({
      storageKey: buildLayoutResourceId(windowScope, workbenchId, id),
      node: createLeaf(fallbackEditorId),
    });
    setFloatingPanelsState([]);
    replaceFloatingPanels(getFloatingPanelScope(windowScope, workbenchId, id), []);
    setMaximizedPanelId(null);
  }, [
    fallbackEditorId,
    layoutTabsStorageKey,
    persistCurrentLayoutSnapshot,
    windowScope,
    workbenchId,
    workbenchLabel,
  ]);

  const commitLayoutTabRename = React.useCallback(() => {
    setEditingLayoutTab((editing) => {
      if (!editing) {
        return null;
      }
      const trimmedName = editing.name.trim();
      if (!trimmedName) {
        return null;
      }
      setLayoutTabsState((current) => {
        if (current.storageKey !== layoutTabsStorageKey) {
          return current;
        }
        return {
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.id === editing.id ? { ...tab, name: trimmedName } : tab
          ),
        };
      });
      return null;
    });
  }, [layoutTabsStorageKey]);

  const cancelLayoutTabRename = React.useCallback(() => {
    setEditingLayoutTab(null);
  }, []);

  const handleCloseLayoutTab = React.useCallback(
    (tab: WorkbenchLayoutTab) => {
      if (visibleLayoutTabs.length <= 1) {
        return;
      }
      setLayoutTabPendingClose(tab);
    },
    [visibleLayoutTabs.length]
  );

  const confirmCloseLayoutTab = React.useCallback(() => {
    const closingTab = layoutTabPendingClose;
    if (!closingTab) {
      return;
    }
    setLayoutTabsState((current) => {
      if (current.storageKey !== layoutTabsStorageKey) {
        return current;
      }
      if (current.tabs.length <= 1) {
        return current;
      }
      const closingIndex = current.tabs.findIndex(
        (tab) => tab.id === closingTab.id
      );
      if (closingIndex === -1) {
        return current;
      }
      const nextTabs = current.tabs.filter((tab) => tab.id !== closingTab.id);
      const nextActiveTabId =
        current.activeTabId === closingTab.id
          ? nextTabs[Math.min(closingIndex, nextTabs.length - 1)].id
          : current.activeTabId;
      return {
        ...current,
        tabs: nextTabs,
        activeTabId: nextActiveTabId,
      };
    });
    setLayoutTabPendingClose(null);
    setEditingLayoutTab(null);
  }, [
    layoutTabPendingClose,
    layoutTabsStorageKey,
  ]);

  const handleLayoutTabDragStart = React.useCallback(
    (tabId: string, event: React.DragEvent<HTMLElement>) => {
      draggingLayoutTabIdRef.current = tabId;
      setDraggingLayoutTabId(tabId);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", tabId);
      }
    },
    []
  );

  const clearLayoutTabDrag = React.useCallback(() => {
    draggingLayoutTabIdRef.current = null;
    setDraggingLayoutTabId(null);
    setLayoutTabDropIndicator(null);
  }, []);

  const getLayoutTabDropPosition = React.useCallback(
    (event: React.DragEvent<HTMLElement>): "before" | "after" => {
      const rect = event.currentTarget.getBoundingClientRect();
      return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    },
    []
  );

  const handleLayoutTabDrop = React.useCallback(
    (targetTabId: string, event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      const position = getLayoutTabDropPosition(event);
      const sourceTabId =
        draggingLayoutTabIdRef.current ||
        event.dataTransfer?.getData("text/plain");
      clearLayoutTabDrag();
      if (!sourceTabId || sourceTabId === targetTabId) {
        return;
      }
      setLayoutTabsState((current) => {
        if (current.storageKey !== layoutTabsStorageKey) {
          return current;
        }
        const sourceIndex = current.tabs.findIndex(
          (tab) => tab.id === sourceTabId
        );
        const targetIndex = current.tabs.findIndex(
          (tab) => tab.id === targetTabId
        );
        if (sourceIndex === -1 || targetIndex === -1) {
          return current;
        }
        const nextTabs = [...current.tabs];
        const [movedTab] = nextTabs.splice(sourceIndex, 1);
        const adjustedTargetIndex =
          sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
        const insertIndex =
          position === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
        nextTabs.splice(insertIndex, 0, movedTab);
        return {
          ...current,
          tabs: nextTabs,
        };
      });
    },
    [clearLayoutTabDrag, getLayoutTabDropPosition, layoutTabsStorageKey]
  );

  const handleCreateFloatingPanel = React.useCallback(
    (editorId?: string) => {
      const targetEditor =
        editorId && allowedIdSet.has(editorId) ? editorId : fallbackEditorId;
      spawnFloatingPanel(floatingPanelScope, {
        editorId: targetEditor,
      });
    },
    [allowedIdSet, fallbackEditorId, floatingPanelScope]
  );

  const { showPanelMenu } = useContextMenu();
  const [refreshByPanelId, setRefreshByPanelId] = React.useState<Record<string, number>>({});
  const leafTotal = React.useMemo(() => countLeaves(layout), [layout]);
  const handleContextMenu = React.useCallback(
    (
      panelId: string,
      editorId: string,
      event: React.MouseEvent<HTMLDivElement>
    ) => {
      if (event.defaultPrevented || event.isDefaultPrevented()) {
        return;
      }
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
      const editorActions = collectEditorContextMenuActions(event);
      showPanelMenu({
        state,
        editorActions,
        editorOptions,
        canClose: leafTotal > 1,
        isMaximized: maximizedPanelId === panelId,
        onSplit,
        onAssign: (targetEditorId: string) => onAssign(panelId, targetEditorId),
        onRefreshPanel: () =>
          setRefreshByPanelId((prev) => ({
            ...prev,
            [panelId]: (prev[panelId] ?? 0) + 1,
          })),
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
      setRefreshByPanelId,
      resetLayout,
      showPanelMenu,
    ]
  );

  return (
    <FloatingPanelsScopeProvider scope={floatingPanelScope}>
      <div className={styles.panelLayoutShell}>
        <div className={styles.layoutTabs} aria-label="Workbench layout tabs">
          {visibleLayoutTabs.map((tab) => {
            const isActive =
              layoutTabsState.storageKey === layoutTabsStorageKey &&
              tab.id === activeLayoutTabId;
            const isEditing = editingLayoutTab?.id === tab.id;
            const isDragging = draggingLayoutTabId === tab.id;
            const dropPosition =
              layoutTabDropIndicator?.targetId === tab.id
                ? layoutTabDropIndicator.position
                : null;
            if (isEditing) {
              return (
                <input
                  key={tab.id}
                  className={`${styles.layoutTab} ${styles.layoutTabInput}`}
                  value={editingLayoutTab.name}
                  aria-label="Rename layout tab"
                  autoFocus
                  onChange={(event) =>
                    setEditingLayoutTab({
                      id: tab.id,
                      name: event.target.value,
                    })
                  }
                  onBlur={commitLayoutTabRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitLayoutTabRename();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelLayoutTabRename();
                    }
                  }}
                />
              );
            }
            return (
              <div
                key={tab.id}
                role="button"
                tabIndex={0}
                className={[
                  styles.layoutTab,
                  isActive ? styles.layoutTabActive : "",
                  isDragging ? styles.layoutTabDragging : "",
                  dropPosition === "before" ? styles.layoutTabDropBefore : "",
                  dropPosition === "after" ? styles.layoutTabDropAfter : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={isActive}
                draggable
                onClick={() => handleSelectLayoutTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleSelectLayoutTab(tab.id);
                  }
                }}
                onDoubleClick={() =>
                  setEditingLayoutTab({ id: tab.id, name: tab.name })
                }
                onDragStart={(event) =>
                  handleLayoutTabDragStart(tab.id, event)
                }
                onDragEnd={clearLayoutTabDrag}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (draggingLayoutTabIdRef.current === tab.id) {
                    setLayoutTabDropIndicator(null);
                    return;
                  }
                  setLayoutTabDropIndicator({
                    targetId: tab.id,
                    position: getLayoutTabDropPosition(event),
                  });
                }}
                onDragLeave={() => {
                  setLayoutTabDropIndicator((current) =>
                    current?.targetId === tab.id ? null : current
                  );
                }}
                onDrop={(event) => handleLayoutTabDrop(tab.id, event)}
              >
                <span className={styles.layoutTabLabel}>{tab.name}</span>
                <button
                  type="button"
                  className={styles.layoutTabClose}
                  aria-label={`Close layout tab ${tab.name}`}
                  title={
                    visibleLayoutTabs.length <= 1
                      ? "At least one layout tab is required"
                      : "Close layout tab"
                  }
                  disabled={visibleLayoutTabs.length <= 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCloseLayoutTab(tab);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  draggable={false}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className={styles.layoutTabAdd}
            aria-label="Create layout tab"
            title="Create layout tab"
            onClick={handleAddLayoutTab}
          >
            +
          </button>
        </div>
        <div className={styles.panelLayout}>
          <PanelNodeView
            node={layout}
            maximizedPanelId={maximizedPanelId}
            refreshByPanelId={refreshByPanelId}
            editorOptions={editorOptions}
            onContextMenu={handleContextMenu}
            onAssign={onAssign}
            onSetPanelSettings={onSetPanelSettings}
            onUpdatePanelSettings={onUpdatePanelSettings}
            onToggleMaximize={onToggleMaximize}
            onSplit={onSplit}
            onResizeSplit={onResizeSplit}
            workbenchId={workbenchId}
          />
        </div>
      </div>
      <FloatingPanelLayer
        scope={floatingPanelScope}
        editorEntries={editorEntries}
      />
      {layoutTabPendingClose ? (
        <GenericDialog
          title="Close layout tab?"
          message={
            <>
              This will remove <code>{layoutTabPendingClose.name}</code> and
              its saved panel arrangement.
            </>
          }
          onClose={() => setLayoutTabPendingClose(null)}
          actions={[
            {
              label: "Cancel",
              onClick: () => setLayoutTabPendingClose(null),
              autoFocus: true,
            },
            {
              label: "Close tab",
              variant: "primary",
              onClick: confirmCloseLayoutTab,
            },
          ]}
        />
      ) : null}
    </FloatingPanelsScopeProvider>
  );
}

type PanelNodeViewProps = {
  node: PanelNode;
  maximizedPanelId: string | null;
  refreshByPanelId: Record<string, number>;
  editorOptions: EditorOption[];
  onContextMenu: (
    panelId: string,
    editorId: string,
    event: React.MouseEvent<HTMLDivElement>
  ) => void;
  onAssign: (panelId: string, editorId: string) => void;
  onSetPanelSettings: (
    panelId: string,
    settings: Record<string, unknown>
  ) => void;
  onUpdatePanelSettings: (
    panelId: string,
    partial: Record<string, unknown>
  ) => void;
  onToggleMaximize: (panelId: string) => void;
  onSplit: (
    panelId: string,
    direction: "horizontal" | "vertical",
    ratio: number
  ) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
  workbenchId: string;
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
 * @param workbenchId - Identifier for the current workbench scope.
 * @returns A React element that renders the given `node` and its child panes.
 */
function PanelNodeView({
  node,
  maximizedPanelId,
  refreshByPanelId,
  editorOptions,
  onContextMenu,
  onAssign,
  onSetPanelSettings,
  onUpdatePanelSettings,
  onToggleMaximize,
  onSplit,
  onResizeSplit,
  workbenchId,
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
              refreshByPanelId={refreshByPanelId}
              editorOptions={editorOptions}
              onContextMenu={onContextMenu}
              onAssign={onAssign}
              onSetPanelSettings={onSetPanelSettings}
              onUpdatePanelSettings={onUpdatePanelSettings}
              onToggleMaximize={onToggleMaximize}
              onSplit={onSplit}
              onResizeSplit={onResizeSplit}
              workbenchId={workbenchId}
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
              refreshByPanelId={refreshByPanelId}
              editorOptions={editorOptions}
              onContextMenu={onContextMenu}
              onAssign={onAssign}
              onSetPanelSettings={onSetPanelSettings}
              onUpdatePanelSettings={onUpdatePanelSettings}
              onToggleMaximize={onToggleMaximize}
              onSplit={onSplit}
              onResizeSplit={onResizeSplit}
              workbenchId={workbenchId}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <PanelLeaf
      key={node.id}
      node={node}
      refreshVersion={refreshByPanelId[node.id] ?? 0}
      editorOptions={editorOptions}
      onContextMenu={onContextMenu}
      onAssign={onAssign}
      onSetPanelSettings={onSetPanelSettings}
      onUpdatePanelSettings={onUpdatePanelSettings}
      onToggleMaximize={onToggleMaximize}
      onSplit={onSplit}
      isMaximized={maximizedPanelId === node.id}
      workbenchId={workbenchId}
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
  refreshVersion: number;
  editorOptions: EditorOption[];
  onContextMenu: (
    panelId: string,
    editorId: string,
    event: React.MouseEvent<HTMLDivElement>
  ) => void;
  onAssign: (panelId: string, editorId: string) => void;
  onSetPanelSettings: (
    panelId: string,
    settings: Record<string, unknown>
  ) => void;
  onUpdatePanelSettings: (
    panelId: string,
    partial: Record<string, unknown>
  ) => void;
  onToggleMaximize: (panelId: string) => void;
  onSplit: (
    panelId: string,
    direction: "horizontal" | "vertical",
    ratio: number
  ) => void;
  isMaximized: boolean;
  workbenchId: string;
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
 * @param workbenchId - Workbench scope used for panel instance context.
 * @returns A React element representing the interactive leaf panel.
 */
function PanelLeaf({
  node,
  refreshVersion,
  editorOptions,
  onContextMenu,
  onAssign,
  onSetPanelSettings,
  onUpdatePanelSettings,
  onToggleMaximize,
  onSplit,
  isMaximized,
  workbenchId,
}: PanelLeafProps) {
  const { getEditorEntry } = useEditorRegistry();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const rightMouseDownAtMsRef = React.useRef<number | null>(null);
  const rightMouseDownPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const rightMouseDownTargetRef = React.useRef<EventTarget | null>(null);
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
  const openPanelMenuFromMousePoint = React.useCallback(
    (
      currentTarget: HTMLDivElement,
      clientX: number,
      clientY: number,
      target: EventTarget | null,
    ) => {
      const syntheticEvent = {
        defaultPrevented: false,
        isDefaultPrevented: () => false,
        preventDefault: () => {},
        currentTarget,
        target: target ?? currentTarget,
        clientX,
        clientY,
      } as React.MouseEvent<HTMLDivElement>;
      onContextMenu(node.id, node.editorId, syntheticEvent);
    },
    [node.editorId, node.id, onContextMenu]
  );
  const handlePanelContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as Element | null)?.closest?.(PANEL_RMB_GESTURE_SUPPRESS_SELECTOR)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // Chromium can dispatch `contextmenu` immediately on RMB down.
      // Always intercept native contextmenu here and decide tap-vs-hold on mouseup.
      if (rightMouseDownAtMsRef.current == null) {
        onContextMenu(node.id, node.editorId, event);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      rightMouseDownPosRef.current = { x: event.clientX, y: event.clientY };
    },
    [node.editorId, node.id, onContextMenu]
  );

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
  const Component = entry?.Component ?? null;
  const handleSetPanelSettings = React.useCallback(
    (settings: Record<string, unknown>) => onSetPanelSettings(node.id, settings),
    [node.id, onSetPanelSettings]
  );
  const handleUpdatePanelSettings = React.useCallback(
    (partial: Record<string, unknown>) =>
      onUpdatePanelSettings(node.id, partial),
    [node.id, onUpdatePanelSettings]
  );

  return (
    <PanelInstanceProvider
      panelId={node.id}
      workbenchId={workbenchId}
      editorId={node.editorId}
      settings={node.settings ?? {}}
      setSettings={handleSetPanelSettings}
      updateSettings={handleUpdatePanelSettings}
    >
      <div
        className={styles.panelLeaf}
        ref={panelRef}
        onMouseDownCapture={(event) => {
          if (event.button === 2) {
            rightMouseDownAtMsRef.current = performance.now();
            rightMouseDownPosRef.current = { x: event.clientX, y: event.clientY };
            rightMouseDownTargetRef.current = event.target;
          }
        }}
        onMouseUpCapture={(event) => {
          if (event.button !== 2) {
            return;
          }
          if ((event.target as Element | null)?.closest?.(PANEL_RMB_GESTURE_SUPPRESS_SELECTOR)) {
            rightMouseDownAtMsRef.current = null;
            rightMouseDownPosRef.current = null;
            rightMouseDownTargetRef.current = null;
            return;
          }
          const downAt = rightMouseDownAtMsRef.current;
          const elapsedMs =
            typeof downAt === "number" ? performance.now() - downAt : Number.NaN;
          const shouldOpen =
            Number.isFinite(elapsedMs) && elapsedMs <= PANEL_CONTEXT_MENU_TAP_MAX_MS;
          if (shouldOpen) {
            const point = rightMouseDownPosRef.current ?? {
              x: event.clientX,
              y: event.clientY,
            };
            openPanelMenuFromMousePoint(
              event.currentTarget,
              point.x,
              point.y,
              rightMouseDownTargetRef.current ?? event.target,
            );
          }
          rightMouseDownAtMsRef.current = null;
          rightMouseDownPosRef.current = null;
          rightMouseDownTargetRef.current = null;
        }}
        onContextMenu={handlePanelContextMenu}
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
          {entry && Component ? (
            <PanelErrorBoundary
              editorId={entry.id}
              onRetry={() => setSplitPreview(null)}
            >
              <React.Suspense
                fallback={<div className={styles.panelLoading}>Loading…</div>}
              >
                <React.Fragment key={`${node.id}:${refreshVersion}`}>
                  <Component />
                </React.Fragment>
              </React.Suspense>
            </PanelErrorBoundary>
          ) : (
            <div className={styles.panelErrorState}>
              <strong>Editor unavailable</strong>
              <p>
                The panel references <code>{node.editorId}</code>, but that
                editor is not currently loaded for this project.
              </p>
            </div>
          )}
        </div>
      </div>
    </PanelInstanceProvider>
  );
}
