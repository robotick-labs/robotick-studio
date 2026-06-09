import { readStorageValue, setStorageValue } from "../services/storage";

const LAST_WORKBENCH_PREFIX = "robotick:last-workbench:";

type WorkbenchMemoryOptions = {
  windowScope?: string;
  isPrimaryWindow?: boolean;
};

/**
 * Builds the storage key used to remember the last workbench for a specific project or globally.
 *
 * @param projectPath - Project filesystem path; when omitted the key targets the global workbench
 * @returns The storage key string. If `projectPath` is provided it is URL-encoded and appended to the prefix; otherwise the key ends with `global`
 */
function getWorkbenchKey(projectPath?: string): string {
  if (!projectPath) {
    return `${LAST_WORKBENCH_PREFIX}global`;
  }
  const encoded = encodeURIComponent(projectPath);
  return `${LAST_WORKBENCH_PREFIX}${encoded}`;
}

function getScopedWorkbenchKey(windowScope: string, projectPath?: string): string {
  const suffix = projectPath
    ? encodeURIComponent(projectPath)
    : "global";
  return `${LAST_WORKBENCH_PREFIX}${windowScope}:${suffix}`;
}

/**
 * Persist the last-used workbench path for a given project.
 *
 * @param projectPath - Optional project path; when omitted the value is stored under a global key
 * @param workbenchPath - The workbench path to persist
 * 
 * Note: failures are caught and a warning is logged; the function does not throw. 
 */
export function rememberWorkbenchPath(
  projectPath: string | undefined,
  workbenchPath: string,
  options: WorkbenchMemoryOptions = {}
): void {
  try {
    const isPrimaryWindow = options.isPrimaryWindow !== false;
    if (isPrimaryWindow) {
      setStorageValue(getWorkbenchKey(projectPath), workbenchPath);
      return;
    }
    const scope = options.windowScope?.trim();
    if (!scope) {
      console.warn("[workbench-memory] Missing window scope for secondary window");
      return;
    }
    const scopedKey = getScopedWorkbenchKey(
      scope,
      projectPath
    );
    setStorageValue(scopedKey, workbenchPath);
  } catch (error) {
    console.warn("[workbench-memory] Failed to persist workbench path", error);
  }
}

/**
 * Retrieve the previously stored workbench path for the given project or the global workbench.
 *
 * @param projectPath - Filesystem path identifying the project; when `undefined`, the global workbench key is used
 * @returns The stored workbench path if available, `null` if none could be read or an error occurred
 */
export function loadRememberedWorkbenchPath(
  projectPath: string | undefined,
  options: WorkbenchMemoryOptions = {}
): string | null {
  try {
    const isPrimaryWindow = options.isPrimaryWindow !== false;
    if (isPrimaryWindow) {
      return readStorageValue(getWorkbenchKey(projectPath));
    }
    const scope = options.windowScope?.trim();
    if (!scope) {
      console.warn("[workbench-memory] Missing window scope for secondary window");
      return null;
    }
    const scopedKey = getScopedWorkbenchKey(
      scope,
      projectPath
    );
    return readStorageValue(scopedKey);
  } catch (error) {
    console.warn("[workbench-memory] Failed to load workbench path", error);
    return null;
  }
}
