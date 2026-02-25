import React, { createContext, useContext } from "react";
import workspacesSource from "../config/app-workspaces.yaml?raw";
import editorsSource from "../config/app-editors.yaml?raw";

type WorkspaceGroup = "project-select" | "dev" | "test" | "help";

export type EditorConfig = {
  id: string;
  label: string;
  module: string;
};

export type WorkspaceConfig = {
  id: string;
  path: string;
  label: string;
  group: WorkspaceGroup;
  editor: string;
};

export type AppConfig = {
  workspaces: WorkspaceConfig[];
  editors: EditorConfig[];
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

function parseYamlWorkspaces(raw: string): WorkspaceConfig[] {
  const entries = parseYamlList(raw, "workspaces");
  const workspaces: WorkspaceConfig[] = [];
  for (const entry of entries) {
    const workspace = entry as Partial<WorkspaceConfig>;
    const required: (keyof WorkspaceConfig)[] = [
      "id",
      "path",
      "label",
      "group",
      "editor",
    ];
    for (const key of required) {
      if (!workspace[key]) {
        throw new Error(`Workspace '${workspace.id ?? "unknown"}' missing ${key}`);
      }
    }
    workspaces.push(workspace as WorkspaceConfig);
  }
  return workspaces;
}

function loadConfig(): AppConfig {
  const workspaces = parseYamlWorkspaces(workspacesSource);
  const editors = parseYamlEditors(editorsSource);
  return { workspaces, editors };
}

const config = loadConfig();

const AppConfigContext = createContext<AppConfig>(config);

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppConfigContext.Provider value={config}>
      {children}
    </AppConfigContext.Provider>
  );
}

export const useAppConfig = (): AppConfig => {
  return useContext(AppConfigContext);
};

export const WorkspacesConfig = config.workspaces;
export const EditorsConfig = config.editors;
