import fs from "fs";
import path from "path";
import { parse, stringify } from "yaml";
import type { BrowserWindowConstructor } from "./bootstrap";
import type { IpcMain } from "electron";

export type StudioDockNode =
  | {
      nodeType: "panel";
      panelId: string;
      editorId: string;
      label?: string;
      settings?: Record<string, unknown>;
    }
  | {
      nodeType: "split";
      direction: "horizontal" | "vertical";
      ratio: number;
      children: [StudioDockNode, StudioDockNode];
    };

export type StudioFloatingPanel = {
  id: string;
  editorId: string;
  label?: string;
  settings?: Record<string, unknown>;
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    minWidth?: number;
    minHeight?: number;
  };
};

export type StudioLayout = {
  id: string;
  label: string;
  dock: StudioDockNode;
  floatingPanels?: StudioFloatingPanel[];
};

export type StudioWorkbench = {
  id: string;
  path?: string;
  label: string;
  group?: "project-select" | "dev" | "test" | "help";
  defaultEditorId?: string;
  defaultLayoutId?: string;
  layouts: StudioLayout[];
};

export type StudioWindow = {
  id: string;
  label: string;
  windowRole: "main" | "child";
  defaultWorkbenchId?: string;
  workbenches: StudioWorkbench[];
};

export type StudioDocument = {
  resourceType: "studio_document";
  schemaVersion: 1;
  id: string;
  windows: StudioWindow[];
};

type WritePayload = {
  projectPath: string;
  content: string;
  windowScope?: string;
};

type RawStudioDockNode = Record<string, unknown>;
type RawStudioLayout = Record<string, unknown>;
type RawStudioWorkbench = Record<string, unknown>;
type RawStudioWindow = Record<string, unknown>;
type RawStudioDocument = Record<string, unknown>;

const STUDIO_DOCUMENT_CHANNEL = "robotick-studio-persistence:changed";
const STUDIO_TEMPLATE_PATH = path.resolve(
  __dirname,
  "../../../studio.template.yaml"
);

function looksLikeProjectFilePath(value: string): boolean {
  return /\.(ya?ml|json|toml)$/i.test(value.trim());
}

function resolveProjectDirectory(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  if (looksLikeProjectFilePath(projectPath)) {
    return path.dirname(resolved);
  }
  try {
    return fs.statSync(resolved).isFile() ? path.dirname(resolved) : resolved;
  } catch {
    return resolved;
  }
}

function getStudioDocumentId(projectPath: string): string {
  const name = resolveProjectDirectory(projectPath)
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop();
  return name ? `${name}-studio` : "studio";
}

export function getStudioDocumentPath(projectPath: string): string {
  return path.join(resolveProjectDirectory(projectPath), "studio", "studio.yaml");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value);
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

function isFloatingPanel(value: unknown): value is StudioFloatingPanel {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.editorId === "string" &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.settings === undefined || isStringRecord(value.settings)) &&
    isObject(value.frame) &&
    typeof value.frame.x === "number" &&
    typeof value.frame.y === "number" &&
    typeof value.frame.width === "number" &&
    typeof value.frame.height === "number" &&
    (value.frame.minWidth === undefined ||
      typeof value.frame.minWidth === "number") &&
    (value.frame.minHeight === undefined ||
      typeof value.frame.minHeight === "number")
  );
}

function isLayout(value: unknown): value is StudioLayout {
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

function isWorkbench(value: unknown): value is StudioWorkbench {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    (value.path === undefined || typeof value.path === "string") &&
    typeof value.label === "string" &&
    (value.group === undefined ||
      value.group === "project-select" ||
      value.group === "dev" ||
      value.group === "test" ||
      value.group === "help") &&
    (value.defaultEditorId === undefined ||
      typeof value.defaultEditorId === "string") &&
    (value.defaultLayoutId === undefined ||
      typeof value.defaultLayoutId === "string") &&
    Array.isArray(value.layouts) &&
    value.layouts.every((layout) => isLayout(layout))
  );
}

