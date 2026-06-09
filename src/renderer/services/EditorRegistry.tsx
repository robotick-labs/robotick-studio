import React from "react";
import {
  type LauncherService,
  useLauncherService,
} from "../data-sources/launcher";
import { useProjectContext } from "../data-sources/launcher/internal/ProjectContext";
import type { EditorConfig } from "./AppConfigService";
import { EditorsConfig } from "./AppConfigService";
import type { StudioPanelContribution } from "../components/workbenches/PanelInstanceContext";

type EditorComponent = React.LazyExoticComponent<
  React.ComponentType<Record<string, never>>
>;

function isStudioPanelContribution(
  value: unknown
): value is StudioPanelContribution {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { component?: unknown };
  return typeof candidate.component === "function";
}

export type EditorEntry = EditorConfig & {
  Component: EditorComponent;
  source: "builtin" | "plugin";
  pluginId?: string;
  pluginSourceId?: string;
};

type StudioPluginEditorContribution = {
  id: string;
  label: string;
  componentExport: string;
};

type StudioPluginManifest = {
  id: string;
  sourceId: string;
  displayName?: string;
  studioApiVersion?: string;
  entry: string;
  contributes?: {
    editors?: StudioPluginEditorContribution[];
  };
};

type StudioPluginCatalogEntry = {
  manifest: StudioPluginManifest;
  manifestPath: string;
  entryPath: string;
  sourceRootName: string;
  entryLoader: (() => Promise<unknown>) | null;
  sourceKind: "native" | "external";
};

type StudioPluginSourceEntry = {
  id?: string;
  local_path?: string;
  repo?: string;
  ref?: string;
  root_path?: string;
  package_manager?: string;
};

type ProjectSettingsWithPlugins = {
  tooling?: {
    studio_plugins?: StudioPluginSourceEntry[];
  };
};

export type EditorRegistryBootstrapState = {
  projectPath: string;
  projectSettings: ProjectSettingsWithPlugins | null;
};

type EditorRegistryValue = {
  listEditorEntries: () => EditorEntry[];
  getEditorEntry: (editorId: string) => EditorEntry | undefined;
  loading: boolean;
};

const builtinModuleMap = import.meta.glob("../components/editors/**/*.tsx");
const nativePluginManifestModuleMap = import.meta.glob(
  "../../../plugins/*/plugin.json",
  {
    eager: true,
    import: "default",
  }
) as Record<string, StudioPluginManifest>;
const nativePluginEntryModuleMap = import.meta.glob(
  "../../../plugins/*/src/index.ts"
);
const pluginManifestModuleMap = import.meta.glob(
  "../../../../*/studio/plugins/*/plugin.json",
  {
    eager: true,
    import: "default",
  }
) as Record<string, StudioPluginManifest>;
const pluginEntryModuleMap = import.meta.glob(
  "../../../../*/studio/plugins/*/src/index.ts"
);

function resolveBuiltinModuleLoader(modulePath: string) {
  if (builtinModuleMap[modulePath]) {
    return builtinModuleMap[modulePath];
  }
  if (modulePath.startsWith("./")) {
    const altPath = `../${modulePath.slice(2)}`;
    if (builtinModuleMap[altPath]) {
      return builtinModuleMap[altPath];
    }
  }
  return undefined;
}

function createLazyComponent(
  loader: () => Promise<unknown>,
  exportName = "default",
  fallbackContributionExport?: string
): EditorComponent {
  return React.lazy(async () => {
    const loaded = (await loader()) as Record<string, unknown>;
    const preferred =
      fallbackContributionExport && loaded[fallbackContributionExport]
        ? loaded[fallbackContributionExport]
        : undefined;
    const resolved = preferred ?? loaded[exportName];
    if (!resolved) {
      throw new Error(`Editor module is missing export '${exportName}'.`);
    }
    const component = isStudioPanelContribution(resolved)
      ? resolved.component
      : (resolved as React.ComponentType<Record<string, never>>);
    return {
      default: component,
    };
  });
}

function deriveSourceRootName(manifestPath: string): string {
  const segments = manifestPath.split("/");
  const studioIndex = segments.lastIndexOf("studio");
  if (studioIndex <= 0) {
    return "";
  }
  return segments[studioIndex - 1] ?? "";
}

