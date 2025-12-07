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
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(getWorkspaceKey(projectPath), workspacePath);
  } catch (error) {
    console.warn("[workspace-memory] Failed to persist workspace path", error);
  }
}

export function loadRememberedWorkspacePath(
  projectPath: string | undefined
): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(getWorkspaceKey(projectPath));
  } catch (error) {
    console.warn("[workspace-memory] Failed to load workspace path", error);
    return null;
  }
}
