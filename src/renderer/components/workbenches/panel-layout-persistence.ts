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
  settings?: Record<string, unknown>;
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

export type PersistedWorkbenchLayoutTab = {
  id: string;
  name: string;
  layoutId: string;
};

export type PersistedWorkbenchLayoutState = {
  model: StudioPersistenceModel;
  tabs: PersistedWorkbenchLayoutTab[];
  activeTabId: string;
  activeLayout: StudioLayoutResource;
  floatingPanels: StudioFloatingPanelInstance[];
};

type LoadWorkbenchLayoutOptions = {
  model?: StudioPersistenceModel | null;
  workbenchId: string;
  workbenchLabel?: string;
  windowScope: string;
  fallbackEditorId: string;
  allowedEditors: Set<string>;
  createPanelId: () => string;
};

type ApplyWorkbenchLayoutOptions = {
  model?: StudioPersistenceModel | null;
  workbenchId: string;
  workbenchLabel?: string;
  windowScope: string;
  tabs: PersistedWorkbenchLayoutTab[];
  activeTabId: string;
  layoutNode: PersistedPanelNode;
  floatingPanels: StudioFloatingPanelInstance[];
  fallbackEditorId: string;
};

const DEFAULT_LAYOUT_TAB_ID = "default";
const DEFAULT_LAYOUT_TAB_NAME = "Default";

function cloneSettings(
  settings?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!settings) {
    return undefined;
  }
  return Object.keys(settings).length > 0 ? { ...settings } : undefined;
}

function cloneDockNode(node: StudioDockNode): StudioDockNode {
  if (node.nodeType === "panel") {
    return {
      nodeType: "panel",
      panelId: node.panelId,
      editorId: node.editorId,
      label: node.label,
      settings: cloneSettings(node.settings),
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
            settings: cloneSettings(panel.settings),
            frame: { ...panel.frame },
          })),
        })),
      })),
    })),
  };
}

function getDefaultLayoutTabName(workbenchLabel?: string): string {
  const label = workbenchLabel?.trim();
  return label
    ? `${label} | ${DEFAULT_LAYOUT_TAB_NAME}`
    : DEFAULT_LAYOUT_TAB_NAME;
}

export function buildLayoutResourceId(
  windowScope: string,
  workbenchId: string,
  layoutTabId: string
): string {
  return `${windowScope}:${workbenchId}:${layoutTabId}`;
}

