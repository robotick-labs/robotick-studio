import { parse, stringify } from "yaml";
import studioSeedSource from "../../../../studio.template.yaml?raw";
import { STUDIO_PERSISTENCE_SCHEMA_VERSION } from "./constants";
import { getStudioProjectDirectory } from "./paths";
import type { StudioPersistenceStore } from "./store";
import type {
  StudioDockNode,
  StudioFloatingPanelInstance,
  StudioLayoutResource,
  StudioPersistenceModel,
  StudioWorkbenchGroup,
  StudioWindowResource,
  StudioWorkbenchResource,
} from "./types";

type RawStudioDockNode = Record<string, unknown>;
type RawStudioLayoutResource = Record<string, unknown>;
type RawStudioWorkbenchResource = Record<string, unknown>;
type RawStudioWindowResource = Record<string, unknown>;
type RawStudioPersistenceModel = Record<string, unknown>;

function deriveStudioDocumentId(projectPath: string): string {
  const projectDirectory = getStudioProjectDirectory(projectPath)
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop();
  return projectDirectory ? `${projectDirectory}-studio` : "studio";
}

function isWorkbenchGroup(value: unknown): value is StudioWorkbenchGroup {
  return (
    value === "project-select" ||
    value === "dev" ||
    value === "test" ||
    value === "help"
  );
}

export function createEmptyStudioPersistenceModel(
  projectPath?: string
): StudioPersistenceModel {
  return {
    resourceType: "studio_document",
    schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
    id: projectPath ? deriveStudioDocumentId(projectPath) : "studio",
    windows: [],
  };
}

export const EMPTY_STUDIO_PERSISTENCE_MODEL = createEmptyStudioPersistenceModel();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value);
}

function isPanelFrame(value: unknown): value is StudioFloatingPanelInstance["frame"] {
  return (
    isObject(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    (value.minWidth === undefined || typeof value.minWidth === "number") &&
    (value.minHeight === undefined || typeof value.minHeight === "number")
  );
}

function isDockNode(value: unknown): value is StudioDockNode {
  if (!isObject(value) || typeof value.nodeType !== "string") {
    return false;
  }
  if (value.nodeType === "panel") {
    return (
      typeof value.panelId === "string" &&
      typeof value.editorId === "string" &&
      (value.label === undefined || typeof value.label === "string") &&
      (value.settings === undefined || isStringRecord(value.settings))
    );
  }
  if (value.nodeType === "split") {
    return (
      (value.direction === "horizontal" || value.direction === "vertical") &&
      typeof value.ratio === "number" &&
      Array.isArray(value.children) &&
      value.children.length === 2 &&
      isDockNode(value.children[0]) &&
      isDockNode(value.children[1])
    );
  }
  return false;
}

function isFloatingPanel(value: unknown): value is StudioFloatingPanelInstance {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.editorId === "string" &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.settings === undefined || isStringRecord(value.settings)) &&
    isPanelFrame(value.frame)
  );
}

function isLayoutResource(value: unknown): value is StudioLayoutResource {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    isDockNode(value.dock) &&
    (value.floatingPanels === undefined ||
      (Array.isArray(value.floatingPanels) &&
        value.floatingPanels.every((panel) => isFloatingPanel(panel))))
  );
}

function isWorkbenchResource(value: unknown): value is StudioWorkbenchResource {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    (value.path === undefined || typeof value.path === "string") &&
    typeof value.label === "string" &&
    (value.group === undefined || isWorkbenchGroup(value.group)) &&
    (value.defaultEditorId === undefined ||
      typeof value.defaultEditorId === "string") &&
    (value.defaultLayoutId === undefined ||
      typeof value.defaultLayoutId === "string") &&
    Array.isArray(value.layouts) &&
    value.layouts.every((layout) => isLayoutResource(layout))
  );
}

function isRawLayoutResource(value: unknown): value is RawStudioLayoutResource {
  return (
    isObject(value) &&
    (value.id === undefined || typeof value.id === "string") &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.dock === undefined || isDockNode(value.dock)) &&
    (value.floatingPanels === undefined ||
      (Array.isArray(value.floatingPanels) &&
        value.floatingPanels.every((panel) => isFloatingPanel(panel))))
  );
}

