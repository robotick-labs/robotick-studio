import { STUDIO_PERSISTENCE_SCHEMA_VERSION } from "../constants";
import { toStudioResourceSlug } from "../slug";
import type {
  StudioDockNode,
  StudioFloatingPanelInstance,
  StudioLayoutResource,
  StudioPanelFrame,
  StudioPanelInstance,
  StudioPersistenceModel,
  StudioWindowResource,
  StudioWorkbenchResource,
} from "../types";

const LAYOUT_TABS_PREFIX = "workspace-layout-tabs:";
const PANEL_LAYOUT_PREFIX = "panelLayout:";
const FLOATING_PANELS_PREFIX = "floating-panels:";
const GENERIC_PANEL_FLOATING_PREFIX = "generic-panel:floating-panel:";
const CHILD_WINDOW_PRESETS_KEY = "studio.child-window-presets.v1";
const DEFAULT_LAYOUT_ID = "default";

type LegacyLayoutTab = {
  id: string;
  name: string;
};

type LegacyLayoutTabsState = {
  windowScope: string;
  workbenchId: string;
  tabs: LegacyLayoutTab[];
  activeTabId: string;
};

type LegacyPanelNode =
  | {
      kind: "leaf";
      id: string;
      editorId: string;
    }
  | {
      kind: "split";
      id: string;
      direction: "horizontal" | "vertical";
      ratio: number;
      children: [LegacyPanelNode, LegacyPanelNode];
    };

type LegacyFloatingPanel = {
  id: string;
  editorId: string;
  title?: string;
  settings?: Record<string, unknown>;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
};

type LegacyChildWindowPreset = {
  id: string;
  name: string;
  seedUrl: string;
  scope: string;
};

type LegacyMigrationOptions = {
  projectPath?: string;
};

function parseJson(value: string | undefined): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseJsonOrString(value: string | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseJson(value);
  return parsed ?? value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLayoutTabsKey(key: string) {
  if (!key.startsWith(LAYOUT_TABS_PREFIX)) {
    return null;
  }
  const suffix = key.slice(LAYOUT_TABS_PREFIX.length);
  const [windowScope, workbenchId] = suffix.split(":");
  if (!windowScope || !workbenchId) {
    return null;
  }
  return { windowScope, workbenchId };
}

function parsePanelLayoutKey(key: string) {
  if (!key.startsWith(PANEL_LAYOUT_PREFIX)) {
    return null;
  }
  const suffix = key.slice(PANEL_LAYOUT_PREFIX.length);
  const parts = suffix.split(":");
  if (parts.length === 1 && parts[0]) {
    return {
      windowScope: "main",
      workbenchId: parts[0],
      layoutTabId: DEFAULT_LAYOUT_ID,
      legacyDefault: true,
    };
  }
  const [windowScope, workbenchId, layoutTabId] = parts;
  if (!windowScope || !workbenchId || !layoutTabId) {
    return null;
  }
  return { windowScope, workbenchId, layoutTabId, legacyDefault: false };
}

function readLayoutTabs(
  state: Record<string, string>
): LegacyLayoutTabsState[] {
  return Object.entries(state)
    .map(([key, value]) => {
      const parsedKey = parseLayoutTabsKey(key);
      if (!parsedKey) {
        return null;
      }
      const parsed = parseJson(value);
      if (!isRecord(parsed)) {
        return null;
      }
      const rawTabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
      const tabs = rawTabs
        .map((item): LegacyLayoutTab | null => {
          if (!isRecord(item)) {
            return null;
          }
          const id = typeof item.id === "string" ? item.id.trim() : "";
          const name = typeof item.name === "string" ? item.name.trim() : "";
          if (!id) {
            return null;
          }
          return { id, name: name || id };
        })
        .filter((item): item is LegacyLayoutTab => item !== null);
      const fallbackTabs =
        tabs.length > 0 ? tabs : [{ id: DEFAULT_LAYOUT_ID, name: "Default" }];
      const activeTabId =
        typeof parsed.activeTabId === "string" &&
        fallbackTabs.some((tab) => tab.id === parsed.activeTabId)
          ? parsed.activeTabId
          : fallbackTabs[0].id;
      return { ...parsedKey, tabs: fallbackTabs, activeTabId };
    })
    .filter((item): item is LegacyLayoutTabsState => item !== null);
}

function sanitizeLegacyPanelNode(value: unknown): LegacyPanelNode | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === "leaf") {
    const id = typeof value.id === "string" && value.id ? value.id : "";
    const editorId =
      typeof value.editorId === "string" && value.editorId
        ? value.editorId
        : "";
    if (!id || !editorId) {
      return null;
    }
    return { kind: "leaf", id, editorId };
  }
  if (
    value.kind === "split" &&
    (value.direction === "horizontal" || value.direction === "vertical") &&
    Array.isArray(value.children) &&
    value.children.length === 2
  ) {
    const first = sanitizeLegacyPanelNode(value.children[0]);
    const second = sanitizeLegacyPanelNode(value.children[1]);
    if (!first || !second) {
      return null;
    }
    return {
      kind: "split",
      id: typeof value.id === "string" && value.id ? value.id : "split",
      direction: value.direction,
      ratio: typeof value.ratio === "number" ? value.ratio : 0.5,
      children: [first, second],
    };
  }
  return null;
}

