import { useEffect, useState } from "react";
import { useLauncherService } from "./LauncherService";
import type { ProjectLockStatus } from "./launcher-interface";

function areStatusesEqual(
  left: Record<string, ProjectLockStatus>,
  right: Record<string, ProjectLockStatus>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => {
    const a = left[key];
    const b = right[key];
    return (
      b !== undefined &&
      a.projectPath === b.projectPath &&
      a.state === b.state &&
      a.instanceName === b.instanceName &&
      a.pid === b.pid &&
      a.message === b.message
    );
  });
}

export function useProjectLockStatuses(
  projectPaths: string[],
  pollIntervalMs = 5000
) {
  const launcherService = useLauncherService();
  const projectPathsKey = projectPaths.join("\n");
  const [statusesByPath, setStatusesByPath] = useState<
    Record<string, ProjectLockStatus>
  >({});

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (projectPaths.length === 0) {
        if (!cancelled) {
          setStatusesByPath((current) =>
            Object.keys(current).length === 0 ? current : {}
          );
        }
        return;
      }
      let statuses: ProjectLockStatus[];
      try {
        statuses = await launcherService.fetchProjectLockStatuses(projectPaths);
      } catch {
        return;
      }
      if (cancelled) {
        return;
      }
      const nextStatuses = Object.fromEntries(
        statuses.map((status) => [status.projectPath, status])
      );
      setStatusesByPath((current) =>
        areStatusesEqual(current, nextStatuses) ? current : nextStatuses
      );
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [launcherService, pollIntervalMs, projectPathsKey]);

  return {
    statusesByPath,
  };
}