function resolveManifestRelativePath(
  manifestPath: string,
  relativePath: string
): string {
  const baseDir = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
  if (relativePath.startsWith("./")) {
    return `${baseDir}${relativePath.slice(2)}`;
  }
  return `${baseDir}${relativePath}`;
}

function buildPluginCatalog(
  manifestModuleMap: Record<string, StudioPluginManifest>,
  entryModuleMap: Record<string, () => Promise<unknown>>,
  sourceKind: "native" | "external"
): StudioPluginCatalogEntry[] {
  return Object.entries(manifestModuleMap)
    .map(([manifestPath, manifest]) => {
      const entryPath = resolveManifestRelativePath(manifestPath, manifest.entry);
      return {
        manifest,
        manifestPath,
        entryPath,
        sourceRootName: deriveSourceRootName(manifestPath),
        entryLoader:
          (entryModuleMap[entryPath] as (() => Promise<unknown>) | undefined) ??
          null,
        sourceKind,
      };
    })
    .filter((entry) => {
      if (!entry.manifest.id || !entry.manifest.sourceId || !entry.entryLoader) {
        console.warn(
          "[EditorRegistry] Ignoring malformed Studio plugin manifest",
          entry.manifestPath
        );
        return false;
      }
      return true;
    });
}

const pluginCatalog = [
  ...buildPluginCatalog(
    nativePluginManifestModuleMap,
    nativePluginEntryModuleMap,
    "native"
  ),
  ...buildPluginCatalog(
    pluginManifestModuleMap,
    pluginEntryModuleMap,
    "external"
  ),
];

export async function loadInitialEditorRegistryState(
  launcherService: LauncherService
): Promise<EditorRegistryBootstrapState | null> {
  const projectPath = launcherService.getProjectPath().trim();
  if (!projectPath) {
    return null;
  }

  try {
    const projectSettings =
      await launcherService.fetchProjectSettingsData<ProjectSettingsWithPlugins>(
        projectPath
      );
    return {
      projectPath,
      projectSettings,
    };
  } catch (error) {
    console.warn(
      `[EditorRegistry] Failed to pre-load project settings for plugin discovery: ${projectPath}`,
      error
    );
    return {
      projectPath,
      projectSettings: null,
    };
  }
}

function buildBuiltinEditorEntries(): EditorEntry[] {
  return EditorsConfig.map((editor) => {
    const loader = resolveBuiltinModuleLoader(editor.module);
    if (!loader) {
      throw new Error(
        `Editor '${editor.id}' references unknown module: ${editor.module}`,
      );
    }
    return {
      ...editor,
      Component: createLazyComponent(loader, "default", "contribution"),
      source: "builtin" as const,
    };
  });
}

const builtinEditorEntries = buildBuiltinEditorEntries();
const builtinEditorMap = new Map(
  builtinEditorEntries.map((entry) => [entry.id, entry])
);

function normalizePathBasename(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? normalized;
}

function normalizeRepoBasename(repo: string): string {
  return normalizePathBasename(repo).replace(/\.git$/i, "");
}

function collectAllowedPluginSourceKeys(
  settings: ProjectSettingsWithPlugins | null
): Set<string> {
  const entries = settings?.tooling?.studio_plugins;
  const keys = new Set<string>();
  if (!Array.isArray(entries)) {
    return keys;
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    if (typeof entry.id === "string" && entry.id.trim()) {
      keys.add(entry.id.trim());
    }
    if (typeof entry.local_path === "string" && entry.local_path.trim()) {
      keys.add(normalizePathBasename(entry.local_path.trim()));
    }
    if (typeof entry.repo === "string" && entry.repo.trim()) {
      keys.add(normalizeRepoBasename(entry.repo.trim()));
    }
  }
  return keys;
}

