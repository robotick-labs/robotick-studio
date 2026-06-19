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
import { getProjectModelsStateSnapshot } from "./LauncherDataContext";
import { isAppQuitting } from "../../../utils/appQuitting";
import {
  useLauncherService,
  type LauncherService,
} from "./LauncherService";

export type LauncherStatus = "stopped" | "launching" | "running" | "stopping";
export type LauncherModelStatus = {
  stage?: string;
  status?: string;
  lifecycle?: string;
  readiness?: string;
  freshness?: "live" | "stale" | "stopped" | "pending" | "failed";
  diagnostics?: Array<{
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  }>;
  logRefs?: Array<{
    kind?: string;
    path?: string;
  }>;
};
export type LauncherModelHealth = {
  alive: boolean;
  loading: boolean;
  error?: string | null;
  warning?: string | null;
};

type PendingModelTarget = "running" | "stopped" | "restarting";

const POLLING_DEFAULT_INTERVAL_MS = 1000;
const POLLING_FAST_INTERVAL_MS = 200;

type LauncherContextValue = {
  status: LauncherStatus;
  reportedStatus: LauncherStatus;
  activeProfile: string | null;
  lastError: string | null;
  isBusy: boolean;
  isAwaitingStatus: boolean;
  isRobotAlive: boolean;
  robotAliveLoading: boolean;
  robotAliveError: string | null;
  launcherModels: Record<string, LauncherModelStatus>;
  modelHealth: Record<string, LauncherModelHealth>;
  run: () => Promise<void>;
  runProfile: (profile: string) => Promise<void>;
  runModel: (modelId: string) => Promise<void>;
  stop: () => Promise<void>;
  stopModel: (modelId: string) => Promise<void>;
  restart: () => Promise<void>;
  restartProfile: (profile: string) => Promise<void>;
  restartModel: (modelId: string) => Promise<void>;
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
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const fastPollUntilRef = useRef(0);
  const [isRobotAlive, setIsRobotAlive] = useState(true);
  const [robotAliveLoading, setRobotAliveLoading] = useState(false);
  const [robotAliveError, setRobotAliveError] = useState<string | null>(null);
  const [launcherModels, setLauncherModels] = useState<
    Record<string, LauncherModelStatus>
  >({});
  const [pendingModelTargets, setPendingModelTargets] = useState<
    Record<string, PendingModelTarget>
  >({});
  const pendingModelTargetsRef = useRef<Record<string, PendingModelTarget>>({});
  const [modelHealth, setModelHealth] = useState<
    Record<string, LauncherModelHealth>
  >({});
  const lastStatusRef = useRef<LauncherStatus | null>(null);
  const robotCheckPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    pendingModelTargetsRef.current = pendingModelTargets;
  }, [pendingModelTargets]);

  const wakeFastPolling = useCallback(() => {
    fastPollUntilRef.current = Date.now() + 1500;
  }, []);

  const setPendingModelTarget = useCallback(
    (modelId: string, target: PendingModelTarget) => {
      const nextTargets = {
        ...pendingModelTargetsRef.current,
        [modelId]: target,
      };
      pendingModelTargetsRef.current = nextTargets;
      setPendingModelTargets(nextTargets);
      setLauncherModels((prev) => projectPendingModelTargets(prev, nextTargets));
    },
    []
  );

  const clearPendingModelTarget = useCallback((modelId: string) => {
    const nextTargets = { ...pendingModelTargetsRef.current };
    delete nextTargets[modelId];
    pendingModelTargetsRef.current = nextTargets;
    setPendingModelTargets(nextTargets);
  }, []);

  const setAllActiveModelsStopping = useCallback(() => {
    const nextTargets = { ...pendingModelTargetsRef.current };
    for (const [modelId, model] of Object.entries(launcherModels)) {
      if (!isModelEffectivelyStopped(model)) {
        nextTargets[modelId] = "stopped";
      }
    }
    pendingModelTargetsRef.current = nextTargets;
    setPendingModelTargets(nextTargets);
    setLauncherModels((prev) => projectPendingModelTargets(prev, nextTargets));
  }, [launcherModels]);

  useEffect(() => {
    let cancelled = false;

    async function pollLoop() {
      while (!cancelled && !isAppQuitting()) {
        const interval =
          Date.now() < fastPollUntilRef.current
            ? POLLING_FAST_INTERVAL_MS
            : POLLING_DEFAULT_INTERVAL_MS;

        try {
          const launcherSnapshot = await readLauncherStatus(launcherService);
          const nextPendingModelTargets = reconcilePendingModelTargets(
            launcherSnapshot.models,
            pendingModelTargetsRef.current
          );
          const projectedLauncherModels = projectPendingModelTargets(
            launcherSnapshot.models,
            nextPendingModelTargets
          );
          const launcherStatus = launcherSnapshot.status;
          const launcherProfile = launcherSnapshot.profile;
          setReportedStatus((prev) =>
            prev === launcherStatus ? prev : launcherStatus
          );
          setActiveProfile((prev) =>
            prev === launcherProfile ? prev : launcherProfile
          );
          setLauncherModels((prev) =>
            areLauncherModelsEqual(prev, projectedLauncherModels)
              ? prev
              : projectedLauncherModels
          );
          setPendingModelTargets((prev) =>
            arePendingModelTargetsEqual(prev, nextPendingModelTargets)
              ? prev
              : nextPendingModelTargets
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
            }
            if (!robotCheckPromiseRef.current) {
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
            robotCheckPromiseRef.current = null;
            setIsRobotAlive(true);
            setRobotAliveLoading(false);
            setRobotAliveError(null);
            setModelHealth({});
          }

          setStatus((prev) =>
            prev === launcherStatus ? prev : launcherStatus
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
          setOptimisticStatus((current) => {
            if (!current) {
              return null;
            }
            return launcherStatus !== "launching" ? null : current;
          });
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

  const requestRun = useCallback(async () => {
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

  const run = useCallback(async () => {
    await requestRun();
  }, [requestRun]);

  const runProfile = useCallback(
    async (profile: string) => {
      if (!projectPath) {
        setLastError("Select a project before running the launcher.");
        return;
      }

      setIsBusy(true);
      setLastError(null);
      setPendingTarget("running");
      setOptimisticStatus("launching");
      wakeFastPolling();
      launcherEvents.dispatchEvent(
        new CustomEvent("run-requested", { detail: { profile } })
      );

      try {
        await launcherService.requestLauncherRun(projectPath, profile);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
        setPendingTarget(null);
        setOptimisticStatus(null);
        throw err;
      } finally {
        setIsBusy(false);
      }
    },
    [launcherService, projectPath, wakeFastPolling]
  );

  const runModel = useCallback(
    async (modelId: string) => {
      if (!projectPath) {
        setLastError("Select a project before running the launcher.");
        return;
      }
      const platform = resolveProfilePlatform(launcherProfile);
      setLastError(null);
      setPendingModelTarget(modelId, "running");
      wakeFastPolling();
      launcherEvents.dispatchEvent(
        new CustomEvent("run-requested", { detail: { modelId } })
      );
      try {
        await launcherService.requestLauncherRunModel(
          projectPath,
          platform,
          modelId
        );
      } catch (err) {
        clearPendingModelTarget(modelId);
        setLastError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [
      clearPendingModelTarget,
      launcherProfile,
      launcherService,
      projectPath,
      setPendingModelTarget,
      wakeFastPolling,
    ]
  );

  const requestStop = useCallback(async () => {
    setIsBusy(true);
    setLastError(null);
    setPendingTarget("stopped");
    setAllActiveModelsStopping();
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
  }, [launcherService, setAllActiveModelsStopping, wakeFastPolling]);

  const stop = useCallback(async () => {
    await requestStop();
  }, [requestStop]);

  const stopModel = useCallback(
    async (modelId: string) => {
      if (!projectPath) {
        setLastError("Select a project before running the launcher.");
        return;
      }
      const platform = resolveProfilePlatform(launcherProfile);
      setLastError(null);
      setPendingModelTarget(modelId, "stopped");
      wakeFastPolling();
      try {
        await launcherService.requestLauncherStopModel(
          projectPath,
          platform,
          modelId
        );
      } catch (err) {
        clearPendingModelTarget(modelId);
        setLastError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [
      clearPendingModelTarget,
      launcherProfile,
      launcherService,
      projectPath,
      setPendingModelTarget,
      wakeFastPolling,
    ]
  );

  const restart = useCallback(async () => {
    if (!projectPath) {
      setLastError("Select a project before running the launcher.");
      return;
    }

    setIsBusy(true);
    setLastError(null);
    setPendingTarget("running");
    setOptimisticStatus("launching");
    wakeFastPolling();
    launcherEvents.dispatchEvent(new Event("restart-requested"));

    try {
      await launcherService.requestLauncherRestart(
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

  const restartProfile = useCallback(
    async (profile: string) => {
      if (!projectPath) {
        setLastError("Select a project before running the launcher.");
        return;
      }

      setIsBusy(true);
      setLastError(null);
      setPendingTarget("running");
      setOptimisticStatus("launching");
      wakeFastPolling();
      launcherEvents.dispatchEvent(
        new CustomEvent("restart-requested", { detail: { profile } })
      );

      try {
        await launcherService.requestLauncherRestart(projectPath, profile);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
        setPendingTarget(null);
        setOptimisticStatus(null);
        throw err;
      } finally {
        setIsBusy(false);
      }
    },
    [
      launcherService,
      projectPath,
      wakeFastPolling,
    ]
  );

  const restartModel = useCallback(
    async (modelId: string) => {
      if (!projectPath) {
        setLastError("Select a project before running the launcher.");
        return;
      }
      const platform = resolveProfilePlatform(launcherProfile);
      setLastError(null);
      setPendingModelTarget(modelId, "restarting");
      wakeFastPolling();
      launcherEvents.dispatchEvent(
        new CustomEvent("restart-requested", { detail: { modelId } })
      );
      try {
        await launcherService.requestLauncherRestartModel(
          projectPath,
          platform,
          modelId
        );
      } catch (err) {
        clearPendingModelTarget(modelId);
        setLastError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [
      clearPendingModelTarget,
      launcherProfile,
      launcherService,
      projectPath,
      setPendingModelTarget,
      wakeFastPolling,
    ]
  );

  const effectiveStatus = optimisticStatus ?? status;
  const isAwaitingStatus = pendingTarget !== null;

  const value = useMemo(
    () => ({
      status: effectiveStatus,
      reportedStatus,
      activeProfile,
      lastError,
      isBusy,
      isAwaitingStatus,
      isRobotAlive,
      robotAliveLoading,
      robotAliveError,
      launcherModels,
      modelHealth,
      run,
      runProfile,
      runModel,
      stop,
      stopModel,
      restart,
      restartProfile,
      restartModel,
    }),
    [
      activeProfile,
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
      restartModel,
      restartProfile,
      run,
      runModel,
      runProfile,
      stop,
      stopModel,
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
  profile: string | null;
  models: Record<string, LauncherModelStatus>;
}> {
  const data = await service.fetchLauncherStatus();
  const models = data?.models ?? {};
  const profile = normalizeProfileValue(data?.profile);
  if (!data?.status) return { status: "stopped", profile, models };
  if (data.status === "running") return { status: "running", profile, models };
  if (data.status === "stopping") return { status: "stopping", profile, models };
  if (data.status === "launching" || data.status === "starting") {
    return { status: "launching", profile, models };
  }
  return { status: "stopped", profile, models };
}

function isDetachedLaunchedModel(
  launcherModel?: LauncherModelStatus
): boolean {
  return (
    launcherModel?.stage === "run" &&
    (launcherModel?.status === "succeeded" ||
      launcherModel?.freshness === "stale")
  );
}

function isModelEffectivelyRunning(
  launcherModel?: LauncherModelStatus
): boolean {
  const lifecycle = launcherModel?.lifecycle?.trim();
  const readiness = launcherModel?.readiness?.trim();
  const freshness = launcherModel?.freshness?.trim();
  return (
    lifecycle === "running" ||
    lifecycle === "handed_off" ||
    readiness === "ready" ||
    freshness === "live"
  );
}

function isModelEffectivelyStopped(
  launcherModel?: LauncherModelStatus
): boolean {
  if (!launcherModel) {
    return true;
  }
  const lifecycle = launcherModel.lifecycle?.trim();
  const readiness = launcherModel.readiness?.trim();
  const freshness = launcherModel.freshness?.trim();
  return (
    (lifecycle === "stopped" || lifecycle === "failed" || lifecycle === undefined) &&
    (readiness === "pending" || readiness === "failed" || readiness === undefined) &&
    freshness !== "live" &&
    freshness !== "stale"
  );
}

function projectPendingModelTargets(
  launcherModels: Record<string, LauncherModelStatus>,
  pendingModelTargets: Record<string, PendingModelTarget>
): Record<string, LauncherModelStatus> {
  const nextModels = { ...launcherModels };
  for (const [modelId, target] of Object.entries(pendingModelTargets)) {
    const current = nextModels[modelId];
    if (target === "restarting") {
      nextModels[modelId] = {
        ...current,
        stage: "stop",
        status: "stopping",
        lifecycle: "stopping",
        readiness: "pending",
        freshness: "pending",
      };
      continue;
    }
    if (target === "running" && !isModelEffectivelyRunning(current)) {
      nextModels[modelId] = {
        ...current,
        stage: "run",
        status: "starting",
        lifecycle: "starting",
        readiness: "pending",
        freshness: "pending",
      };
      continue;
    }
    if (target === "stopped") {
      nextModels[modelId] = {
        ...current,
        stage: "stop",
        status: "stopping",
        lifecycle: "stopping",
        readiness: "pending",
        freshness: "pending",
      };
    }
  }
  return nextModels;
}

function reconcilePendingModelTargets(
  launcherModels: Record<string, LauncherModelStatus>,
  pendingModelTargets: Record<string, PendingModelTarget>
): Record<string, PendingModelTarget> {
  const nextTargets: Record<string, PendingModelTarget> = {};
  for (const [modelId, target] of Object.entries(pendingModelTargets)) {
    const current = launcherModels[modelId];
    if (target === "restarting") {
      const status = current?.status?.trim();
      const lifecycle = current?.lifecycle?.trim();
      if (
        status === "starting" ||
        status === "stopping" ||
        lifecycle === "starting" ||
        lifecycle === "stopping"
      ) {
        nextTargets[modelId] = target;
      }
      continue;
    }
    if (target === "running") {
      if (
        current &&
        !isModelEffectivelyStopped(current) &&
        !isModelEffectivelyRunning(current)
      ) {
        nextTargets[modelId] = target;
      }
      continue;
    }
    if (!isModelEffectivelyStopped(current)) {
      nextTargets[modelId] = target;
    }
  }
  return nextTargets;
}

function arePendingModelTargetsEqual(
  left: Record<string, PendingModelTarget>,
  right: Record<string, PendingModelTarget>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
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

  const results = await Promise.all(
    models.map(async (model) => {
      const launcherModel = launcherModels[model.modelShortName];
      const detachedLaunched = isDetachedLaunchedModel(launcherModel);
      try {
        const telemetryBridge = window.robotick?.telemetry;
        if (!telemetryBridge) {
          throw new Error("Electron telemetry bridge is required.");
        }
        const res = await telemetryBridge.getHealth(model.telemetryBaseUrl) as {
          ok?: unknown;
          status?: unknown;
          statusText?: unknown;
        };
        const ok = res.ok === true;
        const status = typeof res.status === "number" ? res.status : 0;
        const statusText = typeof res.statusText === "string" ? res.statusText : "";
        if (!ok) {
          if (detachedLaunched) {
            return {
              modelId: model.modelShortName,
              health: {
                alive: true,
                loading: false,
                error: null,
                warning: `${status} ${statusText}`.trim(),
              },
            };
          }
          return {
            modelId: model.modelShortName,
            health: {
              alive: false,
              loading: false,
              error: `${status} ${statusText}`.trim(),
              warning: null,
            },
          };
        }
        return {
          modelId: model.modelShortName,
          health: {
            alive: true,
            loading: false,
            error: null,
            warning: null,
          },
        };
      } catch (err) {
        console.warn(
          `[launcher] telemetry health check failed for ${model.modelShortName}`,
          err
        );
        if (detachedLaunched) {
          return {
            modelId: model.modelShortName,
            health: {
              alive: true,
              loading: false,
              error: null,
              warning: err instanceof Error ? err.message : String(err),
            },
          };
        }
        return {
          modelId: model.modelShortName,
          health: {
            alive: false,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
            warning: null,
          },
        };
      }
    })
  );

  const healthByModel: Record<string, LauncherModelHealth> = {};
  const failingModels: string[] = [];
  for (const { modelId, health } of results) {
    healthByModel[modelId] = health;
    if (!health.alive) {
      failingModels.push(modelId);
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

function resolveProfilePlatform(profile: string): "local" | "native" {
  const value = profile.trim().toLowerCase();
  if (value.startsWith("native:")) {
    return "native";
  }
  return "local";
}

function normalizeProfileValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