function createDefaultLayoutResource(
  workbenchId: string,
  workbenchLabel: string | undefined,
  windowScope: string,
  fallbackEditorId: string,
  createPanelId: () => string
): StudioLayoutResource {
  const panelId = createPanelId();
  return {
    id: buildLayoutResourceId(windowScope, workbenchId, DEFAULT_LAYOUT_TAB_ID),
    label: getDefaultLayoutTabName(workbenchLabel),
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
  workbenchId: string,
  windowScope: string
): StudioWorkbenchResource | undefined {
  return findWindowResource(model, windowScope)?.workbenches.find(
    (entry) => entry.id === workbenchId
  );
}

export function findLayoutResource(
  model: StudioPersistenceModel | null | undefined,
  workbenchId: string,
  windowScope: string,
  layoutId: string
): StudioLayoutResource | undefined {
  if (!model) {
    return undefined;
  }
  return findWorkbenchResource(model, workbenchId, windowScope)?.layouts.find(
    (layout) => layout.id === layoutId
  );
}

function ensureWorkbenchWindow(
  model: StudioPersistenceModel,
  workbenchId: string,
  windowScope: string,
  workbenchLabel?: string
) {
  const targetWindowId = getWindowId(windowScope);
  const windowRole = windowScope === "main" ? "main" : "child";
  let window = model.windows.find((entry) => entry.id === targetWindowId);
  if (!window) {
    window = {
      id: targetWindowId,
      label: windowRole === "main" ? "Main Window" : "Studio Window",
      windowRole,
      defaultWorkbenchId: workbenchId,
      workbenches: [],
    };
    model.windows.push(window);
  }
  if (!window.defaultWorkbenchId) {
    window.defaultWorkbenchId = workbenchId;
  }

  let workbench = window.workbenches.find((entry) => entry.id === workbenchId);
  if (!workbench) {
    workbench = {
      id: workbenchId,
      label: workbenchLabel?.trim() || workbenchId,
      defaultLayoutId: undefined,
      layouts: [],
    };
    window.workbenches.push(workbench);
  }
  if (!workbench.label) {
    workbench.label = workbenchLabel?.trim() || workbenchId;
  }
}

function toAllowedEditor(
  editorId: string,
  fallbackEditorId: string,
  allowedEditors: Set<string>
) {
  return allowedEditors.has(editorId) ? editorId : fallbackEditorId;
}

function sanitizeDockNode(
  node: StudioDockNode,
  fallbackEditorId: string,
  allowedEditors: Set<string>,
  createPanelId: () => string
): StudioDockNode {
  if (node.nodeType === "panel") {
    const nextEditorId = toAllowedEditor(
      node.editorId ?? fallbackEditorId,
      fallbackEditorId,
      allowedEditors
    );
    const editorChanged = nextEditorId !== node.editorId;
    return {
      nodeType: "panel",
      panelId: node.panelId || createPanelId(),
      editorId: nextEditorId,
      label: editorChanged ? undefined : node.label,
      settings: editorChanged ? undefined : cloneSettings(node.settings),
    };
  }
  return {
    nodeType: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [
      sanitizeDockNode(
        node.children[0],
        fallbackEditorId,
        allowedEditors,
        createPanelId
      ),
      sanitizeDockNode(
        node.children[1],
        fallbackEditorId,
        allowedEditors,
        createPanelId
      ),
    ],
  };
}

function sanitizeFloatingPanels(
  panels: StudioFloatingPanelInstance[] | undefined,
  fallbackEditorId: string,
  allowedEditors: Set<string>
): StudioFloatingPanelInstance[] | undefined {
  if (!panels || panels.length === 0) {
    return undefined;
  }
  return panels.map((panel) => {
    const nextEditorId = toAllowedEditor(
      panel.editorId ?? fallbackEditorId,
      fallbackEditorId,
      allowedEditors
    );
    const editorChanged = nextEditorId !== panel.editorId;
    return {
      id: panel.id,
      editorId: nextEditorId,
      label: editorChanged ? undefined : panel.label,
      settings: editorChanged ? undefined : cloneSettings(panel.settings),
      frame: { ...panel.frame },
    };
  });
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
        settings: cloneSettings(node.settings),
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
      settings: cloneSettings(node.settings),
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

export function loadWorkbenchLayoutState({
  model,
  workbenchId,
  workbenchLabel,
  windowScope,
  fallbackEditorId,
  allowedEditors,
  createPanelId,
}: LoadWorkbenchLayoutOptions): PersistedWorkbenchLayoutState {
  const nextModel = cloneModel(model);
  ensureWorkbenchWindow(nextModel, workbenchId, windowScope, workbenchLabel);
  const workbench = findWorkbenchResource(nextModel, workbenchId, windowScope)!;

  if (workbench.layouts.length === 0) {
    workbench.layouts.push(
      createDefaultLayoutResource(
        workbenchId,
        workbenchLabel,
        windowScope,
        fallbackEditorId,
        createPanelId
      )
    );
  }

  workbench.layouts = workbench.layouts.map((layout) => ({
    ...layout,
    label: layout.label || getDefaultLayoutTabName(workbenchLabel),
    dock: sanitizeDockNode(
      layout.dock,
      fallbackEditorId,
      allowedEditors,
      createPanelId
    ),
    floatingPanels: sanitizeFloatingPanels(
      layout.floatingPanels,
      fallbackEditorId,
      allowedEditors
    ),
  }));

  const orderedLayouts = workbench.layouts;
  const tabs = orderedLayouts.map((layout) => ({
    id: tabIdFromLayoutId(layout.id),
    name: layout.label || getDefaultLayoutTabName(workbenchLabel),
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

export function applyWorkbenchLayoutState({
  model,
  workbenchId,
  workbenchLabel,
  windowScope,
  tabs,
  activeTabId,
  layoutNode,
  floatingPanels,
  fallbackEditorId,
}: ApplyWorkbenchLayoutOptions): StudioPersistenceModel {
  const nextModel = cloneModel(model);
  ensureWorkbenchWindow(nextModel, workbenchId, windowScope, workbenchLabel);
  const workbench = findWorkbenchResource(nextModel, workbenchId, windowScope)!;
  const previousById = new Map(workbench.layouts.map((layout) => [layout.id, layout]));

  workbench.layouts = tabs.map((tab) => {
    const layoutId = buildLayoutResourceId(windowScope, workbenchId, tab.id);
    const previous = previousById.get(layoutId);
    const previousDock =
      previous?.dock ??
      createDefaultLayoutResource(
        workbenchId,
        workbenchLabel,
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
          ? floatingPanels.map((panel) => ({
              ...panel,
              settings: cloneSettings(panel.settings),
              frame: { ...panel.frame },
            }))
          : previous?.floatingPanels?.map((panel) => ({
              ...panel,
              settings: cloneSettings(panel.settings),
              frame: { ...panel.frame },
            })) ?? undefined,
    };
  });

  workbench.defaultLayoutId = buildLayoutResourceId(
    windowScope,
    workbenchId,
    activeTabId
  );

  return {
    resourceType: "studio_document",
    schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
    id: nextModel.id,
    windows: nextModel.windows,
  };
}
