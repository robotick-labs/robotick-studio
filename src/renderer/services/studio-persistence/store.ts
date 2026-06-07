import type { StudioResourceDirectory } from "./types";

export type StudioPersistenceStore = {
  listResourceFiles: (
    projectPath: string,
    directory: StudioResourceDirectory
  ) => Promise<string[]>;
  readResourceFile: (
    projectPath: string,
    resourcePath: string
  ) => Promise<string | null>;
  writeResourceFile: (
    projectPath: string,
    resourcePath: string,
    content: string
  ) => Promise<void>;
  readLegacyRendererStorage: (
    projectPath: string
  ) => Promise<Record<string, string> | null>;
};

export function getBrowserStudioPersistenceStore(): StudioPersistenceStore | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.robotick?.studioPersistence ?? null;
}
