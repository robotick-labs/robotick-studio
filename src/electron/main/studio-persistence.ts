import fs from "fs";
import path from "path";
import { parse, stringify } from "yaml";
import type { BrowserWindowConstructor } from "./bootstrap";
import type { IpcMain } from "electron";

type StudioDockNode =
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

type StudioFloatingPanel = {
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

type StudioLayout = {
  id: string;
  label: string;
  dock: StudioDockNode;
  floatingPanels?: StudioFloatingPanel[];
};

type StudioWorkbench = {
  id: string;
  path?: string;
  label: string;
  group?: "project-select" | "dev" | "test" | "help";
  defaultEditorId?: string;
  defaultLayoutId?: string;
  layouts: StudioLayout[];
};

type StudioWindow = {
  id: string;
  label: string;
  windowRole: "main" | "child";
  defaultWorkbenchId?: string;
  workbenches: StudioWorkbench[];
};

type StudioDocument = {
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
  if (!isStudioDocument(parsed)) {
    throw new Error("Bundled Studio template is invalid");
  }
  bundledTemplate = parsed;
  return cloneDocument(bundledTemplate);
}

export function createSeedStudioDocument(projectPath: string): StudioDocument {
  const template = getBundledTemplate();
  template.id = getStudioDocumentId(projectPath);
  return template;
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
  return stringify(document, {
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
    return isStudioDocument(parsed) ? parsed : null;
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
      if (!isStudioDocument(parsed)) {
        throw new Error("Attempted to write invalid Studio document");
      }
      const merged = mergeWindowIntoDocument(current, parsed, payload.windowScope);
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
