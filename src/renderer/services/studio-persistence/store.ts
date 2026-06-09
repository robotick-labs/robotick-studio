export type StudioPersistenceStore = {
  readStudioDocument: (projectPath: string) => Promise<string | null>;
  writeStudioDocument: (projectPath: string, content: string) => Promise<void>;
};

export function getBrowserStudioPersistenceStore(): StudioPersistenceStore | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.robotick?.studioPersistence ?? null;
}