function buildPluginEditorEntries(
  settings: ProjectSettingsWithPlugins | null
): EditorEntry[] {
  const allowedSourceKeys = collectAllowedPluginSourceKeys(settings);

  const entries: EditorEntry[] = [];

  for (const plugin of pluginCatalog) {
    const sourceAllowed =
      plugin.sourceKind === "native" ||
      allowedSourceKeys.has(plugin.manifest.sourceId) ||
      allowedSourceKeys.has(plugin.sourceRootName);
    if (!sourceAllowed) {
      continue;
    }

    const editors = plugin.manifest.contributes?.editors ?? [];
    for (const editor of editors) {
      const entryLoader = plugin.entryLoader;
      if (!entryLoader) {
        continue;
      }
      if (
        !editor ||
        typeof editor.id !== "string" ||
        !editor.id.trim() ||
        (editor.label != null && typeof editor.label !== "string") ||
        typeof editor.componentExport !== "string" ||
        !editor.componentExport.trim()
      ) {
        console.warn(
          "[EditorRegistry] Skipping malformed editor contribution",
          plugin.manifest.id,
          editor
        );
        continue;
      }
      const editorId = editor.id.trim();
      entries.push({
        id: editorId,
        label: editor.label?.trim() || editorId,
        module: plugin.entryPath,
        Component: createLazyComponent(entryLoader, editor.componentExport.trim()),
        source: "plugin",
        pluginId: plugin.manifest.id,
        pluginSourceId: plugin.manifest.sourceId,
      });
    }
  }

  return entries;
}

function mergeEditorEntries(
  pluginEntries: EditorEntry[]
): EditorEntry[] {
  const merged = [...builtinEditorEntries];
  const knownIds = new Set(merged.map((entry) => entry.id));
  for (const entry of pluginEntries) {
    if (knownIds.has(entry.id)) {
      console.warn(
        `[EditorRegistry] Skipping duplicate editor id '${entry.id}' from plugin '${entry.pluginId ?? "unknown"}'.`
      );
      continue;
    }
    knownIds.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

const EditorRegistryContext = React.createContext<EditorRegistryValue>({
  listEditorEntries: () => builtinEditorEntries,
  getEditorEntry: (editorId) => builtinEditorMap.get(editorId),
  loading: false,
});

export function EditorRegistryProvider({
  children,
  initialBootstrapState = null,
}: {
  children: React.ReactNode;
  initialBootstrapState?: EditorRegistryBootstrapState | null;
}) {
  const launcherService = useLauncherService();
  const { projectPath } = useProjectContext();
  const bootstrapRef = React.useRef(initialBootstrapState);
  const hasInitialBootstrap =
    bootstrapRef.current?.projectPath === projectPath;
  const [projectSettings, setProjectSettings] = React.useState<ProjectSettingsWithPlugins | null>(
    () =>
      hasInitialBootstrap
        ? (bootstrapRef.current?.projectSettings ?? null)
        : null
  );
  const [loading, setLoading] = React.useState(
    () => Boolean(projectPath) && !hasInitialBootstrap
  );

  React.useEffect(() => {
    if (!projectPath) {
      bootstrapRef.current = null;
      setProjectSettings(null);
      setLoading(false);
      return;
    }

    const bootstrap = bootstrapRef.current;
    if (bootstrap?.projectPath === projectPath) {
      setProjectSettings(bootstrap.projectSettings);
      setLoading(false);
      bootstrapRef.current = null;
      return;
    }

    let cancelled = false;
    setLoading(true);
    launcherService
      .fetchProjectSettingsData<ProjectSettingsWithPlugins>(projectPath)
      .then((nextSettings) => {
        if (cancelled) return;
        setProjectSettings(nextSettings);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn(
          `[EditorRegistry] Failed to load project settings for plugin discovery: ${projectPath}`,
          error
        );
        setProjectSettings(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [launcherService, projectPath]);

  const mergedEntries = React.useMemo(
    () => mergeEditorEntries(buildPluginEditorEntries(projectSettings)),
    [projectSettings]
  );

  const editorMap = React.useMemo(
    () => new Map(mergedEntries.map((entry) => [entry.id, entry])),
    [mergedEntries]
  );

  const value = React.useMemo<EditorRegistryValue>(
    () => ({
      listEditorEntries: () => mergedEntries,
      getEditorEntry: (editorId: string) => editorMap.get(editorId),
      loading,
    }),
    [editorMap, loading, mergedEntries]
  );

  return (
    <EditorRegistryContext.Provider value={value}>
      {children}
    </EditorRegistryContext.Provider>
  );
}

export function useEditorRegistry(): EditorRegistryValue {
  return React.useContext(EditorRegistryContext);
}

export function getEditorEntry(editorId: string): EditorEntry {
  const entry = builtinEditorMap.get(editorId);
  if (!entry) {
    throw new Error(`Unknown editor id: ${editorId}`);
  }
  return entry;
}

export function listEditorEntries(): EditorEntry[] {
  return builtinEditorEntries;
}