function isRawWorkbenchResource(value: unknown): value is RawStudioWorkbenchResource {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    (value.path === undefined || typeof value.path === "string") &&
    typeof value.label === "string" &&
    (value.group === undefined || isWorkbenchGroup(value.group)) &&
    (value.defaultEditorId === undefined ||
      typeof value.defaultEditorId === "string") &&
    (value.defaultLayoutId === undefined ||
      typeof value.defaultLayoutId === "string") &&
    (value.layouts === undefined ||
      (Array.isArray(value.layouts) &&
        value.layouts.every((layout) => isRawLayoutResource(layout))))
  );
}

function isRawWindowResource(value: unknown): value is RawStudioWindowResource {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.windowRole === "main" || value.windowRole === "child") &&
    (value.defaultWorkbenchId === undefined ||
      typeof value.defaultWorkbenchId === "string") &&
    Array.isArray(value.workbenches) &&
    value.workbenches.every((workbench) => isRawWorkbenchResource(workbench))
  );
}

function isRawStudioDocument(value: unknown): value is RawStudioPersistenceModel {
  return (
    isObject(value) &&
    value.resourceType === "studio_document" &&
    value.schemaVersion === STUDIO_PERSISTENCE_SCHEMA_VERSION &&
    typeof value.id === "string" &&
    Array.isArray(value.windows) &&
    value.windows.every((window) => isRawWindowResource(window))
  );
}

function isWindowResource(value: unknown): value is StudioWindowResource {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.windowRole === "main" || value.windowRole === "child") &&
    (value.defaultWorkbenchId === undefined ||
      typeof value.defaultWorkbenchId === "string") &&
    Array.isArray(value.workbenches) &&
    value.workbenches.every((workbench) => isWorkbenchResource(workbench))
  );
}

function isStudioDocument(value: unknown): value is StudioPersistenceModel {
  return (
    isObject(value) &&
    value.resourceType === "studio_document" &&
    value.schemaVersion === STUDIO_PERSISTENCE_SCHEMA_VERSION &&
    typeof value.id === "string" &&
    Array.isArray(value.windows) &&
    value.windows.every((window) => isWindowResource(window))
  );
}

function cloneDockNode(node: StudioDockNode): StudioDockNode {
  if (node.nodeType === "panel") {
    return {
      nodeType: "panel",
      panelId: node.panelId,
      editorId: node.editorId,
      ...(node.label !== undefined ? { label: node.label } : {}),
      ...(node.settings !== undefined ? { settings: { ...node.settings } } : {}),
    };
  }
  return {
    nodeType: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [cloneDockNode(node.children[0]), cloneDockNode(node.children[1])],
  };
}

function normalizeLayout(layout: StudioLayoutResource): StudioLayoutResource {
  return {
    id: layout.id,
    label: layout.label,
    dock: cloneDockNode(layout.dock),
    ...(layout.floatingPanels && layout.floatingPanels.length > 0
      ? {
          floatingPanels: layout.floatingPanels.map((panel) => ({
            id: panel.id,
            editorId: panel.editorId,
            ...(panel.label !== undefined ? { label: panel.label } : {}),
            ...(panel.settings !== undefined
              ? { settings: { ...panel.settings } }
              : {}),
            frame: { ...panel.frame },
          })),
        }
      : {}),
  };
}

function buildDefaultLayoutId(windowId: string, workbenchId: string): string {
  return `${windowId}:${workbenchId}:default`;
}

function buildDefaultWorkbenchPath(workbenchId: string): string {
  return `/${workbenchId}`;
}

function buildDefaultLayoutLabel(workbenchLabel: string): string {
  return `${workbenchLabel} | Default`;
}

function buildDefaultPanelId(workbenchId: string): string {
  return `panel-${workbenchId}`;
}

function buildDefaultLayout(
  window: Pick<StudioWindowResource, "id">,
  workbench: Pick<StudioWorkbenchResource, "id" | "label" | "defaultEditorId">
): StudioLayoutResource | null {
  if (!workbench.defaultEditorId) {
    return null;
  }
  return {
    id: buildDefaultLayoutId(window.id, workbench.id),
    label: buildDefaultLayoutLabel(workbench.label),
    dock: {
      nodeType: "panel",
      panelId: buildDefaultPanelId(workbench.id),
      editorId: workbench.defaultEditorId,
    },
  };
}