function isRawLayout(value: unknown): value is RawStudioLayout {
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

function isRawWorkbench(value: unknown): value is RawStudioWorkbench {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    (value.path === undefined || typeof value.path === "string") &&
    typeof value.label === "string" &&
    (value.group === undefined ||
      value.group === "project-select" ||
      value.group === "dev" ||
      value.group === "test" ||
      value.group === "help") &&
    (value.defaultEditorId === undefined ||
      typeof value.defaultEditorId === "string") &&
    (value.defaultLayoutId === undefined ||
      typeof value.defaultLayoutId === "string") &&
    (value.layouts === undefined ||
      (Array.isArray(value.layouts) &&
        value.layouts.every((layout) => isRawLayout(layout))))
  );
}

function isRawWindow(value: unknown): value is RawStudioWindow {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.windowRole === "main" || value.windowRole === "child") &&
    (value.defaultWorkbenchId === undefined ||
      typeof value.defaultWorkbenchId === "string") &&
    Array.isArray(value.workbenches) &&
    value.workbenches.every((workbench) => isRawWorkbench(workbench))
  );
}

function isRawStudioDocument(value: unknown): value is RawStudioDocument {
  return (
    isObject(value) &&
    value.resourceType === "studio_document" &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    Array.isArray(value.windows) &&
    value.windows.every((window) => isRawWindow(window))
  );
}

function isWindow(value: unknown): value is StudioWindow {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.windowRole === "main" || value.windowRole === "child") &&
    (value.defaultWorkbenchId === undefined ||
      typeof value.defaultWorkbenchId === "string") &&
    Array.isArray(value.workbenches) &&
    value.workbenches.every((workbench) => isWorkbench(workbench))
  );
}

function isStudioDocument(value: unknown): value is StudioDocument {
  return (
    isObject(value) &&
    value.resourceType === "studio_document" &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    Array.isArray(value.windows) &&
    value.windows.every((window) => isWindow(window))
  );
}

function cloneDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let bundledTemplate: StudioDocument | null = null;

function getBundledTemplate(): StudioDocument {
  if (bundledTemplate) {
    return cloneDocument(bundledTemplate);
  }
  const raw = fs.readFileSync(STUDIO_TEMPLATE_PATH, "utf-8");
  const parsed = parse(raw);
  if (!isRawStudioDocument(parsed)) {
    throw new Error("Bundled Studio template is invalid");
  }
  bundledTemplate = expandStudioDocument(parsed);
  return cloneDocument(bundledTemplate);
}

function cloneDockNode(node: StudioDockNode): StudioDockNode {
  return JSON.parse(JSON.stringify(node)) as StudioDockNode;
}