function convertDockTree(
  node: LegacyPanelNode,
  panels: StudioPanelInstance[]
): StudioDockNode {
  if (node.kind === "leaf") {
    panels.push({
      panelInstanceId: node.id,
      editorId: node.editorId,
    });
    return {
      nodeType: "panel",
      panelInstanceId: node.id,
    };
  }
  return {
    nodeType: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [
      convertDockTree(node.children[0], panels),
      convertDockTree(node.children[1], panels),
    ],
  };
}

function createFallbackDockTree(
  panelId: string,
  panelInstances: StudioPanelInstance[]
): StudioDockNode {
  panelInstances.push({
    panelInstanceId: panelId,
    editorId: "home",
  });
  return { nodeType: "panel", panelInstanceId: panelId };
}

function readFloatingPanels(
  state: Record<string, string>,
  scope: string
): StudioFloatingPanelInstance[] {
  const parsed = parseJson(state[`${FLOATING_PANELS_PREFIX}${scope}`]);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((item): StudioFloatingPanelInstance | null => {
      if (!isRecord(item)) {
        return null;
      }
      const id = typeof item.id === "string" && item.id ? item.id : "";
      const editorId =
        typeof item.editorId === "string" && item.editorId
          ? item.editorId
          : "";
      if (!id || !editorId) {
        return null;
      }
      const legacy = item as LegacyFloatingPanel;
      return {
        panelInstanceId: id,
        editorId,
        label: typeof item.title === "string" ? item.title : undefined,
        settings: isRecord(item.settings) ? { ...item.settings } : {},
        frame: readFloatingPanelFrame(state, scope, legacy),
      };
    })
    .filter((item): item is StudioFloatingPanelInstance => item !== null);
}

function readFloatingPanelFrame(
  state: Record<string, string>,
  scope: string,
  panel: LegacyFloatingPanel
): StudioPanelFrame {
  const generic = parseJson(
    state[`${GENERIC_PANEL_FLOATING_PREFIX}${scope}:${panel.id}`]
  );
  const position =
    isRecord(generic) && isRecord(generic.position)
      ? generic.position
      : panel.initialPosition;
  const size =
    isRecord(generic) && isRecord(generic.size)
      ? generic.size
      : panel.initialSize;
  const minSize = panel.minSize;
  return {
    x: typeof position?.x === "number" ? position.x : 160,
    y: typeof position?.y === "number" ? position.y : 160,
    width: typeof size?.width === "number" ? size.width : 640,
    height: typeof size?.height === "number" ? size.height : 400,
    minWidth: typeof minSize?.width === "number" ? minSize.width : undefined,
    minHeight: typeof minSize?.height === "number" ? minSize.height : undefined,
  };
}

function buildLayoutId(
  windowScope: string,
  workbenchId: string,
  layoutTabId: string
): string {
  return `${windowScope}:${workbenchId}:${layoutTabId}`;
}

function buildLayoutSlug(
  windowScope: string,
  workbenchId: string,
  layoutTabId: string
): string {
  return toStudioResourceSlug(
    `${windowScope}.${workbenchId}.${layoutTabId}`,
    "layout"
  );
}

