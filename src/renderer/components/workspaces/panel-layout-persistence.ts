import {
  createEmptyStudioPersistenceModel,
  STUDIO_PERSISTENCE_SCHEMA_VERSION,
  type StudioDockNode,
  type StudioFloatingPanelInstance,
  type StudioLayoutResource,
  type StudioPersistenceModel,
  type StudioWindowResource,
  type StudioWorkbenchResource,
} from "../../services/studio-persistence";

export type PersistedPanelLeafNode = {
  id: string;
  kind: "leaf";
  editorId: string;
};

export type PersistedPanelSplitNode = {
  id: string;
  kind: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [PersistedPanelNode, PersistedPanelNode];
};

export type PersistedPanelNode =
  | PersistedPanelLeafNode
  | PersistedPanelSplitNode;

export type PersistedWorkspaceLayoutTab = {
  id: string;
  name: string;
  layoutId: string;
};

export type PersistedWorkspaceLayoutState = {
  model: StudioPersistenceModel;
  tabs: PersistedWorkspaceLayoutTab[];
  activeTabId: string;
  activeLayout: StudioLayoutResource;
  floatingPanels: StudioFloatingPanelInstance[];
};

type LoadWorkspaceLayoutOptions = {
  model?: StudioPersistenceModel | null;
  workspaceId: string;
  workspaceLabel?: string;
  windowScope: string;
  fallbackEditorId: string;
  allowedEditors: Set<string>;
  createPanelId: () => string;
};

type ApplyWorkspaceLayoutOptions = {
  model?: StudioPersistenceModel | null;
  workspaceId: string;
  workspaceLabel?: string;
  windowScope: string;
  tabs: PersistedWorkspaceLayoutTab[];
  activeTabId: string;
  layoutNode: PersistedPanelNode;
  floatingPanels: StudioFloatingPanelInstance[];
  fallbackEditorId: string;
};

const DEFAULT_LAYOUT_TAB_ID = "default";
const DEFAULT_LAYOUT_TAB_NAME = "Default";

function cloneDockNode(node: StudioDockNode): StudioDockNode {
  if (node.nodeType === "panel") {
    return {
      nodeType: "panel",
      panelId: node.panelId,
      editorId: node.editorId,
      label: node.label,
      settings: node.settings ? { ...node.settings } : undefined,
    };
  }
  return {
    nodeType: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [cloneDockNode(node.children[0]), cloneDockNode(node.children[1])],
  };
}

function cloneModel(model?: StudioPersistenceModel | null): StudioPersistenceModel {
  const source = model ?? createEmptyStudioPersistenceModel();
  return {
    resourceType: source.resourceType,
    schemaVersion: source.schemaVersion,
    id: source.id,
    windows: source.windows.map((window) => ({
      ...window,
      workbenches: window.workbenches.map((workbench) => ({
        ...workbench,
        layouts: workbench.layouts.map((layout) => ({
          ...layout,
          dock: cloneDockNode(layout.dock),
          floatingPanels: layout.floatingPanels?.map((panel) => ({
            ...panel,
            settings: panel.settings ? { ...panel.settings } : undefined,
            frame: { ...panel.frame },
          })),
        })),
      })),
    })),
  };
}

function getDefaultLayoutTabName(workspaceLabel?: string): string {
  const label = workspaceLabel?.trim();
  return label
    ? `${label} | ${DEFAULT_LAYOUT_TAB_NAME}`
    : DEFAULT_LAYOUT_TAB_NAME;
}

export function buildLayoutResourceId(
  windowScope: string,
  workspaceId: string,
  layoutTabId: string
): string {
  return `${windowScope}:${workspaceId}:${layoutTabId}`;
}

function createDefaultLayoutResource(
  workspaceId: string,
  workspaceLabel: string | undefined,
  windowScope: string,
  fallbackEditorId: string,
  createPanelId: () => string
): StudioLayoutResource {
  const panelId = createPanelId();
  return {
    id: buildLayoutResourceId(windowScope, workspaceId, DEFAULT_LAYOUT_TAB_ID),
    label: getDefaultLayoutTabName(workspaceLabel),
    dock: {
      nodeType: "panel",
      panelId,
      editorId: fallbackEditorId,
    },
    floatingPanels: [],
  };
}

