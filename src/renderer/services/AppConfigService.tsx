import React, { createContext, useContext } from "react";
import editorsSource from "../config/app-editors.yaml?raw";
import { useProjectContext } from "../data-sources/launcher/internal/ProjectContext";
import {
  createSeedStudioPersistenceModel,
  getBrowserStudioPersistenceStore,
  getSeedStudioWorkbenches,
  loadStudioPersistence,
  type StudioPersistenceModel,
  type StudioWorkbenchGroup,
  type StudioWorkbenchResource,
  type StudioWindowResource,
} from "./studio-persistence";
import { getWindowScope } from "../utils/windowSession";

export type EditorConfig = {
  id: string;
  label: string;
  module: string;
};

export type WorkbenchConfig = {
  id: string;
  path: string;
  label: string;
  group: StudioWorkbenchGroup;
  editor: string;
};

export type AppConfig = {
  workbenches: WorkbenchConfig[];
  windows: StudioWindowResource[];
  editors: EditorConfig[];
  loading: boolean;
  source: "canonical" | "seed";
};

function parseValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

type RawEntry = Record<string, string>;

function parseYamlList(raw: string, rootKey: string): RawEntry[] {
  const entries: RawEntry[] = [];
  let current: RawEntry | null = null;
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === `${rootKey}:`) continue;

    if (trimmed.startsWith("-")) {
      if (current) entries.push(current);
      current = {};
      const remainder = trimmed.slice(1).trim();
      if (remainder) {
        const [key, value] = remainder.split(/:(.+)/);
        if (key && value !== undefined) {
          current[key.trim()] = parseValue(value);
        }
      }
      continue;
    }

    if (!current) {
      throw new Error(`Malformed ${rootKey} configuration`);
    }

    const [key, value] = trimmed.split(/:(.+)/);
    if (!key || value === undefined) continue;
    current[key.trim()] = parseValue(value);
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

function parseYamlEditors(raw: string): EditorConfig[] {
  const entries = parseYamlList(raw, "editors");
  return entries.map((entry) => {
    const required: (keyof EditorConfig)[] = ["id", "label", "module"];
    for (const key of required) {
      if (!entry[key]) {
        throw new Error(`Editor '${entry.id ?? "unknown"}' missing ${key}`);
      }
    }
    return entry as EditorConfig;
  });
}

const EditorsConfig = parseYamlEditors(editorsSource);

function toWorkbenchConfig(
  workbench: StudioWorkbenchResource,
  seedFallback: StudioWorkbenchResource | undefined
): WorkbenchConfig | null {
  const path = workbench.path ?? seedFallback?.path;
  const group = workbench.group ?? seedFallback?.group;
  const editor = workbench.defaultEditorId ?? seedFallback?.defaultEditorId;
  if (!path || !group || !editor) {
    return null;
  }
  return {
    id: workbench.id,
    path,
    label: workbench.label || seedFallback?.label || workbench.id,
    group,
    editor,
  };
}

function getDocumentWindowId(windowScope: string): string {
  return windowScope === "primary" ? "main" : windowScope;
}

function getDefaultWindows(): StudioWindowResource[] {
  return createSeedStudioPersistenceModel().windows;
}

function getSeedWorkbenchMap(): Map<string, StudioWorkbenchResource> {
  return new Map(
    getSeedStudioWorkbenches().map((workbench) => [workbench.id, workbench])
  );
}

function resolveWindowForScope(
  model: StudioPersistenceModel,
  windowScope: string
): StudioWindowResource | undefined {
  const targetWindowId = getDocumentWindowId(windowScope);
  return (
    model.windows.find((window) => window.id === targetWindowId) ??
    model.windows.find((window) => window.id === "main") ??
    model.windows[0]
  );
}

function deriveWorkbenchConfigs(
  model: StudioPersistenceModel,
  windowScope: string
): WorkbenchConfig[] {
  const window = resolveWindowForScope(model, windowScope);
  if (!window) {
    return [];
  }
  const seedWorkbenchMap = getSeedWorkbenchMap();
  return window.workbenches
    .map((workbench) =>
      toWorkbenchConfig(workbench, seedWorkbenchMap.get(workbench.id))
    )
    .filter((workbench): workbench is WorkbenchConfig => workbench !== null);
}

export const WorkbenchesConfig = deriveWorkbenchConfigs(
  createSeedStudioPersistenceModel(),
  "main"
);

const defaultConfig: AppConfig = {
  workbenches: WorkbenchesConfig,
  windows: getDefaultWindows(),
  editors: EditorsConfig,
  loading: false,
  source: "seed",
};

const AppConfigContext = createContext<AppConfig>(defaultConfig);

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const { projectPath } = useProjectContext();
  const studioPersistenceStore = getBrowserStudioPersistenceStore();
  const windowScope = getWindowScope();
  const [config, setConfig] = React.useState<AppConfig>(defaultConfig);

  const reloadConfig = React.useCallback(async () => {
    if (!projectPath || !studioPersistenceStore) {
      const seedModel = createSeedStudioPersistenceModel();
      setConfig({
        workbenches: deriveWorkbenchConfigs(seedModel, windowScope),
        windows: seedModel.windows,
        editors: EditorsConfig,
        loading: false,
        source: "seed",
      });
      return;
    }

    await studioPersistenceStore.ensureStudioDocument(projectPath);
    const loaded = await loadStudioPersistence(projectPath, studioPersistenceStore);
    setConfig({
      workbenches: deriveWorkbenchConfigs(loaded.model, windowScope),
      windows: loaded.model.windows,
      editors: EditorsConfig,
      loading: false,
      source: loaded.source,
    });
  }, [projectPath, studioPersistenceStore, windowScope]);

  React.useEffect(() => {
    setConfig((current) => ({ ...current, loading: true }));
    void reloadConfig();
  }, [reloadConfig]);

  React.useEffect(() => {
    if (!studioPersistenceStore?.onDocumentChanged || !projectPath) {
      return;
    }
    return studioPersistenceStore.onDocumentChanged((changedProjectPath) => {
      if (changedProjectPath !== projectPath) {
        return;
      }
      void reloadConfig();
    });
  }, [projectPath, reloadConfig, studioPersistenceStore]);

  return (
    <AppConfigContext.Provider value={config}>
      {children}
    </AppConfigContext.Provider>
  );
}

export const useAppConfig = (): AppConfig => {
  return useContext(AppConfigContext);
};

export { EditorsConfig };