function readChildWindowPresets(
  state: Record<string, string>
): LegacyChildWindowPreset[] {
  const parsed = parseJson(state[CHILD_WINDOW_PRESETS_KEY]);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((item): LegacyChildWindowPreset | null => {
      if (!isRecord(item)) {
        return null;
      }
      const id = typeof item.id === "string" ? item.id : "";
      const name = typeof item.name === "string" ? item.name : "";
      const seedUrl = typeof item.seedUrl === "string" ? item.seedUrl : "";
      const scope = typeof item.scope === "string" ? item.scope : "";
      if (!id || !name || !seedUrl) {
        return null;
      }
      return { id, name, seedUrl, scope: scope || `child-preset-${id}` };
    })
    .filter((item): item is LegacyChildWindowPreset => item !== null);
}

function assignIfPresent(
  target: Record<string, unknown>,
  key: string,
  value: unknown
) {
  if (value !== undefined) {
    target[key] = value;
  }
}

function readKeyedPanelSettings(
  state: Record<string, string>,
  workspaceIdentifier: string,
  panelId: string,
  keys: Record<string, string>
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const [settingName, baseKey] of Object.entries(keys)) {
    assignIfPresent(
      settings,
      settingName,
      parseJsonOrString(state[`${baseKey}.${workspaceIdentifier}.${panelId}`])
    );
  }
  return settings;
}

function readModelsPanelSettings(
  state: Record<string, string>,
  workspaceIdentifier: string,
  panelId: string,
  projectPath?: string
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  const keyedSettings: Record<string, string> = {
    viewport: "robotick-studio.models.viewport",
    viewState: "robotick-studio.models.view-state",
    sort: "robotick-studio.models.sort",
    collapsed: "robotick-studio.models.collapsed",
  };
  for (const [settingName, baseKey] of Object.entries(keyedSettings)) {
    const scopedPrefix = `${baseKey}.${workspaceIdentifier}.${panelId}.`;
    const exactKey = projectPath ? `${scopedPrefix}${projectPath}` : null;
    const exactValue = exactKey ? parseJsonOrString(state[exactKey]) : undefined;
    if (exactValue !== undefined) {
      settings[settingName] = exactValue;
      continue;
    }
    if (projectPath) {
      continue;
    }
    const match = Object.entries(state).find(([storageKey]) =>
      storageKey.startsWith(scopedPrefix)
    );
    if (match) {
      settings[settingName] = parseJsonOrString(match[1]);
    }
  }
  return settings;
}

function readStreamingImageSelectedStreams(
  state: Record<string, string>,
  workspaceIdentifier: string,
  panelId: string,
  projectPath?: string
): Record<string, string> {
  const selectedStreams: Record<string, string> = {};
  const exactPrefix = projectPath
    ? `robotick.streaming-image.selected-stream.${projectPath}.${workspaceIdentifier}.${panelId}.`
    : null;
  const workspaceMarker = `.${workspaceIdentifier}.${panelId}.`;
  for (const [storageKey, value] of Object.entries(state)) {
    if (exactPrefix) {
      if (!storageKey.startsWith(exactPrefix)) {
        continue;
      }
    } else if (
      !storageKey.startsWith("robotick.streaming-image.selected-stream.") ||
      !storageKey.includes(workspaceMarker)
    ) {
      continue;
    }
    selectedStreams[storageKey.slice(storageKey.lastIndexOf(".") + 1)] = value;
  }
  return selectedStreams;
}

