import React from "react";
import type { EditorConfig } from "./AppConfigService";
import { EditorsConfig } from "./AppConfigService";

type EditorComponent = React.LazyExoticComponent<
  React.ComponentType<Record<string, never>>
>;

export type EditorEntry = EditorConfig & {
  Component: EditorComponent;
};

const moduleMap = import.meta.glob("../components/editors/**/*.tsx");

function resolveModuleLoader(modulePath: string) {
  if (moduleMap[modulePath]) {
    return moduleMap[modulePath];
  }
  if (modulePath.startsWith("./")) {
    const altPath = `../${modulePath.slice(2)}`;
    if (moduleMap[altPath]) {
      return moduleMap[altPath];
    }
  }
  return undefined;
}

const editorEntries: EditorEntry[] = EditorsConfig.map((editor) => {
  const loader = resolveModuleLoader(editor.module);
  if (!loader) {
    throw new Error(
      `Editor '${editor.id}' references unknown module: ${editor.module}`,
    );
  }
  const Component = React.lazy(
    loader as () => Promise<{
      default: React.ComponentType<Record<string, never>>;
    }>,
  );

  return { ...editor, Component };
});

const editorMap = new Map(editorEntries.map((entry) => [entry.id, entry]));

export function getEditorEntry(editorId: string): EditorEntry {
  const entry = editorMap.get(editorId);
  if (!entry) {
    throw new Error(`Unknown editor id: ${editorId}`);
  }
  return entry;
}

export function listEditorEntries(): EditorEntry[] {
  return editorEntries;
}
