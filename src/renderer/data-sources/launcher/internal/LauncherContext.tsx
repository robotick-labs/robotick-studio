import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useProjectContext } from "./ProjectContext";
import { buildUrl } from "./launcher-interface";
import { getProjectModelsStateSnapshot } from "./LauncherDataContext";
import {
  useLauncherService,
  type LauncherService,
} from "./LauncherService";

export type LauncherStatus = "stopped" | "launching" | "running";
export type LauncherModelStatus = {
  stage?: string;
  status?: string;
};
export type LauncherModelHealth = {
  alive: boolean;
  loading: boolean;
  error?: string | null;
  warning?: string | null;
};

const POLLING_DEFAULT_INTERVAL_MS = 1000;
const POLLING_FAST_INTERVAL_MS = 200;
const STARTUP_VISUAL_GRACE_MS = 10000;

type LauncherContextValue = {
  status: LauncherStatus;
  reportedStatus: LauncherStatus;
  lastError: string | null;
  isBusy: boolean;
  isAwaitingStatus: boolean;
  isRobotAlive: boolean;
  robotAliveLoading: boolean;
  robotAliveError: string | null;
  launcherModels: Record<string, LauncherModelStatus>;
  modelHealth: Record<string, LauncherModelHealth>;
  run: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
};

const LauncherContext = createContext<LauncherContextValue | undefined>(
  undefined
);

export const launcherEvents = new EventTarget();