function readNamedPanelSettings(
  state: Record<string, string>,
  workspaceIdentifier: string,
  panelId: string,
  projectPath?: string
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  assignIfPresent(
    settings,
    "terminal",
    parseJsonOrString(
      state[`robotick-studio.terminal.panel.${workspaceIdentifier}.${panelId}`]
    )
  );
  assignIfPresent(
    settings,
    "telemetryScope",
    parseJsonOrString(
      state[`robotick-studio.telemetry-scope.panel.${workspaceIdentifier}.${panelId}`]
    ) ??
      parseJsonOrString(
        state[`robotick-studio.telemetry-scope.panel.${workspaceIdentifier}`]
      )
  );

  const telemetryImage = readKeyedPanelSettings(state, workspaceIdentifier, panelId, {
    modelId: "robotick-studio.telemetry.image.modelId",
    modelPath: "robotick-studio.telemetry.image.model",
    workloadId: "robotick-studio.telemetry.image.workloadId",
    workloadName: "robotick-studio.telemetry.image.workload",
    fieldPath: "robotick-studio.telemetry.image.field",
  });
  if (Object.keys(telemetryImage).length > 0) {
    settings.telemetryImage = telemetryImage;
  }

  const telemetryTree = readKeyedPanelSettings(state, workspaceIdentifier, panelId, {
    modelId: "robotick-studio.telemetry.tree.modelId",
    modelPath: "robotick-studio.telemetry.tree.model",
    workloadId: "robotick-studio.telemetry.tree.workloadId",
    workloadName: "robotick-studio.telemetry.tree.workload",
    fieldPath: "robotick-studio.telemetry.tree.field",
    dataKind: "robotick-studio.telemetry.tree.dataKind",
    expandedPaths: "robotick-studio.telemetry.tree.expandedPaths",
  });
  if (Object.keys(telemetryTree).length > 0) {
    settings.telemetryTree = telemetryTree;
  }

  const models = readModelsPanelSettings(
    state,
    workspaceIdentifier,
    panelId,
    projectPath
  );
  if (Object.keys(models).length > 0) {
    settings.models = models;
  }

  const selectedStreams = readStreamingImageSelectedStreams(
    state,
    workspaceIdentifier,
    panelId,
    projectPath
  );
  if (Object.keys(selectedStreams).length > 0) {
    settings.streamingImage = { selectedStreams };
  }

  return settings;
}

function mergePanelSettings<T extends StudioPanelInstance>(
  panel: T,
  settings: Record<string, unknown>
): T {
  if (Object.keys(settings).length === 0) {
    return panel;
  }
  return {
    ...panel,
    settings: {
      ...(panel.settings ?? {}),
      ...settings,
    },
  };
}

function attachKnownPanelSettings(
  layout: StudioLayoutResource,
  state: Record<string, string>,
  projectPath?: string
): StudioLayoutResource {
  return {
    ...layout,
    panelInstances: layout.panelInstances.map((panel) =>
      mergePanelSettings(
        panel,
        readNamedPanelSettings(
          state,
          layout.workbenchId,
          panel.panelInstanceId,
          projectPath
        )
      )
    ),
    floatingPanels: layout.floatingPanels?.map((panel) =>
      mergePanelSettings(
        panel,
        readNamedPanelSettings(state, layout.id, panel.panelInstanceId, projectPath)
      )
    ),
  };
}

function attachStandaloneTelemetrySettings(
  layout: StudioLayoutResource,
  state: Record<string, string>
): StudioLayoutResource {
  const telemetryPanel = layout.panelInstances.find(
    (panel) => panel.editorId === "telemetry"
  );
  if (!telemetryPanel) {
    return layout;
  }
  const telemetrySettings: Record<string, unknown> = {};
  assignIfPresent(
    telemetrySettings,
    "modelSort",
    state["telemetry-model-sort"]
  );
  const expandedModels: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith("telemetry-expanded-")) {
      expandedModels[key.slice("telemetry-expanded-".length)] = value === "true";
    }
  }
  if (Object.keys(expandedModels).length > 0) {
    telemetrySettings.expandedModels = expandedModels;
  }
  if (Object.keys(telemetrySettings).length === 0) {
    return layout;
  }
  return {
    ...layout,
    panelInstances: layout.panelInstances.map((panel) =>
      panel.panelInstanceId === telemetryPanel.panelInstanceId
        ? mergePanelSettings(panel, { telemetry: telemetrySettings })
        : panel
    ),
  };
}

