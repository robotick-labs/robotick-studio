import { readStorageValue, setStorageValue } from "../services/storage";

const LAST_WORKSPACE_PREFIX = "robotick:last-workspace:";
const PRIMARY_WINDOW_SCOPE = "primary";

type WorkspaceMemoryOptions = {
  windowScope?: string;
  isPrimaryWindow?: boolean;
};

/**
 * Builds the storage key used to remember the last workspace for a specific project or globally.
 *
 * @param projectPath - Project filesystem path; when omitted the key targets the global workspace
 * @returns The storage key string. If `projectPath` is provided it is URL-encoded and appended to the prefix; otherwise the key ends with `global`
 */
function getWorkspaceKey(projectPath?: string): string {
  if (!projectPath) {
    return `${LAST_WORKSPACE_PREFIX}global`;
  }
  const encoded = encodeURIComponent(projectPath);
  return `${LAST_WORKSPACE_PREFIX}${encoded}`;
}

function getScopedWorkspaceKey(windowScope: string, projectPath?: string): string {
  const suffix = projectPath
    ? encodeURIComponent(projectPath)
    : "global";
  return `${LAST_WORKSPACE_PREFIX}${windowScope}:${suffix}`;
}

/**
 * Persist the last-used workspace path for a given project.
 *
 * @param projectPath - Optional project path; when omitted the value is stored under a global key
 * @param workspacePath - The workspace path to persist
 * 
 * Note: failures are caught and a warning is logged; the function does not throw. 
 */
export function rememberWorkspacePath(
  projectPath: string | undefined,
  workspacePath: string,
  options: WorkspaceMemoryOptions = {}
): void {
  try {
    const isPrimaryWindow = options.isPrimaryWindow !== false;
    if (isPrimaryWindow) {
      setStorageValue(getWorkspaceKey(projectPath), workspacePath);
      return;
    }
    const scopedKey = getScopedWorkspaceKey(
      options.windowScope ?? PRIMARY_WINDOW_SCOPE,
      projectPath
    );
    setStorageValue(scopedKey, workspacePath);
  } catch (error) {
    console.warn("[workspace-memory] Failed to persist workspace path", error);
  }
}

/**
 * Retrieve the previously stored workspace path for the given project or the global workspace.
 *
 * @param projectPath - Filesystem path identifying the project; when `undefined`, the global workspace key is used
 * @returns The stored workspace path if available, `null` if none could be read or an error occurred
 */
export function loadRememberedWorkspacePath(
  projectPath: string | undefined,
  options: WorkspaceMemoryOptions = {}
): string | null {
  try {
    const isPrimaryWindow = options.isPrimaryWindow !== false;
    if (isPrimaryWindow) {
      return readStorageValue(getWorkspaceKey(projectPath));
    }
    const scopedKey = getScopedWorkspaceKey(
      options.windowScope ?? PRIMARY_WINDOW_SCOPE,
      projectPath
    );
    return readStorageValue(scopedKey);
  } catch (error) {
    console.warn("[workspace-memory] Failed to load workspace path", error);
    return null;
  }
}
