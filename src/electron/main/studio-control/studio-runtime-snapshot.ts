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
    openWindowScopes: provider.getOpenWindowScopes(),
    activeWorkbenchIds: provider.getActiveWorkbenchIds?.(),
    activeLayoutIds: provider.getActiveLayoutIds?.(),
    activePanelIds: provider.getActivePanelIds?.(),
  };
  const tree = buildStudioRuntimeTree(document, options);
  return resolveStudioRuntimeNode(tree, pathSegments);
}
