import path from "path";
import {
  createSeedStudioDocument,
  ensureStudioDocument,
  type StudioDocument,
} from "../studio-persistence";
import {
  buildStudioRuntimeTree,
  resolveStudioRuntimeNode,
  type StudioRuntimeStatusOptions,
} from "./studio-context-resolver";
import type { StudioControlStatus } from "../../common/studio-control-contract";

export type StudioRuntimeSnapshotProvider = {
  instanceName: string;
  pid: number;
  mode: string;
  workspaceRoot: string | null;
  getSelectedProjectPath: () => string;
  getActiveWindowScope: () => string | null;
  getFocusedWindowScope?: () => string | null;
  getLastFocusedAt?: () => string | null;
  getOpenWindowScopes: () => string[];
  getActiveWorkbenchIds?: () => Record<string, string>;
  getActiveLayoutIds?: () => Record<string, string>;
  getActivePanelIds?: () => Record<string, string>;
};

async function loadRuntimeDocument(
  selectedProjectPath: string,
  workspaceRoot: string | null
): Promise<StudioDocument> {
  if (selectedProjectPath) {
    return ensureStudioDocument(selectedProjectPath);
  }
  return createSeedStudioDocument(workspaceRoot ?? process.cwd());
}

export async function getStudioRuntimeStatus(
  provider: StudioRuntimeSnapshotProvider,
  pathSegments: string[] = []
): Promise<StudioControlStatus | null> {
  const selectedProjectPath = provider.getSelectedProjectPath();
  const document = await loadRuntimeDocument(
    selectedProjectPath,
    provider.workspaceRoot ? path.resolve(provider.workspaceRoot) : null
  );
  const options: StudioRuntimeStatusOptions = {
    instanceName: provider.instanceName,
    pid: provider.pid,
    mode: provider.mode,
    selectedProjectPath: selectedProjectPath || null,
    workspaceRoot: provider.workspaceRoot,
    activeWindowScope: provider.getActiveWindowScope(),
    focusedWindowScope: provider.getFocusedWindowScope?.() ?? null,
    lastFocusedAt: provider.getLastFocusedAt?.() ?? null,
    openWindowScopes: provider.getOpenWindowScopes(),
    activeWorkbenchIds: provider.getActiveWorkbenchIds?.(),
    activeLayoutIds: provider.getActiveLayoutIds?.(),
    activePanelIds: provider.getActivePanelIds?.(),
  };
  const tree = buildStudioRuntimeTree(document, options);
  return resolveStudioRuntimeNode(tree, pathSegments);
}

function findById<T extends { id: string }>(items: T[], id: string | null | undefined): T | null {
  if (!id) {
    return null;
  }
  return items.find((item) => item.id === id) ?? null;
}

export async function getStudioRuntimeFocused(
  provider: StudioRuntimeSnapshotProvider
): Promise<Record<string, unknown>> {
  const selectedProjectPath = provider.getSelectedProjectPath();
  const document = await loadRuntimeDocument(
    selectedProjectPath,
    provider.workspaceRoot ? path.resolve(provider.workspaceRoot) : null
  );
  const options: StudioRuntimeStatusOptions = {
    instanceName: provider.instanceName,
    pid: provider.pid,
    mode: provider.mode,
    selectedProjectPath: selectedProjectPath || null,
    workspaceRoot: provider.workspaceRoot,
    activeWindowScope: provider.getActiveWindowScope(),
    focusedWindowScope: provider.getFocusedWindowScope?.() ?? null,
    lastFocusedAt: provider.getLastFocusedAt?.() ?? null,
    openWindowScopes: provider.getOpenWindowScopes(),
    activeWorkbenchIds: provider.getActiveWorkbenchIds?.(),
    activeLayoutIds: provider.getActiveLayoutIds?.(),
    activePanelIds: provider.getActivePanelIds?.(),
  };
  const tree = buildStudioRuntimeTree(document, options);
  const window = findById(tree.windows, tree.active_window_id);
  const workbench = window
    ? findById(
        window.workbenches,
        window.active_workbench_id ?? window.default_workbench_id
      )
    : null;
  const layout = workbench
    ? findById(
        workbench.layouts,
        workbench.active_layout_id ?? workbench.default_layout_id
      )
    : null;
  const panel = layout ? findById(layout.panels, layout.active_panel_id) : null;
  const pathSegments = [
    ...(window ? ["windows", window.id] : []),
    ...(workbench ? ["workbenches", workbench.id] : []),
    ...(layout ? ["layouts", layout.id] : []),
    ...(panel ? ["panels", panel.id] : []),
  ];
  const depth = panel
    ? "panel"
    : layout
      ? "layout"
      : workbench
        ? "workbench"
        : window
          ? "window"
          : "instance";
  return {
    resource_type: "robotick_studio_focused",
    depth,
    instance_id: tree.id,
    instance_name: tree.name,
    pid: tree.pid,
    mode: tree.mode,
    is_focused: tree.is_focused,
    last_focused_at: tree.last_focused_at,
    focused_window_id: tree.focused_window_id,
    project_id: tree.project_id,
    project_name: tree.project_name,
    project_dir: tree.project_dir,
    project_file_name: tree.project_file_name,
    project_display_name: tree.project_display_name,
    ui_project_label: tree.ui_project_label,
    selected_project_path: tree.selected_project_path,
    active_window_id: tree.active_window_id,
    window_id: window?.id ?? null,
    window_label: window?.label ?? null,
    workbench_id: workbench?.id ?? null,
    workbench_label: workbench?.label ?? null,
    layout_id: layout?.id ?? null,
    layout_label: layout?.label ?? null,
    panel_id: panel?.id ?? null,
    panel_label: panel?.label ?? null,
    path: pathSegments,
    state_sources: {
      active_window_id: tree.state_sources.active_window_id,
      focused_window_id: tree.state_sources.focused_window_id,
      active_workbench_id: window?.state_sources.active_workbench_id ?? null,
      active_layout_id: workbench?.state_sources.active_layout_id ?? null,
    },
    limitations: panel
      ? []
      : ["Panel and element focus are not published yet; reporting active layout."],
  };
}
