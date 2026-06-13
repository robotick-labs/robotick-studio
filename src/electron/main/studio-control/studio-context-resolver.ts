import path from "path";
import type {
  StudioControlResourceSummary,
  StudioControlStatus,
} from "../../common/studio-control-contract";
import type {
  StudioDocument,
  StudioDockNode,
  StudioFloatingPanel,
  StudioLayout,
  StudioWindow,
  StudioWorkbench,
} from "../studio-persistence";
import { readProjectMetadata } from "./studio-project-metadata";

type StudioPanelStatus = {
  resource_type: "studio_panel";
  id: string;
  panel_location: "docked" | "floating";
  instance_id: string;
  window_id: string;
  workbench_id: string;
  layout_id: string;
  active_panel_id?: string;
  editor_id: string;
  label: string;
  settings: Record<string, unknown>;
  frame?: StudioFloatingPanel["frame"];
  diagnostics: {
    source: "runtime";
    items: unknown[];
  };
};

type StudioLayoutStatus = {
  resource_type: "studio_layout";
  id: string;
  label: string;
  instance_id: string;
  window_id: string;
  workbench_id: string;
  active_layout_id?: string;
  active_panel_id?: string;
  dock: StudioDockNode;
  diagnostics: {
    source: "runtime";
    items: unknown[];
    panel_count: number;
    floating_panel_count: number;
  };
  panels: StudioPanelStatus[];
};

type StudioWorkbenchStatus = {
  resource_type: "studio_workbench";
  id: string;
  label: string;
  instance_id: string;
  window_id: string;
  active_workbench_id?: string;
  path: string;
  group?: StudioWorkbench["group"];
  default_editor_id?: string;
  default_layout_id?: string;
  active_layout_id?: string;
  state_sources: Record<string, string>;
  layouts: StudioLayoutStatus[];
};

type StudioWindowStatus = {
  resource_type: "studio_window";
  id: string;
  label: string;
  instance_id: string;
  active_window_id: string | null;
  is_focused: boolean;
  window_role: StudioWindow["windowRole"];
  default_workbench_id?: string;
  active_workbench_id?: string;
  state_sources: Record<string, string>;
  workbenches: StudioWorkbenchStatus[];
};

type StudioInstanceStatus = {
  resource_type: "studio_instance";
  id: string;
  name: string;
  pid: number;
  mode: string;
  state: "running";
  project_id: string | null;
  project_name: string | null;
  project_dir: string | null;
  project_file_name: string | null;
  project_display_name: string | null;
  ui_project_label: string | null;
  selected_project_path: string | null;
  active_window_id: string | null;
  focused_window_id: string | null;
  is_focused: boolean;
  last_focused_at: string | null;
  state_sources: Record<string, string>;
  windows: StudioWindowStatus[];
};

type StudioActionStatus = {
  id: string;
  label: string;
  tool_name: string;
  read_only: boolean;
  destructive: boolean;
  path: string[];
  resource_uri: string;
};

export type StudioRuntimeStatusOptions = {
  instanceName: string;
  pid: number;
  mode: string;
  selectedProjectPath: string | null;
  workspaceRoot: string | null;
  activeWindowScope: string | null;
  focusedWindowScope?: string | null;
  lastFocusedAt?: string | null;
  openWindowScopes: string[];
  activeWorkbenchIds?: Record<string, string>;
  activeLayoutIds?: Record<string, string>;
  activePanelIds?: Record<string, string>;
};