function getWindowId(windowScope: string): string {
  return windowScope === "main" ? "main" : windowScope;
}

function findWindowResource(
  model: StudioPersistenceModel,
  windowScope: string
): StudioWindowResource | undefined {
  return model.windows.find((entry) => entry.id === getWindowId(windowScope));
}

function findWorkbenchResource(
  model: StudioPersistenceModel,
  workspaceId: string,
  windowScope: string
): StudioWorkbenchResource | undefined {
  return findWindowResource(model, windowScope)?.workbenches.find(
    (entry) => entry.id === workspaceId
  );
}

export function findLayoutResource(
  model: StudioPersistenceModel | null | undefined,
  workspaceId: string,
  windowScope: string,
  layoutId: string
): StudioLayoutResource | undefined {
  if (!model) {
    return undefined;
  }
  return findWorkbenchResource(model, workspaceId, windowScope)?.layouts.find(
    (layout) => layout.id === layoutId
  );
}

function ensureWorkbenchWindow(
  model: StudioPersistenceModel,
  workspaceId: string,
  windowScope: string
) {
  const targetWindowId = getWindowId(windowScope);
  const windowRole = windowScope === "main" ? "main" : "child";
  let window = model.windows.find((entry) => entry.id === targetWindowId);
  if (!window) {
    window = {
      id: targetWindowId,
      label: windowRole === "main" ? "Main Window" : "Studio Window",
      windowRole,
      defaultWorkbenchId: workspaceId,
      workbenches: [],
    };
    model.windows.push(window);
  }
  if (!window.defaultWorkbenchId) {
    window.defaultWorkbenchId = workspaceId;
  }

  let workbench = window.workbenches.find((entry) => entry.id === workspaceId);
  if (!workbench) {
    workbench = {
      id: workspaceId,
      label: workspaceId,
      defaultLayoutId: undefined,
      layouts: [],
    };
    window.workbenches.push(workbench);
  }
}

function toAllowedEditor(
  editorId: string,
  fallbackEditorId: string,
  allowedEditors: Set<string>
) {
  return allowedEditors.has(editorId) ? editorId : fallbackEditorId;
}

export function panelNodeFromResource(
  resource: StudioLayoutResource,
  fallbackEditorId: string,
  allowedEditors: Set<string>,
  createPanelId: () => string
): PersistedPanelNode {
  function fromDockNode(node: StudioDockNode): PersistedPanelNode {
    if (node.nodeType === "panel") {
      return {
        id: node.panelId || createPanelId(),
        kind: "leaf",
        editorId: toAllowedEditor(
          node.editorId ?? fallbackEditorId,
          fallbackEditorId,
          allowedEditors
        ),
      };
    }
    return {
      id: createPanelId(),
      kind: "split",
      direction: node.direction,
      ratio: node.ratio,
      children: [fromDockNode(node.children[0]), fromDockNode(node.children[1])],
    };
  }

  return fromDockNode(resource.dock);
}

type PreviousPanelMap = Map<
  string,
  Extract<StudioDockNode, { nodeType: "panel" }>
>;

function collectPreviousPanels(
  node: StudioDockNode,
  panels: PreviousPanelMap = new Map()
): PreviousPanelMap {
  if (node.nodeType === "panel") {
    panels.set(node.panelId, node);
    return panels;
  }
  collectPreviousPanels(node.children[0], panels);
  collectPreviousPanels(node.children[1], panels);
  return panels;
}