function normalizeLayout(layout: StudioLayout): StudioLayout {
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

function normalizeWorkbench(workbench: StudioWorkbench): StudioWorkbench {
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

function normalizeWindow(window: StudioWindow): StudioWindow {
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

function normalizeStudioDocument(document: StudioDocument): StudioDocument {
  return {
    resourceType: "studio_document",
    schemaVersion: 1,
    id: document.id,
    windows: document.windows.map((window) => normalizeWindow(window)),
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
  window: Pick<StudioWindow, "id">,
  workbench: Pick<StudioWorkbench, "id" | "label" | "defaultEditorId">
): StudioLayout | null {
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

function normalizeRawLayout(layout: RawStudioLayout, fallback: StudioLayout): StudioLayout {
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
  window: Pick<StudioWindow, "id">,
  workbench: RawStudioWorkbench
): StudioWorkbench | null {
  const base: StudioWorkbench = {
    id: workbench.id as string,
    path:
      typeof workbench.path === "string" && workbench.path.trim().length > 0
        ? workbench.path
        : buildDefaultWorkbenchPath(workbench.id as string),
    label: workbench.label as string,
    group:
      workbench.group === "project-select" ||
      workbench.group === "dev" ||
      workbench.group === "test" ||
      workbench.group === "help"
        ? workbench.group
        : undefined,
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
    return normalizeWorkbench({
      ...base,
      defaultLayoutId: fallbackLayout.id,
      layouts: [fallbackLayout],
    });
  }
  base.layouts = rawLayouts
    .filter((layout): layout is RawStudioLayout => isRawLayout(layout))
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

function expandWindowDefaults(window: RawStudioWindow): StudioWindow {
  const normalizedWindow: StudioWindow = {
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
    .filter((workbench): workbench is RawStudioWorkbench => isRawWorkbench(workbench))
    .map((workbench) => expandWorkbenchDefaults(normalizedWindow, workbench))
    .filter((workbench): workbench is StudioWorkbench => workbench !== null);
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

function expandStudioDocument(document: RawStudioDocument): StudioDocument {
  return normalizeStudioDocument({
    resourceType: "studio_document",
    schemaVersion: 1,
    id: document.id as string,
    windows: (document.windows as unknown[])
      .filter((window): window is RawStudioWindow => isRawWindow(window))
      .map((window) => expandWindowDefaults(window)),
  });
}

function dockNodesEqual(left: StudioDockNode, right: StudioDockNode): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function layoutsEqual(left: StudioLayout, right: StudioLayout): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    dockNodesEqual(left.dock, right.dock) &&
    JSON.stringify(left.floatingPanels ?? []) === JSON.stringify(right.floatingPanels ?? [])
  );
}

function pruneLayoutDefaults(layout: StudioLayout, fallback: StudioLayout | null) {
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

function pruneWorkbenchDefaults(window: StudioWindow, workbench: StudioWorkbench) {
  const fallbackLayout = buildDefaultLayout(window, workbench);
  const defaultLayoutId = fallbackLayout?.id;
  const hasOnlyDefaultLayout =
    fallbackLayout &&
    workbench.layouts.length === 1 &&
    layoutsEqual(workbench.layouts[0]!, normalizeLayout(fallbackLayout)) &&
    workbench.defaultLayoutId === defaultLayoutId;

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
    layouts: hasOnlyDefaultLayout
      ? undefined
      : workbench.layouts.map((layout) =>
          pruneLayoutDefaults(
            layout,
            fallbackLayout && layout.id === fallbackLayout.id ? fallbackLayout : null
          )
        ),
  };
}

function pruneStudioDocument(document: StudioDocument) {
  return {
    resourceType: "studio_document",
    schemaVersion: 1,
    id: document.id,
    windows: document.windows.map((window) => ({
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
    })),
  };
}

export function createSeedStudioDocument(projectPath: string): StudioDocument {
  const template = getBundledTemplate();
  template.id = getStudioDocumentId(projectPath);
  return normalizeStudioDocument(template);
}

function normalizeWindowScope(windowScope?: string): string {
  const normalized = windowScope?.trim();
  if (!normalized || normalized === "primary") {
    return "main";
  }
  return normalized;
}

function createSeedChildWorkbench(windowId: string): StudioWorkbench {
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

function createSeedChildWindow(windowId: string): StudioWindow {
  const defaultWorkbench = createSeedChildWorkbench(windowId);
  return {
    id: windowId,
    label: "Studio Window",
    windowRole: "child",
    defaultWorkbenchId: defaultWorkbench.id,
    workbenches: [defaultWorkbench],
  };
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, content, "utf-8");
  await fs.promises.rename(tempPath, filePath);
}

function serializeStudioDocument(document: StudioDocument): string {
  return stringify(pruneStudioDocument(normalizeStudioDocument(document)), {
    lineWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
}

async function readStudioDocumentFromDisk(
  projectPath: string
): Promise<StudioDocument | null> {
  const filePath = getStudioDocumentPath(projectPath);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = parse(raw);
    return isRawStudioDocument(parsed) ? expandStudioDocument(parsed) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeStudioDocumentToDisk(
  projectPath: string,
  document: StudioDocument
): Promise<void> {
  await writeFileAtomic(
    getStudioDocumentPath(projectPath),
    serializeStudioDocument(document)
  );
}

export async function ensureStudioDocument(projectPath: string) {
  const existing = await readStudioDocumentFromDisk(projectPath);
  if (existing) {
    return existing;
  }
  const seeded = createSeedStudioDocument(projectPath);
  await writeStudioDocumentToDisk(projectPath, seeded);
  return seeded;
}

function findIncomingWindow(
  incoming: StudioDocument,
  windowId: string
): StudioWindow | null {
  return (
    incoming.windows.find((window) => window.id === windowId) ??
    (windowId === "main"
      ? incoming.windows.find((window) => window.windowRole === "main")
      : null) ??
    incoming.windows[0] ??
    null
  );
}

export function mergeWindowIntoDocument(
  current: StudioDocument,
  incoming: StudioDocument,
  windowScope?: string
): StudioDocument {
  const windowId = normalizeWindowScope(windowScope);
  const incomingWindow = findIncomingWindow(incoming, windowId);
  if (!incomingWindow) {
    return current;
  }
  const next = cloneDocument(current);
  const existingIndex = next.windows.findIndex((window) => window.id === windowId);
  if (existingIndex >= 0) {
    next.windows[existingIndex] = cloneDocument(incomingWindow);
    return next;
  }
  next.windows.push(cloneDocument(incomingWindow));
  return next;
}

export async function ensureChildWindowInDocument(
  projectPath: string,
  windowId: string
) {
  const current = await ensureStudioDocument(projectPath);
  if (current.windows.some((window) => window.id === windowId)) {
    return current;
  }
  const next = cloneDocument(current);
  next.windows.push(createSeedChildWindow(windowId));
  await writeStudioDocumentToDisk(projectPath, next);
  return next;
}

export async function listChildWindowIdsInDocument(
  projectPath: string
): Promise<string[]> {
  const current = await ensureStudioDocument(projectPath);
  return current.windows
    .filter((window) => window.windowRole === "child")
    .map((window) => window.id);
}

export async function deleteChildWindowFromDocument(
  projectPath: string,
  windowId: string
): Promise<boolean> {
  const normalizedWindowId = windowId.trim();
  if (!normalizedWindowId) {
    return false;
  }
  const current = await ensureStudioDocument(projectPath);
  const nextWindows = current.windows.filter(
    (window) =>
      !(window.id === normalizedWindowId && window.windowRole === "child")
  );
  if (nextWindows.length === current.windows.length) {
    return false;
  }
  await writeStudioDocumentToDisk(projectPath, {
    ...current,
    windows: nextWindows,
  });
  return true;
}

function notifyDocumentChanged(
  BrowserWindow: BrowserWindowConstructor,
  projectPath: string
) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(STUDIO_DOCUMENT_CHANNEL, {
        projectPath,
      });
    } catch {
      // ignore renderer notification failures
    }
  }
}

export function registerStudioPersistence(
  ipcMain: IpcMain,
  BrowserWindow: BrowserWindowConstructor
) {
  ipcMain.handle(
    "robotick-studio-persistence:read",
    async (_event, payload: { projectPath: string }) => {
      const current = await readStudioDocumentFromDisk(payload.projectPath);
      return current ? serializeStudioDocument(current) : null;
    }
  );

  ipcMain.handle(
    "robotick-studio-persistence:ensure",
    async (_event, payload: { projectPath: string }) => {
      const existed = await readStudioDocumentFromDisk(payload.projectPath);
      if (existed) {
        return;
      }
      await ensureStudioDocument(payload.projectPath);
      notifyDocumentChanged(BrowserWindow, payload.projectPath);
    }
  );

  ipcMain.handle(
    "robotick-studio-persistence:write",
    async (_event, payload: WritePayload) => {
      const current = await ensureStudioDocument(payload.projectPath);
      const parsed = parse(payload.content);
      if (!isRawStudioDocument(parsed)) {
        throw new Error("Attempted to write invalid Studio document");
      }
      const merged = mergeWindowIntoDocument(
        current,
        expandStudioDocument(parsed),
        payload.windowScope
      );
      await writeStudioDocumentToDisk(payload.projectPath, merged);
      notifyDocumentChanged(BrowserWindow, payload.projectPath);
    }
  );

  ipcMain.handle(
    "robotick-studio-persistence:delete-child-window",
    async (_event, payload: { projectPath: string; windowId: string }) => {
      const deleted = await deleteChildWindowFromDocument(
        payload.projectPath,
        payload.windowId
      );
      if (deleted) {
        notifyDocumentChanged(BrowserWindow, payload.projectPath);
      }
      return { deleted };
    }
  );
}