function deriveProjectDirectory(selectedProjectPath: string | null): string | null {
  if (!selectedProjectPath) {
    return null;
  }
  const directory = path.dirname(selectedProjectPath).trim();
  if (!directory || directory === ".") {
    return null;
  }
  return directory;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function panelFromDockNode(
  node: StudioDockNode,
  context: {
    instanceName: string;
    windowId: string;
    workbenchId: string;
    layoutId: string;
  }
): StudioPanelStatus[] {
  if (node.nodeType === "split") {
    return node.children.flatMap((child) => panelFromDockNode(child, context));
  }
  return [
    {
      resource_type: "studio_panel",
      id: node.panelId,
      panel_location: "docked",
      instance_id: context.instanceName,
      window_id: context.windowId,
      workbench_id: context.workbenchId,
      layout_id: context.layoutId,
      editor_id: node.editorId,
      label: node.label ?? node.panelId,
      settings: cloneValue(node.settings ?? {}),
      diagnostics: {
        source: "runtime",
        items: [],
      },
    },
  ];
}

function buildPanelStatuses(
  layout: StudioLayout,
  context: {
    instanceName: string;
    windowId: string;
    workbenchId: string;
  }
): StudioPanelStatus[] {
  const dockedPanels = panelFromDockNode(layout.dock, {
    ...context,
    layoutId: layout.id,
  });
  const floatingPanels = (layout.floatingPanels ?? []).map((panel) => ({
    resource_type: "studio_panel" as const,
    id: panel.id,
    panel_location: "floating" as const,
    instance_id: context.instanceName,
    window_id: context.windowId,
    workbench_id: context.workbenchId,
    layout_id: layout.id,
    editor_id: panel.editorId,
    label: panel.label ?? panel.id,
    settings: cloneValue(panel.settings ?? {}),
    frame: cloneValue(panel.frame),
    diagnostics: {
      source: "runtime" as const,
      items: [],
    },
  }));
  return [...dockedPanels, ...floatingPanels];
}

function activeWindowIdForDocument(
  document: StudioDocument,
  activeWindowScope: string | null
): { id: string | null; source: string } {
  if (
    activeWindowScope &&
    document.windows.some((window) => window.id === activeWindowScope)
  ) {
    return { id: activeWindowScope, source: "runtime" };
  }
  if (document.windows.some((window) => window.id === "main")) {
    return { id: "main", source: "config" };
  }
  return { id: document.windows[0]?.id ?? null, source: "config" };
}

export function buildStudioRuntimeTree(
  document: StudioDocument,
  options: StudioRuntimeStatusOptions
): StudioInstanceStatus {
  const projectMetadata = readProjectMetadata(options.selectedProjectPath);
  const activeWindow = activeWindowIdForDocument(document, options.activeWindowScope);
  const focusedWindow = activeWindowIdForDocument(
    document,
    options.focusedWindowScope ?? null
  );
  const windows = document.windows.map((window) => {
    const defaultWorkbenchId =
      window.defaultWorkbenchId ?? window.workbenches[0]?.id;
    const activeWorkbenchId = options.activeWorkbenchIds?.[window.id] ?? null;
    const workbenches = window.workbenches.map((workbench) => {
      const defaultLayoutId =
        workbench.defaultLayoutId ?? workbench.layouts[0]?.id;
      const layoutKey = `${window.id}/${workbench.id}`;
      const activeLayoutId = options.activeLayoutIds?.[layoutKey] ?? null;
      const layouts = workbench.layouts.map((layout) => {
        const panels = buildPanelStatuses(layout, {
          instanceName: options.instanceName,
          windowId: window.id,
          workbenchId: workbench.id,
        });
        const panelKey = `${window.id}/${workbench.id}/${layout.id}`;
        const activePanelId = options.activePanelIds?.[panelKey] ?? null;
        const panelsWithActivation = panels.map((panel) => ({
          ...panel,
          ...(activePanelId ? { active_panel_id: activePanelId } : {}),
        }));
        return {
          resource_type: "studio_layout" as const,
          id: layout.id,
          label: layout.label,
          instance_id: options.instanceName,
          window_id: window.id,
          workbench_id: workbench.id,
          dock: cloneValue(layout.dock),
          diagnostics: {
            source: "runtime" as const,
            items: [],
            panel_count: panels.length,
            floating_panel_count: panels.filter(
              (panel) => panel.panel_location === "floating"
            ).length,
          },
          ...(activePanelId ? { active_panel_id: activePanelId } : {}),
          ...(activeLayoutId ? { active_layout_id: activeLayoutId } : {}),
          panels: panelsWithActivation,
        };
      });
      return {
        resource_type: "studio_workbench" as const,
        id: workbench.id,
        label: workbench.label,
        instance_id: options.instanceName,
        window_id: window.id,
        ...(activeWorkbenchId ? { active_workbench_id: activeWorkbenchId } : {}),
        path: workbench.path ?? `/${workbench.id}`,
        ...(workbench.group ? { group: workbench.group } : {}),
        ...(workbench.defaultEditorId
          ? { default_editor_id: workbench.defaultEditorId }
          : {}),
        ...(defaultLayoutId ? { default_layout_id: defaultLayoutId } : {}),
        ...(activeLayoutId ? { active_layout_id: activeLayoutId } : {}),
        state_sources: {
          default_layout_id: "config",
          active_layout_id: options.activeLayoutIds?.[layoutKey]
            ? "runtime"
            : "unknown",
        },
        layouts,
      };
    });
    return {
      resource_type: "studio_window" as const,
      id: window.id,
      label: window.label,
      instance_id: options.instanceName,
      active_window_id: activeWindow.id,
      is_focused: window.id === focusedWindow.id && options.focusedWindowScope != null,
      window_role: window.windowRole,
      ...(defaultWorkbenchId ? { default_workbench_id: defaultWorkbenchId } : {}),
      ...(activeWorkbenchId ? { active_workbench_id: activeWorkbenchId } : {}),
        state_sources: {
          default_workbench_id: "config",
          active_workbench_id: options.activeWorkbenchIds?.[window.id]
            ? "runtime"
            : "unknown",
        },
      workbenches,
    };
  });
  return {
    resource_type: "studio_instance",
    id: options.instanceName,
    name: options.instanceName,
    pid: options.pid,
    mode: process.env.ROBOTICK_STUDIO_MODE ?? options.mode,
    state: "running",
    project_id: projectMetadata.projectId,
    project_name: projectMetadata.projectDisplayName ?? projectMetadata.projectId,
    project_dir:
      projectMetadata.projectDirectory ??
      deriveProjectDirectory(options.selectedProjectPath),
    project_file_name: projectMetadata.projectFileName,
    project_display_name: projectMetadata.projectDisplayName,
    ui_project_label: projectMetadata.projectDisplayName,
    selected_project_path: options.selectedProjectPath,
    active_window_id: activeWindow.id,
    focused_window_id: options.focusedWindowScope ? focusedWindow.id : null,
    is_focused: options.focusedWindowScope != null,
    last_focused_at: options.lastFocusedAt ?? null,
    state_sources: {
      active_window_id: activeWindow.source,
      focused_window_id: options.focusedWindowScope ? "runtime" : "none",
      selected_project_path: "runtime",
    },
    windows,
  };
}

function activationPathForNode(node: Record<string, unknown>): string[] | null {
  const resourceType = String(node.resource_type ?? "");
  const id = typeof node.id === "string" ? node.id : null;
  if (resourceType === "studio_window" && id) {
    return ["windows", id];
  }
  if (resourceType === "studio_workbench" && id && typeof node.window_id === "string") {
    return ["windows", node.window_id, "workbenches", id];
  }
  if (
    resourceType === "studio_layout" &&
    id &&
    typeof node.window_id === "string" &&
    typeof node.workbench_id === "string"
  ) {
    return ["windows", node.window_id, "workbenches", node.workbench_id, "layouts", id];
  }
  if (
    resourceType === "studio_panel" &&
    id &&
    typeof node.window_id === "string" &&
    typeof node.workbench_id === "string" &&
    typeof node.layout_id === "string"
  ) {
    return [
      "windows",
      node.window_id,
      "workbenches",
      node.workbench_id,
      "layouts",
      node.layout_id,
      "panels",
      id,
    ];
  }
  return null;
}

function statusPathForNode(node: Record<string, unknown>): string[] {
  return activationPathForNode(node) ?? [];
}

function collectionPathForNode(
  parent: Record<string, unknown>,
  collectionName: string
): string[] | null {
  const parentPath = activationPathForNode(parent);
  if (parentPath === null && String(parent.resource_type ?? "") !== "studio_instance") {
    return null;
  }
  return [...(parentPath ?? []), collectionName];
}

function resourceUriForPath(
  instanceId: string,
  pathSegments: string[] | null
): string {
  if (!pathSegments || pathSegments.length === 0) {
    return `studio://${instanceId}`;
  }
  return `studio://${instanceId}/${pathSegments.join("/")}`;
}

function resourceUriForNode(node: Record<string, unknown>): string {
  const instanceId =
    typeof node.instance_id === "string"
      ? node.instance_id
      : typeof node.id === "string"
        ? node.id
        : "studio";
  return resourceUriForPath(instanceId, statusPathForNode(node));
}

function actionMetadata(node: Record<string, unknown>): StudioActionStatus[] {
  const actions: StudioActionStatus[] = [
    {
      id: "studio.resource.status",
      label: "Status",
      tool_name: "studio_resource_status",
      read_only: true,
      destructive: false,
      path: [...statusPathForNode(node), "status"],
      resource_uri: resourceUriForNode(node),
    },
  ];
  const activation = activationMetadata(node);
  if (activation.activatable && Array.isArray(activation.activation_target_path)) {
    actions.push({
      id: "studio.resource.activate",
      label: "Activate",
      tool_name: "studio_resource_activate",
      read_only: false,
      destructive: false,
      path: [...activation.activation_target_path, "activate"],
      resource_uri: resourceUriForNode(node),
    });
  }
  return actions;
}

function activationMetadata(node: Record<string, unknown>) {
  const targetPath = activationPathForNode(node);
  const resourceType = String(node.resource_type ?? "");
  let active = false;
  if (resourceType === "studio_window") {
    active = node.id === node.active_window_id;
  }
  if (resourceType === "studio_workbench") {
    active = node.id === node.active_workbench_id;
  }
  if (resourceType === "studio_layout") {
    active = node.id === node.active_layout_id;
  }
  if (resourceType === "studio_panel") {
    active = node.id === node.active_panel_id;
  }
  return {
    active,
    activatable: targetPath !== null,
    activation_target_path: targetPath,
  };
}

function childCollectionName(resourceType: string): string | null {
  return {
    studio_instance: "windows",
    studio_window: "workbenches",
    studio_workbench: "layouts",
    studio_layout: "panels",
  }[resourceType] ?? null;
}

function summarizeChild(node: Record<string, unknown>): StudioControlResourceSummary {
  const resourceType = String(node.resource_type ?? "");
  const id = String(node.id ?? "");
  const label = typeof node.label === "string" ? node.label : undefined;
  if (resourceType === "studio_window") {
    return {
      resource_type: resourceType,
      id,
      label,
      resource_uri: resourceUriForNode(node),
      window_role: typeof node.window_role === "string" ? node.window_role : undefined,
    };
  }
  if (resourceType === "studio_workbench") {
    return {
      resource_type: resourceType,
      id,
      label,
      resource_uri: resourceUriForNode(node),
      group: typeof node.group === "string" ? node.group : undefined,
      path: typeof node.path === "string" ? node.path : undefined,
    };
  }
  if (resourceType === "studio_layout") {
    const diagnostics = node.diagnostics as Record<string, unknown> | undefined;
    return {
      resource_type: resourceType,
      id,
      label,
      resource_uri: resourceUriForNode(node),
      panel_count: diagnostics?.panel_count,
      floating_panel_count: diagnostics?.floating_panel_count,
    };
  }
  if (resourceType === "studio_panel") {
    return {
      resource_type: resourceType,
      id,
      label,
      resource_uri: resourceUriForNode(node),
      panel_location:
        typeof node.panel_location === "string" ? node.panel_location : undefined,
      editor_id: typeof node.editor_id === "string" ? node.editor_id : undefined,
    };
  }
  return {
    resource_type: resourceType,
    id,
    resource_uri: resourceUriForNode(node),
  };
}

function buildChildCollections(node: Record<string, unknown>) {
  const collectionName = childCollectionName(String(node.resource_type ?? ""));
  if (!collectionName) {
    return [];
  }
  const items = Array.isArray(node[collectionName])
    ? (node[collectionName] as unknown[])
    : [];
  return [
    {
      name: collectionName,
      resource_type: `studio_${collectionName}`,
      item_count: items.filter((item) => typeof item === "object" && item !== null)
        .length,
    },
  ];
}

function buildCollectionNode(
  parent: Record<string, unknown>,
  collectionName: string,
  items: Record<string, unknown>[]
): StudioControlStatus {
  const parentActivationPath = activationPathForNode(parent);
  const collectionPath = collectionPathForNode(parent, collectionName);
  const instanceId =
    typeof parent.instance_id === "string"
      ? parent.instance_id
      : String(parent.id ?? "studio");
  return {
    resource_type: `studio_${collectionName}`,
    id: collectionName,
    parent_id: parent.id,
    resource_uri: resourceUriForPath(instanceId, collectionPath),
    active: false,
    activatable: false,
    activation_target_path: parentActivationPath,
    actions: [
      {
        id: "studio.resource.status",
        label: "Status",
        tool_name: "studio_resource_status",
        read_only: true,
        destructive: false,
        path: [...(collectionPath ?? []), "status"],
        resource_uri: resourceUriForPath(instanceId, collectionPath),
      },
    ],
    items: items.map((item) => summarizeChild(item)),
    child_resources: items.map((item) => summarizeChild(item)),
  };
}

export function resolveStudioRuntimeNode(
  instanceStatus: StudioInstanceStatus,
  pathSegments: string[]
): StudioControlStatus | null {
  let node = instanceStatus as unknown as Record<string, unknown>;
  let index = 0;
  while (index < pathSegments.length) {
    const segment = pathSegments[index];
    const collectionName = childCollectionName(String(node.resource_type ?? ""));
    if (!collectionName || segment !== collectionName) {
      return null;
    }
    const items = (Array.isArray(node[collectionName])
      ? (node[collectionName] as unknown[])
      : []
    ).filter((item): item is Record<string, unknown> => {
      return typeof item === "object" && item !== null;
    });
    if (index === pathSegments.length - 1) {
      return buildCollectionNode(node, collectionName, items);
    }
    const itemId = pathSegments[index + 1];
    const next = items.find((item) => item.id === itemId);
    if (!next) {
      return null;
    }
    node = next;
    index += 2;
  }

  const resourceType = String(node.resource_type ?? "");
  if (resourceType === "studio_instance") {
    const windows = (node.windows as Record<string, unknown>[] | undefined) ?? [];
    return {
      resource_type: resourceType,
      id: String(node.id),
      resource_uri: resourceUriForNode(node),
      name: node.name,
      pid: node.pid,
      mode: node.mode,
      state: node.state,
      project_id: node.project_id,
      project_name: node.project_name,
      project_dir: node.project_dir,
      project_file_name: node.project_file_name,
      project_display_name: node.project_display_name,
      ui_project_label: node.ui_project_label,
      selected_project_path: node.selected_project_path,
      active_window_id: node.active_window_id,
      focused_window_id: node.focused_window_id,
      is_focused: node.is_focused,
      last_focused_at: node.last_focused_at,
      state_sources: node.state_sources as Record<string, string>,
      active: false,
      activatable: false,
      activation_target_path: null,
      actions: actionMetadata(node),
      children: { windows: windows.map((window) => summarizeChild(window)) },
      child_collections: buildChildCollections(node),
    };
  }
  if (resourceType === "studio_window") {
    const workbenches =
      (node.workbenches as Record<string, unknown>[] | undefined) ?? [];
    return {
      resource_type: resourceType,
      id: String(node.id),
      resource_uri: resourceUriForNode(node),
      label: node.label,
      instance_id: node.instance_id,
      active_window_id: node.active_window_id,
      is_focused: node.is_focused,
      window_role: node.window_role,
      default_workbench_id: node.default_workbench_id,
      active_workbench_id: node.active_workbench_id,
      state_sources: node.state_sources as Record<string, string>,
      ...activationMetadata(node),
      actions: actionMetadata(node),
      children: {
        workbenches: workbenches.map((workbench) => summarizeChild(workbench)),
      },
      child_collections: buildChildCollections(node),
    };
  }
  if (resourceType === "studio_workbench") {
    const layouts = (node.layouts as Record<string, unknown>[] | undefined) ?? [];
    return {
      resource_type: resourceType,
      id: String(node.id),
      resource_uri: resourceUriForNode(node),
      label: node.label,
      instance_id: node.instance_id,
      window_id: node.window_id,
      path: node.path,
      group: node.group,
      default_editor_id: node.default_editor_id,
      default_layout_id: node.default_layout_id,
      active_layout_id: node.active_layout_id,
      state_sources: node.state_sources as Record<string, string>,
      ...activationMetadata(node),
      actions: actionMetadata(node),
      children: { layouts: layouts.map((layout) => summarizeChild(layout)) },
      child_collections: buildChildCollections(node),
    };
  }
  if (resourceType === "studio_layout") {
    const panels = (node.panels as Record<string, unknown>[] | undefined) ?? [];
    return {
      resource_type: resourceType,
      id: String(node.id),
      resource_uri: resourceUriForNode(node),
      label: node.label,
      instance_id: node.instance_id,
      window_id: node.window_id,
      workbench_id: node.workbench_id,
      active_panel_id: node.active_panel_id,
      dock: node.dock,
      diagnostics: node.diagnostics,
      ...activationMetadata(node),
      actions: actionMetadata(node),
      children: { panels: panels.map((panel) => summarizeChild(panel)) },
      child_collections: buildChildCollections(node),
    };
  }
  return {
    ...(node as StudioControlStatus),
    resource_uri: resourceUriForNode(node),
    ...activationMetadata(node),
    actions: actionMetadata(node),
    child_collections: buildChildCollections(node),
  };
}
