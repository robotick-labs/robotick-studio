import fs from "fs";
import path from "path";

export const STUDIO_PROJECT_LOCK_NAME = "studio.lock";

export type StoredProjectLock = {
  pid?: unknown;
  instanceName?: unknown;
  projectPath?: unknown;
  selectionPath?: unknown;
  acquiredAt?: unknown;
};

export type ProjectLockStatus = {
  projectPath: string;
  state: "available" | "current" | "locked";
  instanceName?: string;
  pid?: number;
  message?: string;
};

export type ProjectSelectionIssue = {
  type: "locked" | "error";
  projectPath: string;
  instanceName?: string;
  pid?: number;
  message: string;
};

export type ProjectSelectionState = {
  currentProjectPath: string;
  bootstrapIssue: ProjectSelectionIssue | null;
};

export type ProjectSelectionResult = {
  accepted: boolean;
  currentProjectPath: string;
  issue: ProjectSelectionIssue | null;
};

export type ProjectLockOwner = {
  pid: number;
  instanceName: string;
};

export class ProjectLockConflictError extends Error {
  readonly issue: ProjectSelectionIssue;

  constructor(issue: ProjectSelectionIssue) {
    super(issue.message);
    this.name = "ProjectLockConflictError";
    this.issue = issue;
  }
}

export function resolveProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

export function resolveProjectLockDirectory(projectPath: string): string {
  const resolvedPath = resolveProjectPath(projectPath);
  if (/\.project\.ya?ml$/i.test(resolvedPath)) {
    return path.dirname(resolvedPath);
  }
  try {
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      return path.dirname(resolvedPath);
    }
  } catch {
    // Fall back to the original resolved path below.
  }
  return resolvedPath;
}

export function getProjectLockPath(projectPath: string): string {
  return path.join(
    resolveProjectLockDirectory(projectPath),
    "studio",
    STUDIO_PROJECT_LOCK_NAME
  );
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockPayload(projectPath: string): StoredProjectLock | null {
  try {
    const raw = fs.readFileSync(getProjectLockPath(projectPath), "utf-8");
    const parsed = JSON.parse(raw) as StoredProjectLock;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function formatProjectLockMessage(projectPath: string, instanceName?: string): string {
  const projectName = path.basename(resolveProjectLockDirectory(projectPath));
  if (instanceName) {
    return `Project '${projectName}' is already open in Studio instance ${instanceName}.`;
  }
  return `Project '${projectName}' is already open in another Studio instance.`;
}

function issueFromStatus(status: ProjectLockStatus): ProjectSelectionIssue {
  return {
    type: "locked",
    projectPath: status.projectPath,
    instanceName: status.instanceName,
    pid: status.pid,
    message:
      status.message ??
      formatProjectLockMessage(status.projectPath, status.instanceName),
  };
}

function tryRemoveStaleLock(projectPath: string, pid: number | undefined): boolean {
  if (typeof pid === "number" && isPidAlive(pid)) {
    return false;
  }
  try {
    fs.unlinkSync(getProjectLockPath(projectPath));
    return true;
  } catch {
    return false;
  }
}

export function readProjectLockStatus(
  projectPath: string,
  owner: ProjectLockOwner
): ProjectLockStatus {
  const resolvedSelectionPath = resolveProjectPath(projectPath);
  const lockPath = getProjectLockPath(resolvedSelectionPath);
  if (!fs.existsSync(lockPath)) {
    return {
      projectPath: resolvedSelectionPath,
      state: "available",
    };
  }

  const payload = readLockPayload(resolvedSelectionPath);
  const pid =
    typeof payload?.pid === "number" && Number.isFinite(payload.pid)
      ? payload.pid
      : undefined;
  const instanceName =
    typeof payload?.instanceName === "string" && payload.instanceName.trim().length > 0
      ? payload.instanceName.trim()
      : undefined;

  if (typeof pid === "number" && !isPidAlive(pid)) {
    tryRemoveStaleLock(resolvedSelectionPath, pid);
    return {
      projectPath: resolvedSelectionPath,
      state: "available",
    };
  }

  if (pid === owner.pid) {
    return {
      projectPath: resolvedSelectionPath,
      state: "current",
      pid,
      instanceName: instanceName || owner.instanceName,
      message: `Project '${path.basename(resolveProjectLockDirectory(resolvedSelectionPath))}' is open in this Studio instance.`,
    };
  }

  return {
    projectPath: resolvedSelectionPath,
    state: "locked",
    pid,
    instanceName,
    message: formatProjectLockMessage(resolvedSelectionPath, instanceName),
  };
}

export function acquireProjectLock(
  projectPath: string,
  owner: ProjectLockOwner
): ProjectLockStatus {
  const resolvedSelectionPath = resolveProjectPath(projectPath);
  const lockPath = getProjectLockPath(resolvedSelectionPath);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = fs.openSync(lockPath, "wx");
      const payload = {
        pid: owner.pid,
        instanceName: owner.instanceName,
        projectPath: resolveProjectLockDirectory(resolvedSelectionPath),
        selectionPath: resolvedSelectionPath,
        acquiredAt: new Date().toISOString(),
      };
      fs.writeFileSync(handle, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf-8",
      });
      fs.closeSync(handle);
      return {
        projectPath: resolvedSelectionPath,
        state: "current",
        pid: owner.pid,
        instanceName: owner.instanceName,
        message: `Project '${path.basename(resolveProjectLockDirectory(resolvedSelectionPath))}' is open in this Studio instance.`,
      };
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : null;
      if (code !== "EEXIST") {
        throw error;
      }
      const status = readProjectLockStatus(resolvedSelectionPath, owner);
      if (status.state === "available") {
        continue;
      }
      if (status.state === "current") {
        return status;
      }
      throw new ProjectLockConflictError(issueFromStatus(status));
    }
  }

  const status = readProjectLockStatus(resolvedSelectionPath, owner);
  if (status.state === "locked") {
    throw new ProjectLockConflictError(issueFromStatus(status));
  }
  return status;
}

export function releaseProjectLock(
  projectPath: string,
  owner: ProjectLockOwner
): void {
  if (!projectPath) {
    return;
  }
  const resolvedSelectionPath = resolveProjectPath(projectPath);
  const status = readProjectLockStatus(resolvedSelectionPath, owner);
  if (status.state !== "current") {
    return;
  }
  try {
    fs.unlinkSync(getProjectLockPath(resolvedSelectionPath));
  } catch {
    // Best effort during shutdown.
  }
}
