import React, { createContext, useContext } from "react";
import workbenchesSource from "../config/app-workbenches.yaml?raw";
import editorsSource from "../config/app-editors.yaml?raw";

type WorkbenchGroup = "project-select" | "dev" | "test" | "help";

export type EditorConfig = {
  id: string;
  label: string;
  module: string;
};

export type WorkbenchConfig = {
  id: string;
  path: string;
  label: string;
  group: WorkbenchGroup;
  editor: string;
};

export type AppConfig = {
  workbenches: WorkbenchConfig[];
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

function parseYamlWorkbenches(raw: string): WorkbenchConfig[] {
  const entries = parseYamlList(raw, "workbenches");
  const workbenches: WorkbenchConfig[] = [];
  for (const entry of entries) {
    const workbench = entry as Partial<WorkbenchConfig>;
    const required: (keyof WorkbenchConfig)[] = [
      "id",
      "path",
      "label",
      "group",
      "editor",
    ];
    for (const key of required) {
      if (!workbench[key]) {
        throw new Error(`Workbench '${workbench.id ?? "unknown"}' missing ${key}`);
      }
    }
    workbenches.push(workbench as WorkbenchConfig);
  }
  return workbenches;
}

function loadConfig(): AppConfig {
  const workbenches = parseYamlWorkbenches(workbenchesSource);
  const editors = parseYamlEditors(editorsSource);
  return { workbenches, editors };
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

export const WorkbenchesConfig = config.workbenches;
export const EditorsConfig = config.editors;