function normalizeRawLayout(
  layout: RawStudioLayoutResource,
  fallback: StudioLayoutResource
): StudioLayoutResource {
  return normalizeLayout({
    id:
      typeof layout.id === "string" && layout.id.trim().length > 0
        ? layout.id
        : fallback.id,
    label:
      typeof layout.label === "string" && layout.label.trim().length > 0
        ? layout.label
        : fallback.label,
    dock: isDockNode(layout.dock) ? layout.dock : fallback.dock,
    floatingPanels:
      Array.isArray(layout.floatingPanels) &&
      layout.floatingPanels.every((panel) => isFloatingPanel(panel))
        ? layout.floatingPanels
        : fallback.floatingPanels,
  });
}

function expandWorkbenchDefaults(
  window: Pick<StudioWindowResource, "id">,
  workbench: RawStudioWorkbenchResource
): StudioWorkbenchResource | null {
  const base: StudioWorkbenchResource = {
    id: workbench.id as string,
    path:
      typeof workbench.path === "string" && workbench.path.trim().length > 0
        ? workbench.path
        : buildDefaultWorkbenchPath(workbench.id as string),
    label: workbench.label as string,
    group: isWorkbenchGroup(workbench.group) ? workbench.group : undefined,
    defaultEditorId:
      typeof workbench.defaultEditorId === "string"
        ? workbench.defaultEditorId
        : undefined,
    defaultLayoutId:
      typeof workbench.defaultLayoutId === "string"
        ? workbench.defaultLayoutId
        : undefined,
    layouts: [],
  };
  const fallbackLayout = buildDefaultLayout(window, base);
  const rawLayouts = Array.isArray(workbench.layouts) ? workbench.layouts : [];
  if (rawLayouts.length === 0) {
    if (!fallbackLayout) {
      return null;
    }
    base.layouts = [fallbackLayout];
    base.defaultLayoutId = fallbackLayout.id;
    return normalizeWorkbench(base);
  }
  base.layouts = rawLayouts
    .filter((layout): layout is RawStudioLayoutResource => isRawLayoutResource(layout))
    .map((layout, index) =>
      normalizeRawLayout(
        layout,
        fallbackLayout ?? {
          id:
            typeof layout.id === "string" && layout.id.trim().length > 0
              ? layout.id
              : buildDefaultLayoutId(window.id, `${base.id}-${index}`),
          label:
            typeof layout.label === "string" && layout.label.trim().length > 0
              ? layout.label
              : buildDefaultLayoutLabel(base.label),
          dock:
            isDockNode(layout.dock)
              ? layout.dock
              : {
                  nodeType: "panel",
                  panelId: buildDefaultPanelId(base.id),
                  editorId: base.defaultEditorId ?? "home",
                },
        }
      )
    );
  if (base.layouts.length === 0) {
    return fallbackLayout
      ? normalizeWorkbench({
          ...base,
          defaultLayoutId: fallbackLayout.id,
          layouts: [fallbackLayout],
        })
      : null;
  }
  if (
    !base.defaultLayoutId ||
    !base.layouts.some((layout) => layout.id === base.defaultLayoutId)
  ) {
    base.defaultLayoutId = base.layouts[0]?.id;
  }
  return normalizeWorkbench(base);
}

function expandWindowDefaults(window: RawStudioWindowResource): StudioWindowResource {
  const normalizedWindow: StudioWindowResource = {
    id: window.id as string,
    label: window.label as string,
    windowRole: window.windowRole as "main" | "child",
    defaultWorkbenchId:
      typeof window.defaultWorkbenchId === "string"
        ? window.defaultWorkbenchId
        : undefined,
    workbenches: [],
  };
  normalizedWindow.workbenches = (window.workbenches as unknown[])
    .filter((workbench): workbench is RawStudioWorkbenchResource =>
      isRawWorkbenchResource(workbench)
    )
    .map((workbench) => expandWorkbenchDefaults(normalizedWindow, workbench))
    .filter((workbench): workbench is StudioWorkbenchResource => workbench !== null);
  if (
    !normalizedWindow.defaultWorkbenchId ||
    !normalizedWindow.workbenches.some(
      (workbench) => workbench.id === normalizedWindow.defaultWorkbenchId
    )
  ) {
    normalizedWindow.defaultWorkbenchId = normalizedWindow.workbenches[0]?.id;
  }
  return normalizeWindow(normalizedWindow);
}

