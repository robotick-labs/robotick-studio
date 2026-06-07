import {
  EMPTY_STUDIO_PERSISTENCE_MODEL,
  STUDIO_PERSISTENCE_SCHEMA_VERSION,
  toStudioResourceSlug,
  type StudioDockNode,
  type StudioFloatingPanelInstance,
  type StudioLayoutResource,
  type StudioPanelInstance,
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

function cloneModel(model?: StudioPersistenceModel | null): StudioPersistenceModel {
  const source = model ?? EMPTY_STUDIO_PERSISTENCE_MODEL;
  return {
    windows: source.windows.map((window) => ({
      ...window,
      hostedWorkbenchIds: [...window.hostedWorkbenchIds],
    })),
    workbenches: source.workbenches.map((workbench) => ({
      ...workbench,
      layoutIds: [...workbench.layoutIds],
      windowIds: workbench.windowIds ? [...workbench.windowIds] : undefined,
    })),
    layouts: source.layouts.map((layout) => ({
      ...layout,
      dockTree: structuredClone(layout.dockTree),
      panelInstances: layout.panelInstances.map((panel) => ({
        ...panel,
        settings: panel.settings ? { ...panel.settings } : undefined,
      })),
      floatingPanels: layout.floatingPanels?.map((panel) => ({
        ...panel,
        settings: panel.settings ? { ...panel.settings } : undefined,
        frame: { ...panel.frame },
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

function buildLayoutResourceSlug(
  windowScope: string,
  workspaceId: string,
  layoutTabId: string
): string {
  return toStudioResourceSlug(
    `${windowScope}.${workspaceId}.${layoutTabId}`,
    "layout"
  );
}

function createDefaultLayoutResource(
  workspaceId: string,
  workspaceLabel: string | undefined,
  windowScope: string,
  fallbackEditorId: string,
  createPanelId: () => string
): StudioLayoutResource {
  const panelInstanceId = createPanelId();
  return {
    resourceType: "studio_layout",
    schemaVersion: 1,
    id: buildLayoutResourceId(windowScope, workspaceId, DEFAULT_LAYOUT_TAB_ID),
    slug: buildLayoutResourceSlug(
      windowScope,
      workspaceId,
      DEFAULT_LAYOUT_TAB_ID
    ),
    label: getDefaultLayoutTabName(workspaceLabel),
    workbenchId: workspaceId,
    dockTree: {
      nodeType: "panel",
      panelInstanceId,
    },
    panelInstances: [
      {
        panelInstanceId,
        editorId: fallbackEditorId,
      },
    ],
    floatingPanels: [],
  };
}

function ensureWorkbenchWindow(
  model: StudioPersistenceModel,
  workspaceId: string,
  windowScope: string
) {
  const targetWindowId = windowScope === "main" ? "main" : windowScope;
  const windowRole = windowScope === "main" ? "main" : "child";
  let window = model.windows.find((entry) => entry.id === targetWindowId);
  if (!window) {
    window = {
      resourceType: "studio_window",
      schemaVersion: 1,
      id: targetWindowId,
      slug: toStudioResourceSlug(targetWindowId, "window"),
      label: windowRole === "main" ? "Main Window" : "Studio Window",
      windowRole,
      hostedWorkbenchIds: [],
      defaultWorkbenchId: workspaceId,
    };
    model.windows.push(window);
  }
  if (!window.hostedWorkbenchIds.includes(workspaceId)) {
    window.hostedWorkbenchIds = [...window.hostedWorkbenchIds, workspaceId];
  }
  if (!window.defaultWorkbenchId) {
    window.defaultWorkbenchId = workspaceId;
  }

  let workbench = model.workbenches.find((entry) => entry.id === workspaceId);
  if (!workbench) {
    workbench = {
      resourceType: "studio_workbench",
      schemaVersion: 1,
      id: workspaceId,
      slug: toStudioResourceSlug(workspaceId, "workbench"),
      label: workspaceId,
      source: "project",
      layoutIds: [],
      defaultLayoutId: undefined,
      windowIds: [targetWindowId],
    };
    model.workbenches.push(workbench);
  }
  if (!workbench.windowIds?.includes(targetWindowId)) {
    workbench.windowIds = [...(workbench.windowIds ?? []), targetWindowId];
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
  const panelMap = new Map(
    resource.panelInstances.map((panel) => [panel.panelInstanceId, panel])
  );

  function fromDockNode(node: StudioDockNode): PersistedPanelNode {
    if (node.nodeType === "panel") {
      const panel = panelMap.get(node.panelInstanceId);
      return {
        id: node.panelInstanceId || createPanelId(),
        kind: "leaf",
        editorId: toAllowedEditor(
          panel?.editorId ?? fallbackEditorId,
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

  return fromDockNode(resource.dockTree);
}

function collectPanelInstancesFromNode(
  node: PersistedPanelNode,
  previousPanels: Map<string, StudioPanelInstance>
): {
  dockTree: StudioDockNode;
  panelInstances: StudioPanelInstance[];
} {
  const panelInstances: StudioPanelInstance[] = [];

  function toDockNode(current: PersistedPanelNode): StudioDockNode {
    if (current.kind === "leaf") {
      const previous = previousPanels.get(current.id);
      panelInstances.push({
        panelInstanceId: current.id,
        editorId: current.editorId,
        label:
          previous?.editorId === current.editorId ? previous.label : undefined,
        settings:
          previous?.editorId === current.editorId ? previous.settings : undefined,
      });
      return {
        nodeType: "panel",
        panelInstanceId: current.id,
      };
    }
    return {
      nodeType: "split",
      direction: current.direction,
      ratio: current.ratio,
      children: [toDockNode(current.children[0]), toDockNode(current.children[1])],
    };
  }

  return {
    dockTree: toDockNode(node),
    panelInstances,
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
  const workbench =
    nextModel.workbenches.find((entry) => entry.id === workspaceId)!;

  const scopePrefix = `${windowScope}:${workspaceId}:`;
  let scopeLayouts = nextModel.layouts.filter(
    (layout) => layout.workbenchId === workspaceId && layout.id.startsWith(scopePrefix)
  );
  if (scopeLayouts.length === 0) {
    const defaultLayout = createDefaultLayoutResource(
      workspaceId,
      workspaceLabel,
      windowScope,
      fallbackEditorId,
      createPanelId
    );
    nextModel.layouts.push(defaultLayout);
    scopeLayouts = [defaultLayout];
  }

  const orderedScopeLayoutIds = workbench.layoutIds.filter((layoutId) =>
    scopeLayouts.some((layout) => layout.id === layoutId)
  );
  const unorderedScopeLayouts = scopeLayouts.filter(
    (layout) => !orderedScopeLayoutIds.includes(layout.id)
  );
  const orderedLayouts = [
    ...orderedScopeLayoutIds
      .map((layoutId) => scopeLayouts.find((layout) => layout.id === layoutId))
      .filter((layout): layout is StudioLayoutResource => Boolean(layout)),
    ...unorderedScopeLayouts,
  ];

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

  workbench.layoutIds = [
    ...workbench.layoutIds.filter((layoutId) => !layoutId.startsWith(scopePrefix)),
    ...orderedLayouts.map((layout) => layout.id),
  ];
  workbench.defaultLayoutId = activeLayout.id;

  return {
    model: nextModel,
    tabs,
    activeTabId,
    activeLayout,
    floatingPanels: activeLayout.floatingPanels ?? [],
  };
}

function upsertLayout(
  layouts: StudioLayoutResource[],
  layout: StudioLayoutResource
): StudioLayoutResource[] {
  const existingIndex = layouts.findIndex((entry) => entry.id === layout.id);
  if (existingIndex === -1) {
    return [...layouts, layout];
  }
  const next = [...layouts];
  next[existingIndex] = layout;
  return next;
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
  const workbench =
    nextModel.workbenches.find((entry) => entry.id === workspaceId)!;
  const scopePrefix = `${windowScope}:${workspaceId}:`;
  const previousScopeLayouts = nextModel.layouts.filter(
    (layout) => layout.workbenchId === workspaceId && layout.id.startsWith(scopePrefix)
  );
  const previousById = new Map(previousScopeLayouts.map((layout) => [layout.id, layout]));

  const nextScopeLayouts: StudioLayoutResource[] = tabs.map((tab) => {
    const layoutId = buildLayoutResourceId(windowScope, workspaceId, tab.id);
    const previous = previousById.get(layoutId);
    const panelState = collectPanelInstancesFromNode(
      tab.id === activeTabId && previous?.id === layoutId
        ? layoutNode
        : panelNodeFromResource(
            previous ??
              createDefaultLayoutResource(
                workspaceId,
                workspaceLabel,
                windowScope,
                fallbackEditorId,
                () => `panel-${tab.id}`
              ),
            fallbackEditorId,
            new Set(previous?.panelInstances.map((panel) => panel.editorId) ?? [
              fallbackEditorId,
            ]),
            () => `panel-${tab.id}`
          ),
      new Map(previous?.panelInstances.map((panel) => [panel.panelInstanceId, panel]) ?? [])
    );
    return {
      resourceType: "studio_layout" as const,
      schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
      id: layoutId,
      slug: buildLayoutResourceSlug(windowScope, workspaceId, tab.id),
      label: tab.name,
      workbenchId: workspaceId,
      dockTree: panelState.dockTree,
      panelInstances: panelState.panelInstances,
      floatingPanels:
        tab.id === activeTabId && floatingPanels.length > 0
          ? floatingPanels
          : previous?.floatingPanels ?? [],
    };
  });

  nextModel.layouts = nextModel.layouts.filter(
    (layout) => !(layout.workbenchId === workspaceId && layout.id.startsWith(scopePrefix))
  );
  for (const layout of nextScopeLayouts) {
    nextModel.layouts = upsertLayout(nextModel.layouts, layout);
  }

  workbench.layoutIds = [
    ...workbench.layoutIds.filter((layoutId) => !layoutId.startsWith(scopePrefix)),
    ...nextScopeLayouts.map((layout) => layout.id),
  ];
  workbench.defaultLayoutId = buildLayoutResourceId(
    windowScope,
    workspaceId,
    activeTabId
  );

  return nextModel;
}
