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

function normalizeLayout(layout: StudioLayoutResource): StudioLayoutResource {
  return {
    id: layout.id,
    label: layout.label,
    dock: cloneDockNode(layout.dock),
    floatingPanels: layout.floatingPanels?.map((panel) => ({
      id: panel.id,
      editorId: panel.editorId,
      label: panel.label,
      settings: panel.settings ? { ...panel.settings } : undefined,
      frame: { ...panel.frame },
    })),
  };
}

function normalizeWorkbench(
  workbench: StudioWorkbenchResource
): StudioWorkbenchResource {
  return {
    id: workbench.id,
    path: workbench.path,
    label: workbench.label,
    group: workbench.group,
    defaultEditorId: workbench.defaultEditorId,
    defaultLayoutId: workbench.defaultLayoutId,
    layouts: workbench.layouts.map((layout) => normalizeLayout(layout)),
  };
}

function normalizeWindow(window: StudioWindowResource): StudioWindowResource {
  return {
    id: window.id,
    label: window.label,
    windowRole: window.windowRole,
    defaultWorkbenchId: window.defaultWorkbenchId,
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

let bundledStudioSeedTemplate: StudioPersistenceModel | null = null;

function getBundledStudioSeedTemplate(): StudioPersistenceModel {
  if (bundledStudioSeedTemplate) {
    return bundledStudioSeedTemplate;
  }
  const parsed = parse(studioSeedSource);
  if (!isStudioDocument(parsed)) {
    throw new Error("Bundled Studio seed document is invalid");
  }
  bundledStudioSeedTemplate = normalizeStudioDocument(parsed);
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
    if (isStudioDocument(parsed)) {
      return normalizeStudioDocument(parsed);
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
  const content = stringify(normalized, {
    lineWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
  await store.writeStudioDocument(projectPath, content);
}