export function migrateLegacyStorageToStudioResources(
  state: Record<string, string>,
  options: LegacyMigrationOptions = {}
): StudioPersistenceModel {
  const tabStates = readLayoutTabs(state);
  const panelLayoutKeys = Object.keys(state)
    .map(parsePanelLayoutKey)
    .filter((item): item is NonNullable<ReturnType<typeof parsePanelLayoutKey>> =>
      item !== null
    );
  const workbenchIds = Array.from(
    new Set([
      ...tabStates.map((item) => item.workbenchId),
      ...panelLayoutKeys.map((item) => item.workbenchId),
    ])
  ).sort();

  const layoutTabsByWorkbench = new Map<string, LegacyLayoutTabsState[]>();
  for (const tabState of tabStates) {
    const key = tabState.workbenchId;
    layoutTabsByWorkbench.set(key, [
      ...(layoutTabsByWorkbench.get(key) ?? []),
      tabState,
    ]);
  }

  const layouts: StudioLayoutResource[] = [];
  for (const workbenchId of workbenchIds) {
    const tabGroups = layoutTabsByWorkbench.get(workbenchId);
    const effectiveTabGroups =
      tabGroups && tabGroups.length > 0
        ? tabGroups
        : [
            {
              windowScope: "main",
              workbenchId,
              tabs: [{ id: DEFAULT_LAYOUT_ID, name: "Default" }],
              activeTabId: DEFAULT_LAYOUT_ID,
            },
          ];

    for (const tabGroup of effectiveTabGroups) {
      for (const tab of tabGroup.tabs) {
        const layoutId = buildLayoutId(
          tabGroup.windowScope,
          workbenchId,
          tab.id
        );
        const panelInstances: StudioPanelInstance[] = [];
        const layoutStorageKey = `${PANEL_LAYOUT_PREFIX}${tabGroup.windowScope}:${workbenchId}:${tab.id}`;
        const legacyDefaultStorageKey = `${PANEL_LAYOUT_PREFIX}${workbenchId}`;
        const rawNode =
          parseJson(state[layoutStorageKey]) ??
          (tab.id === DEFAULT_LAYOUT_ID
            ? parseJson(state[legacyDefaultStorageKey])
            : null);
        const legacyNode = sanitizeLegacyPanelNode(rawNode);
        const dockTree = legacyNode
          ? convertDockTree(legacyNode, panelInstances)
          : createFallbackDockTree(`${layoutId}:panel`, panelInstances);
        const floatingPanels = readFloatingPanels(
          state,
          `${tabGroup.windowScope}:${workbenchId}:${tab.id}`
        );
        const layout: StudioLayoutResource = {
          resourceType: "studio_layout",
          schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
          id: layoutId,
          slug: buildLayoutSlug(tabGroup.windowScope, workbenchId, tab.id),
          label: tab.name,
          workbenchId,
          dockTree,
          panelInstances,
          floatingPanels: floatingPanels.length > 0 ? floatingPanels : undefined,
        };
        layouts.push(
          attachStandaloneTelemetrySettings(
            attachKnownPanelSettings(layout, state, options.projectPath),
            state
          )
        );
      }
    }
  }

  const layoutIdsByWorkbench = new Map<string, string[]>();
  for (const layout of layouts) {
    layoutIdsByWorkbench.set(layout.workbenchId, [
      ...(layoutIdsByWorkbench.get(layout.workbenchId) ?? []),
      layout.id,
    ]);
  }

  const workbenches: StudioWorkbenchResource[] = workbenchIds.map((workbenchId) => {
    const tabs = tabStates.find((item) => item.workbenchId === workbenchId);
    const defaultLayoutId = tabs
      ? buildLayoutId(tabs.windowScope, workbenchId, tabs.activeTabId)
      : layoutIdsByWorkbench.get(workbenchId)?.[0];
    return {
      resourceType: "studio_workbench",
      schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
      id: workbenchId,
      slug: toStudioResourceSlug(workbenchId, "workbench"),
      label: workbenchId,
      source: "project",
      layoutIds: layoutIdsByWorkbench.get(workbenchId) ?? [],
      defaultLayoutId,
      windowIds: ["main"],
    };
  });

  const hostedWorkbenchIds = workbenches.map((workbench) => workbench.id);
  const windows: StudioWindowResource[] =
    hostedWorkbenchIds.length > 0
      ? [
          {
            resourceType: "studio_window",
            schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
            id: "main",
            slug: "main",
            label: "Main Window",
            windowRole: "main",
            hostedWorkbenchIds,
            defaultWorkbenchId: hostedWorkbenchIds[0],
          },
        ]
      : [];

  for (const preset of readChildWindowPresets(state)) {
    const id = preset.scope || preset.id;
    windows.push({
      resourceType: "studio_window",
      schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
      id,
      slug: toStudioResourceSlug(id, "child-window"),
      label: preset.name,
      windowRole: "child",
      hostedWorkbenchIds,
      defaultWorkbenchId: hostedWorkbenchIds[0],
    });
  }

  return { windows, workbenches, layouts };
}