function normalizeWorkbench(
  workbench: StudioWorkbenchResource
): StudioWorkbenchResource {
  return {
    id: workbench.id,
    ...(workbench.path !== undefined ? { path: workbench.path } : {}),
    label: workbench.label,
    ...(workbench.group !== undefined ? { group: workbench.group } : {}),
    ...(workbench.defaultEditorId !== undefined
      ? { defaultEditorId: workbench.defaultEditorId }
      : {}),
    ...(workbench.defaultLayoutId !== undefined
      ? { defaultLayoutId: workbench.defaultLayoutId }
      : {}),
    layouts: workbench.layouts.map((layout) => normalizeLayout(layout)),
  };
}

function normalizeWindow(window: StudioWindowResource): StudioWindowResource {
  return {
    id: window.id,
    label: window.label,
    windowRole: window.windowRole,
    ...(window.defaultWorkbenchId !== undefined
      ? { defaultWorkbenchId: window.defaultWorkbenchId }
      : {}),
    workbenches: window.workbenches.map((workbench) =>
      normalizeWorkbench(workbench)
    ),
  };
}

function normalizeStudioDocument(
  model: StudioPersistenceModel
): StudioPersistenceModel {
  return {
    resourceType: "studio_document",
    schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
    id: model.id,
    windows: model.windows.map((window) => normalizeWindow(window)),
  };
}

function expandStudioDocument(
  model: RawStudioPersistenceModel
): StudioPersistenceModel {
  return normalizeStudioDocument({
    resourceType: "studio_document",
    schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
    id: model.id as string,
    windows: (model.windows as unknown[])
      .filter((window): window is RawStudioWindowResource => isRawWindowResource(window))
      .map((window) => expandWindowDefaults(window)),
  });
}

function dockNodesEqual(left: StudioDockNode, right: StudioDockNode): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function layoutsEqual(
  left: StudioLayoutResource,
  right: StudioLayoutResource
): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    dockNodesEqual(left.dock, right.dock) &&
    JSON.stringify(left.floatingPanels ?? []) === JSON.stringify(right.floatingPanels ?? [])
  );
}

function pruneLayoutDefaults(
  layout: StudioLayoutResource,
  fallback: StudioLayoutResource | null
): Record<string, unknown> {
  if (fallback && layoutsEqual(layout, normalizeLayout(fallback))) {
    return {};
  }
  return {
    id: fallback && layout.id === fallback.id ? undefined : layout.id,
    label: fallback && layout.label === fallback.label ? undefined : layout.label,
    dock: fallback && dockNodesEqual(layout.dock, fallback.dock) ? undefined : layout.dock,
    floatingPanels:
      layout.floatingPanels && layout.floatingPanels.length > 0
        ? layout.floatingPanels
        : undefined,
  };
}

function pruneWorkbenchDefaults(
  window: StudioWindowResource,
  workbench: StudioWorkbenchResource
): Record<string, unknown> {
  const fallbackLayout = buildDefaultLayout(window, workbench);
  const defaultLayoutId = fallbackLayout?.id;
  const hasOnlyDefaultLayout =
    fallbackLayout &&
    workbench.layouts.length === 1 &&
    layoutsEqual(workbench.layouts[0]!, normalizeLayout(fallbackLayout)) &&
    workbench.defaultLayoutId === defaultLayoutId;

  const prunedLayouts = hasOnlyDefaultLayout
    ? undefined
    : workbench.layouts.map((layout) =>
        pruneLayoutDefaults(
          layout,
          fallbackLayout && layout.id === fallbackLayout.id ? fallbackLayout : null
        )
      );

  return {
    id: workbench.id,
    path:
      workbench.path === buildDefaultWorkbenchPath(workbench.id)
        ? undefined
        : workbench.path,
    label: workbench.label,
    group: workbench.group,
    defaultEditorId: workbench.defaultEditorId,
    defaultLayoutId:
      hasOnlyDefaultLayout ||
      (defaultLayoutId && workbench.defaultLayoutId === defaultLayoutId)
        ? undefined
        : workbench.defaultLayoutId,
    layouts: prunedLayouts,
  };
}

function pruneWindowDefaults(window: StudioWindowResource): Record<string, unknown> {
  return {
    id: window.id,
    label: window.label,
    windowRole: window.windowRole,
    defaultWorkbenchId:
      window.defaultWorkbenchId === window.workbenches[0]?.id
        ? undefined
        : window.defaultWorkbenchId,
    workbenches: window.workbenches.map((workbench) =>
      pruneWorkbenchDefaults(window, workbench)
    ),
  };
}

