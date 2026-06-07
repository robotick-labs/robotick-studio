import { STUDIO_PERSISTENCE_SCHEMA_VERSION } from "./constants";
import {
  getStudioLayoutResourceRelativePath,
  getStudioResourceDirectoryRelativePath,
  getStudioWindowResourceRelativePath,
  getStudioWorkbenchResourceRelativePath,
} from "./paths";
import type { StudioPersistenceStore } from "./store";
import type {
  StudioLayoutResource,
  StudioPersistenceModel,
  StudioResourceDirectory,
  StudioWindowResource,
  StudioWorkbenchResource,
} from "./types";

export const EMPTY_STUDIO_PERSISTENCE_MODEL: StudioPersistenceModel = {
  windows: [],
  workbenches: [],
  layouts: [],
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidWindowResource(value: unknown): value is StudioWindowResource {
  if (!isObject(value)) return false;
  return (
    value.resourceType === "studio_window" &&
    value.schemaVersion === STUDIO_PERSISTENCE_SCHEMA_VERSION &&
    typeof value.id === "string" &&
    typeof value.slug === "string" &&
    typeof value.label === "string" &&
    (value.windowRole === "main" || value.windowRole === "child") &&
    isStringArray(value.hostedWorkbenchIds)
  );
}

function isValidWorkbenchResource(
  value: unknown
): value is StudioWorkbenchResource {
  if (!isObject(value)) return false;
  return (
    value.resourceType === "studio_workbench" &&
    value.schemaVersion === STUDIO_PERSISTENCE_SCHEMA_VERSION &&
    typeof value.id === "string" &&
    typeof value.slug === "string" &&
    typeof value.label === "string" &&
    typeof value.source === "string" &&
    isStringArray(value.layoutIds)
  );
}

function isValidLayoutResource(value: unknown): value is StudioLayoutResource {
  if (!isObject(value)) return false;
  return (
    value.resourceType === "studio_layout" &&
    value.schemaVersion === STUDIO_PERSISTENCE_SCHEMA_VERSION &&
    typeof value.id === "string" &&
    typeof value.slug === "string" &&
    typeof value.label === "string" &&
    typeof value.workbenchId === "string" &&
    isObject(value.dockTree) &&
    Array.isArray(value.panelInstances)
  );
}

async function readJsonResources<T>(
  projectPath: string,
  store: StudioPersistenceStore,
  directory: StudioResourceDirectory,
  isValid: (value: unknown) => value is T
): Promise<T[]> {
  const resourcePaths = await store.listResourceFiles(projectPath, directory);
  const resources: T[] = [];
  for (const resourcePath of resourcePaths) {
    const raw = await store.readResourceFile(projectPath, resourcePath);
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (isValid(parsed)) {
        resources.push(parsed);
      }
    } catch {
      // Invalid resource files are ignored until schema validation is stricter.
    }
  }
  return resources;
}

export async function loadStudioResourceFiles(
  projectPath: string,
  store: StudioPersistenceStore
): Promise<StudioPersistenceModel> {
  const [windows, workbenches, layouts] = await Promise.all([
    readJsonResources(projectPath, store, "windows", isValidWindowResource),
    readJsonResources(
      projectPath,
      store,
      "workbenches",
      isValidWorkbenchResource
    ),
    readJsonResources(projectPath, store, "layouts", isValidLayoutResource),
  ]);
  return { windows, workbenches, layouts };
}

export function hasStudioResourceFiles(model: StudioPersistenceModel): boolean {
  return (
    model.windows.length > 0 ||
    model.workbenches.length > 0 ||
    model.layouts.length > 0
  );
}

function serializeResource(resource: unknown): string {
  return `${JSON.stringify(resource, null, 2)}\n`;
}

export async function writeStudioResourceFiles(
  projectPath: string,
  store: StudioPersistenceStore,
  model: StudioPersistenceModel
): Promise<void> {
  await Promise.all([
    ...model.windows.map((resource) =>
      store.writeResourceFile(
        projectPath,
        getStudioWindowResourceRelativePath(resource.slug),
        serializeResource(resource)
      )
    ),
    ...model.workbenches.map((resource) =>
      store.writeResourceFile(
        projectPath,
        getStudioWorkbenchResourceRelativePath(resource.slug),
        serializeResource(resource)
      )
    ),
    ...model.layouts.map((resource) =>
      store.writeResourceFile(
        projectPath,
        getStudioLayoutResourceRelativePath(resource.slug),
        serializeResource(resource)
      )
    ),
  ]);
}

export function getStudioResourceDirectories(): string[] {
  return [
    getStudioResourceDirectoryRelativePath("windows"),
    getStudioResourceDirectoryRelativePath("workbenches"),
    getStudioResourceDirectoryRelativePath("layouts"),
  ];
}
