import React, { createContext, useContext } from "react";
import workspacesSource from "../config/app-workspaces.yaml?raw";

type WorkspaceGroup = "project-select" | "dev" | "test" | "help";

export type WorkspaceConfig = {
  id: string;
  path: string;
  label: string;
  group: WorkspaceGroup;
  module: string;
};

export type AppConfig = {
  workspaces: WorkspaceConfig[];
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

function parseYamlWorkspaces(raw: string): WorkspaceConfig[] {
  const workspaces: WorkspaceConfig[] = [];
  let current: Partial<WorkspaceConfig> | null = null;
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === "workspaces:") continue;

    if (trimmed.startsWith("-")) {
      if (current) workspaces.push(current as WorkspaceConfig);
      current = {};
      const remainder = trimmed.slice(1).trim();
      if (remainder) {
        const [key, value] = remainder.split(/:(.+)/);
        if (key && value !== undefined) {
          (current as any)[key.trim()] = parseValue(value);
        }
      }
      continue;
    }

    if (!current) {
      throw new Error("Malformed workspaces configuration");
    }

    const [key, value] = trimmed.split(/:(.+)/);
    if (!key || value === undefined) continue;
    (current as any)[key.trim()] = parseValue(value);
  }

  if (current) {
    workspaces.push(current as WorkspaceConfig);
  }

  return workspaces.map((workspace) => {
    const required: (keyof WorkspaceConfig)[] = [
      "id",
      "path",
      "label",
      "group",
      "module",
    ];
    for (const key of required) {
      if (!workspace[key]) {
        throw new Error(`Workspace '${workspace.id ?? "unknown"}' missing ${key}`);
      }
    }
    return workspace as WorkspaceConfig;
  });
}

function loadConfig(): AppConfig {
  const workspaces = parseYamlWorkspaces(workspacesSource);
  return { workspaces };
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

export function useAppConfig(): AppConfig {
  return useContext(AppConfigContext);
}

export const WorkspacesConfig = config.workspaces;