function pruneStudioDocument(
  model: StudioPersistenceModel
): Record<string, unknown> {
  return {
    resourceType: "studio_document",
    schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
    id: model.id,
    windows: model.windows.map((window) => pruneWindowDefaults(window)),
  };
}

let bundledStudioSeedTemplate: StudioPersistenceModel | null = null;

function getBundledStudioSeedTemplate(): StudioPersistenceModel {
  if (bundledStudioSeedTemplate) {
    return bundledStudioSeedTemplate;
  }
  const parsed = parse(studioSeedSource);
  if (!isRawStudioDocument(parsed)) {
    throw new Error("Bundled Studio seed document is invalid");
  }
  bundledStudioSeedTemplate = expandStudioDocument(parsed);
  return bundledStudioSeedTemplate;
}

function cloneWorkbench(workbench: StudioWorkbenchResource): StudioWorkbenchResource {
  return normalizeWorkbench(workbench);
}

function createSeedChildWorkbench(
  windowId: string
): StudioWorkbenchResource {
  const workbenchId = "new-workbench";
  const layoutId = `${windowId}:${workbenchId}:default`;
  return {
    id: workbenchId,
    path: "/home",
    label: "New Workbench",
    group: "project-select",
    defaultEditorId: "home",
    defaultLayoutId: layoutId,
    layouts: [
      {
        id: layoutId,
        label: "New Workbench | Default",
        dock: {
          nodeType: "panel",
          panelId: `${windowId}-panel`,
          editorId: "home",
        },
        floatingPanels: [],
      },
    ],
  };
}

export function createSeedStudioWindowResource(
  windowId: string,
  windowRole: "main" | "child"
): StudioWindowResource {
  const seed = getBundledStudioSeedTemplate();
  const seedWindow = seed.windows[0];
  if (!seedWindow) {
    throw new Error("Bundled Studio seed document does not define a main window");
  }

  if (windowRole === "main") {
    return {
      id: windowId,
      label: seedWindow.label,
      windowRole: "main",
      defaultWorkbenchId: seedWindow.defaultWorkbenchId,
      workbenches: seedWindow.workbenches.map((workbench) =>
        cloneWorkbench(workbench)
      ),
    };
  }

  const defaultWorkbench = createSeedChildWorkbench(windowId);

  return {
    id: windowId,
    label: "Studio Window",
    windowRole: "child",
    defaultWorkbenchId: defaultWorkbench.id,
    workbenches: [defaultWorkbench],
  };
}

export function createSeedStudioPersistenceModel(
  projectPath?: string
): StudioPersistenceModel {
  const seed = getBundledStudioSeedTemplate();
  return {
    resourceType: "studio_document",
    schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
    id: projectPath ? deriveStudioDocumentId(projectPath) : seed.id,
    windows: seed.windows.map((window) => ({
      id: window.id,
      label: window.label,
      windowRole: window.windowRole,
      defaultWorkbenchId: window.defaultWorkbenchId,
      workbenches: window.workbenches.map((workbench) =>
        cloneWorkbench(workbench)
      ),
    })),
  };
}

export function getSeedStudioWorkbenches(): StudioWorkbenchResource[] {
  return createSeedStudioPersistenceModel().windows[0]?.workbenches ?? [];
}

export async function loadStudioDocument(
  projectPath: string,
  store: StudioPersistenceStore
): Promise<StudioPersistenceModel> {
  const raw = await store.readStudioDocument(projectPath);
  if (!raw) {
    return createEmptyStudioPersistenceModel(projectPath);
  }
  try {
    const parsed = parse(raw);
    if (isRawStudioDocument(parsed)) {
      return expandStudioDocument(parsed);
    }
  } catch {
    // Invalid documents are treated as missing until stricter error handling lands.
  }
  return createEmptyStudioPersistenceModel(projectPath);
}

export function hasStudioDocument(model: StudioPersistenceModel): boolean {
  return model.windows.length > 0;
}

export async function writeStudioDocument(
  projectPath: string,
  store: StudioPersistenceStore,
  model: StudioPersistenceModel
): Promise<void> {
  const normalized = normalizeStudioDocument({
    ...model,
    id: model.id || deriveStudioDocumentId(projectPath),
  });
  const content = stringify(pruneStudioDocument(normalized), {
    lineWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
  await store.writeStudioDocument(projectPath, content);
}
