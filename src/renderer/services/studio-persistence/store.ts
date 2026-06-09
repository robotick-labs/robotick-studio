export type StudioPersistenceStore = {
  readStudioDocument: (projectPath: string) => Promise<string | null>;
  ensureStudioDocument: (projectPath: string) => Promise<void>;
  writeStudioDocument: (projectPath: string, content: string) => Promise<void>;
  onDocumentChanged?: (
    callback: (projectPath: string) => void
  ) => () => void;
};

export function getBrowserStudioPersistenceStore(): StudioPersistenceStore | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.robotick?.studioPersistence ?? null;
}
