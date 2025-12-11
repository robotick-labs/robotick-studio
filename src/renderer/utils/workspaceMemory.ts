import { readStorageValue, setStorageValue } from "../services/storage";

const LAST_WORKSPACE_PREFIX = "robotick:last-workspace:";

function getWorkspaceKey(projectPath?: string): string {
  if (!projectPath) {
    return `${LAST_WORKSPACE_PREFIX}global`;
  }
  const encoded = encodeURIComponent(projectPath);
  return `${LAST_WORKSPACE_PREFIX}${encoded}`;
}

export function rememberWorkspacePath(
  projectPath: string | undefined,
  workspacePath: string
): void {
  setStorageValue(getWorkspaceKey(projectPath), workspacePath);
}

export function loadRememberedWorkspacePath(
  projectPath: string | undefined
): string | null {
  return readStorageValue(getWorkspaceKey(projectPath));
}
