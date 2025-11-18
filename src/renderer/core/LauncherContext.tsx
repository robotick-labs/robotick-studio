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
import {
  buildUrl,
  fetchLauncherStatus,
  requestLauncherRun,
  requestLauncherStop,
} from "./launcher-interface";
import { waitForProjectModelsLoaded } from "./LauncherDataContext";

export type LauncherStatus = "stopped" | "launching" | "running";

const POLLING_DEFAULT_INTERVAL_MS = 1000;
const POLLING_FAST_INTERVAL_MS = 200;

type LauncherContextValue = {
  status: LauncherStatus;
  reportedStatus: LauncherStatus;
  lastError: string | null;
  isBusy: boolean;
  isAwaitingStatus: boolean;
  robotAlive: boolean;
  run: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
};

const LauncherContext = createContext<LauncherContextValue | undefined>(
  undefined
);

export const launcherEvents = new EventTarget();

export function LauncherProvider({ children }: { children: React.ReactNode }) {
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
  const [robotAlive, setRobotAlive] = useState(true);
  const lastStatusRef = useRef<LauncherStatus>("stopped");
  const skipNextRobotCheckRef = useRef(false);

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
          const launcherStatus = await readLauncherStatus();
          setReportedStatus((prev) =>
            prev === launcherStatus ? prev : launcherStatus
          );

          const prevStatus = lastStatusRef.current;
          const statusChanged = prevStatus !== launcherStatus;
          lastStatusRef.current = launcherStatus;

          if (launcherStatus === "running") {
            if (statusChanged) {
              setRobotAlive(true);
              skipNextRobotCheckRef.current = true;
            }
            if (skipNextRobotCheckRef.current) {
              skipNextRobotCheckRef.current = false;
            } else {
              const nextRobotAlive = await checkRobotAlive();
              setRobotAlive((prev) =>
                prev === nextRobotAlive ? prev : nextRobotAlive
              );
            }
          } else {
            skipNextRobotCheckRef.current = false;
          }

          setStatus((prev) =>
            prev === launcherStatus ? prev : launcherStatus
          );
          setPendingTarget((target) =>
            target && launcherStatus === target ? null : target
          );
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
  }, []);

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
      await requestLauncherRun(projectPath, launcherProfile || "local:ALL");
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setPendingTarget(null);
      setOptimisticStatus(null);
      throw err;
    } finally {
      setIsBusy(false);
    }
  }, [launcherProfile, projectPath, wakeFastPolling]);

  const stop = useCallback(async () => {
    setIsBusy(true);
    setLastError(null);
    setPendingTarget("stopped");
    wakeFastPolling();
    launcherEvents.dispatchEvent(new Event("stop-requested"));
    try {
      await requestLauncherStop();
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setPendingTarget(null);
      throw err;
    } finally {
      setIsBusy(false);
    }
  }, [wakeFastPolling]);

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
      robotAlive,
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
      robotAlive,
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

async function readLauncherStatus(): Promise<LauncherStatus> {
  const data = await fetchLauncherStatus();
  if (!data?.status) return "stopped";
  if (data.status === "running") return "running";
  if (data.status === "launching" || data.status === "starting")
    return "launching";
  return "stopped";
}

async function checkRobotAlive(): Promise<boolean> {
  const state = await waitForProjectModelsLoaded();
  const models = state.data;
  if (models.length === 0) {
    return false;
  }

  for (const model of models) {
    const url = buildUrl(model.telemetryBaseUrl, "/api/telemetry/health");
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return false;
      }
    } catch (err) {
      console.warn(
        `[launcher] telemetry health check failed for ${model.modelShortName}`,
        err
      );
      return false;
    }
  }

  return true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