function buildDockNode(
  node: PersistedPanelNode,
  previousPanels: PreviousPanelMap
): StudioDockNode {
  if (node.kind === "leaf") {
    const previous = previousPanels.get(node.id);
    return {
      nodeType: "panel",
      panelId: node.id,
      editorId: node.editorId,
      label: previous?.editorId === node.editorId ? previous.label : undefined,
      settings:
        previous?.editorId === node.editorId ? previous.settings : undefined,
    };
  }
  return {
    nodeType: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [
      buildDockNode(node.children[0], previousPanels),
      buildDockNode(node.children[1], previousPanels),
    ],
  };
}

function tabIdFromLayoutId(layoutId: string): string {
  return layoutId.split(":").slice(-1)[0] || DEFAULT_LAYOUT_TAB_ID;
}

export function loadWorkspaceLayoutState({
  model,
  workspaceId,
  workspaceLabel,
  windowScope,
  fallbackEditorId,
  allowedEditors,
  createPanelId,
}: LoadWorkspaceLayoutOptions): PersistedWorkspaceLayoutState {
  const nextModel = cloneModel(model);
  ensureWorkbenchWindow(nextModel, workspaceId, windowScope);
  const workbench = findWorkbenchResource(nextModel, workspaceId, windowScope)!;

  if (workbench.layouts.length === 0) {
    workbench.layouts.push(
      createDefaultLayoutResource(
        workspaceId,
        workspaceLabel,
        windowScope,
        fallbackEditorId,
        createPanelId
      )
    );
  }

  const orderedLayouts = workbench.layouts;
  const tabs = orderedLayouts.map((layout) => ({
    id: tabIdFromLayoutId(layout.id),
    name: layout.label || getDefaultLayoutTabName(workspaceLabel),
    layoutId: layout.id,
  }));

  const activeLayoutId =
    workbench.defaultLayoutId &&
    orderedLayouts.some((layout) => layout.id === workbench.defaultLayoutId)
      ? workbench.defaultLayoutId
      : orderedLayouts[0].id;
  const activeLayout =
    orderedLayouts.find((layout) => layout.id === activeLayoutId) ??
    orderedLayouts[0];
  const activeTabId = tabIdFromLayoutId(activeLayout.id);

  workbench.defaultLayoutId = activeLayout.id;

  return {
    model: nextModel,
    tabs,
    activeTabId,
    activeLayout,
    floatingPanels: activeLayout.floatingPanels ?? [],
  };
}

export function applyWorkspaceLayoutState({
  model,
  workspaceId,
  workspaceLabel,
  windowScope,
  tabs,
  activeTabId,
  layoutNode,
  floatingPanels,
  fallbackEditorId,
}: ApplyWorkspaceLayoutOptions): StudioPersistenceModel {
  const nextModel = cloneModel(model);
  ensureWorkbenchWindow(nextModel, workspaceId, windowScope);
  const workbench = findWorkbenchResource(nextModel, workspaceId, windowScope)!;
  const previousById = new Map(workbench.layouts.map((layout) => [layout.id, layout]));

  workbench.layouts = tabs.map((tab) => {
    const layoutId = buildLayoutResourceId(windowScope, workspaceId, tab.id);
    const previous = previousById.get(layoutId);
    const previousDock =
      previous?.dock ??
      createDefaultLayoutResource(
        workspaceId,
        workspaceLabel,
        windowScope,
        fallbackEditorId,
        () => `panel-${tab.id}`
      ).dock;
    const dock =
      tab.id === activeTabId && previous?.id === layoutId
        ? buildDockNode(layoutNode, collectPreviousPanels(previousDock))
        : cloneDockNode(previousDock);
    return {
      id: layoutId,
      label: tab.name,
      dock,
      floatingPanels:
        tab.id === activeTabId && floatingPanels.length > 0
          ? floatingPanels
          : previous?.floatingPanels?.map((panel) => ({
              ...panel,
              settings: panel.settings ? { ...panel.settings } : undefined,
              frame: { ...panel.frame },
            })) ?? [],
    };
  });

  workbench.defaultLayoutId = buildLayoutResourceId(
    windowScope,
    workspaceId,
    activeTabId
  );

  return {
    resourceType: "studio_document",
    schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
    id: nextModel.id,
    windows: nextModel.windows,
  };
}