export function LauncherProvider({ children }: { children: React.ReactNode }) {
  const launcherService = useLauncherService();
  const { projectPath, launcherProfile } = useProjectContext();
  const [status, setStatus] = useState<LauncherStatus>("stopped");
  const [isBusy, setIsBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [optimisticStatus, setOptimisticStatus] =
    useState<LauncherStatus | null>(null);
  const [pendingTarget, setPendingTarget] = useState<LauncherStatus | null>(
    null
  );
  const [reportedStatus, setReportedStatus] =
    useState<LauncherStatus>("stopped");
  const fastPollUntilRef = useRef(0);
  const [isRobotAlive, setIsRobotAlive] = useState(true);
  const [robotAliveLoading, setRobotAliveLoading] = useState(false);
  const [robotAliveError, setRobotAliveError] = useState<string | null>(null);
  const [launcherModels, setLauncherModels] = useState<
    Record<string, LauncherModelStatus>
  >({});
  const [modelHealth, setModelHealth] = useState<
    Record<string, LauncherModelHealth>
  >({});
  const lastStatusRef = useRef<LauncherStatus | null>(null);
  const skipNextRobotCheckRef = useRef(false);
  const robotCheckPromiseRef = useRef<Promise<void> | null>(null);
  const lastRunningAtRef = useRef<number | null>(null);

  const wakeFastPolling = useCallback(() => {
    fastPollUntilRef.current = Date.now() + 1500;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollLoop() {
      while (!cancelled) {
        const interval =
          Date.now() < fastPollUntilRef.current
            ? POLLING_FAST_INTERVAL_MS
            : POLLING_DEFAULT_INTERVAL_MS;

        try {
          const launcherSnapshot = await readLauncherStatus(launcherService);
          const launcherStatus = launcherSnapshot.status;
          const now = Date.now();
          setReportedStatus((prev) =>
            prev === launcherStatus ? prev : launcherStatus
          );
          setLauncherModels((prev) =>
            areLauncherModelsEqual(prev, launcherSnapshot.models)
              ? prev
              : launcherSnapshot.models
          );

          const prevStatus = lastStatusRef.current;
          const statusChanged = prevStatus !== launcherStatus;
          lastStatusRef.current = launcherStatus;

          if (statusChanged || prevStatus === null) {
            launcherEvents.dispatchEvent(
              new CustomEvent("status-changed", {
                detail: { status: launcherStatus },
              })
            );
          }

          if (launcherStatus === "running") {
            if (statusChanged) {
              setIsRobotAlive(true);
              setRobotAliveLoading(true);
              setRobotAliveError(null);
              setModelHealth({});
              skipNextRobotCheckRef.current = true;
              lastRunningAtRef.current = now;
            }
            const inStartupGrace =
              typeof lastRunningAtRef.current === "number" &&
              now - lastRunningAtRef.current < STARTUP_VISUAL_GRACE_MS;
            if (skipNextRobotCheckRef.current) {
              skipNextRobotCheckRef.current = false;
            }
            if (inStartupGrace) {
              setRobotAliveLoading(true);
            } else if (
              !robotCheckPromiseRef.current &&
              typeof lastRunningAtRef.current === "number" &&
              now - lastRunningAtRef.current >= 5000
            ) {
              setRobotAliveLoading(true);
              robotCheckPromiseRef.current = checkRobotAlive(
                launcherSnapshot.models
              )
                .then((result) => {
                  setIsRobotAlive(result.alive);
                  setModelHealth(result.models);
                  setRobotAliveError(result.error);
                })
                .catch((err) => {
                  setRobotAliveError(
                    err instanceof Error ? err.message : String(err)
                  );
                })
                .finally(() => {
                  robotCheckPromiseRef.current = null;
                  setRobotAliveLoading(false);
                });
            }
          } else {
            skipNextRobotCheckRef.current = false;
            robotCheckPromiseRef.current = null;
            setIsRobotAlive(true);
            setRobotAliveLoading(false);
            setRobotAliveError(null);
            setModelHealth({});
          }

          const visualStatus: LauncherStatus =
            launcherStatus === "running" &&
            typeof lastRunningAtRef.current === "number" &&
            now - lastRunningAtRef.current < STARTUP_VISUAL_GRACE_MS
              ? "launching"
              : launcherStatus;

          setStatus((prev) =>
            prev === visualStatus ? prev : visualStatus
          );
          setPendingTarget((target) => {
            if (!target) {
              return null;
            }
            if (launcherStatus === target) {
              return null;
            }
            if (target === "running" && launcherStatus === "stopped") {
              // A run attempt failed and the backend reported it stopped again.
              // Clear the pending target so UI controls unlock immediately.
              return null;
            }
            return target;
          });
          setOptimisticStatus((current) =>
            current && launcherStatus !== "launching" ? null : current
          );
        } catch (err) {
          console.warn("[launcher] poll failed", err);
        }

        await sleep(interval);
      }
    }

    pollLoop();
    return () => {
      cancelled = true;
    };
  }, [launcherService]);

  const run = useCallback(async () => {
    if (!projectPath) {
      setLastError("Select a project before running the launcher.");
      return;
    }

    setIsBusy(true);
    setLastError(null);
    setPendingTarget("running");
    setOptimisticStatus("launching");
    wakeFastPolling();
    launcherEvents.dispatchEvent(new Event("run-requested"));

    try {
      await launcherService.requestLauncherRun(
        projectPath,
        launcherProfile || "local:ALL"
      );
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setPendingTarget(null);
      setOptimisticStatus(null);
      throw err;
    } finally {
      setIsBusy(false);
    }
  }, [launcherProfile, launcherService, projectPath, wakeFastPolling]);

  const stop = useCallback(async () => {
    setIsBusy(true);
    setLastError(null);
    setPendingTarget("stopped");
    wakeFastPolling();
    launcherEvents.dispatchEvent(new Event("stop-requested"));
    try {
      await launcherService.requestLauncherStop();
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setPendingTarget(null);
      throw err;
    } finally {
      setIsBusy(false);
    }
  }, [launcherService, wakeFastPolling]);

  const restart = useCallback(async () => {
    await stop();
    await sleep(500);
    await run();
  }, [run, stop]);

  const effectiveStatus = optimisticStatus ?? status;
  const isAwaitingStatus = pendingTarget !== null;

  const value = useMemo(
    () => ({
      status: effectiveStatus,
      reportedStatus,
      lastError,
      isBusy,
      isAwaitingStatus,
      isRobotAlive,
      robotAliveLoading,
      robotAliveError,
      launcherModels,
      modelHealth,
      run,
      stop,
      restart,
    }),
    [
      effectiveStatus,
      reportedStatus,
      isAwaitingStatus,
      isBusy,
      lastError,
      isRobotAlive,
      robotAliveLoading,
      robotAliveError,
      launcherModels,
      modelHealth,
      restart,
      run,
      stop,
    ]
  );

  return (
    <LauncherContext.Provider value={value}>
      {children}
    </LauncherContext.Provider>
  );
}

export function useLauncherContext(): LauncherContextValue {
  const ctx = useContext(LauncherContext);
  if (!ctx) {
    throw new Error("useLauncherContext must be used within LauncherProvider");
  }
  return ctx;
}

async function readLauncherStatus(
  service: LauncherService
): Promise<{
  status: LauncherStatus;
  models: Record<string, LauncherModelStatus>;
}> {
  const data = await service.fetchLauncherStatus();
  const models = data?.models ?? {};
  if (!data?.status) return { status: "stopped", models };
  if (data.status === "running") return { status: "running", models };
  if (data.status === "launching" || data.status === "starting") {
    return { status: "launching", models };
  }
  return { status: "stopped", models };
}

function isDetachedLaunchedModel(
  launcherModel?: LauncherModelStatus
): boolean {
  return (
    launcherModel?.stage === "run" && launcherModel?.status === "succeeded"
  );
}

async function checkRobotAlive(
  launcherModels: Record<string, LauncherModelStatus>
): Promise<{
  alive: boolean;
  error: string | null;
  models: Record<string, LauncherModelHealth>;
}> {
  const snapshot = getProjectModelsStateSnapshot();
  const models =
    snapshot.loading && snapshot.data.length === 0
      ? null
      : snapshot.data.length > 0
        ? snapshot.data
        : null;
  if (!models) {
    return { alive: true, error: null, models: {} };
  }

  const healthByModel: Record<string, LauncherModelHealth> = {};
  const failingModels: string[] = [];
  for (const model of models) {
    const launcherModel = launcherModels[model.modelShortName];
    const detachedLaunched = isDetachedLaunchedModel(launcherModel);
    const url = buildUrl(model.telemetryBaseUrl, "/api/telemetry/health");
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (detachedLaunched) {
          healthByModel[model.modelShortName] = {
            alive: true,
            loading: false,
            error: null,
            warning: `${res.status} ${res.statusText}`.trim(),
          };
          continue;
        }
        healthByModel[model.modelShortName] = {
          alive: false,
          loading: false,
          error: `${res.status} ${res.statusText}`,
          warning: null,
        };
        failingModels.push(model.modelShortName);
        continue;
      }
      healthByModel[model.modelShortName] = {
        alive: true,
        loading: false,
        error: null,
        warning: null,
      };
    } catch (err) {
      console.warn(
        `[launcher] telemetry health check failed for ${model.modelShortName}`,
        err
      );
      if (detachedLaunched) {
        healthByModel[model.modelShortName] = {
          alive: true,
          loading: false,
          error: null,
          warning: err instanceof Error ? err.message : String(err),
        };
        continue;
      }
      healthByModel[model.modelShortName] = {
        alive: false,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        warning: null,
      };
      failingModels.push(model.modelShortName);
    }
  }

  if (failingModels.length > 0) {
    return {
      alive: false,
      error: `Flatlined: ${failingModels.join(", ")}`,
      models: healthByModel,
    };
  }

  return { alive: true, error: null, models: healthByModel };
}

function areLauncherModelsEqual(
  left: Record<string, LauncherModelStatus>,
  right: Record<string, LauncherModelStatus>
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    const leftValue = left[key];
    const rightValue = right[key];
    if (!rightValue) {
      return false;
    }
    if (
      leftValue?.stage !== rightValue?.stage ||
      leftValue?.status !== rightValue?.status
    ) {
      return false;
    }
  }
  return true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
