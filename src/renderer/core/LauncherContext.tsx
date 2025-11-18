import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LAUNCHER_LOCAL_API_BASE,
  POLLING_DEFAULT_INTERVAL_MS,
  POLLING_FAST_INTERVAL_MS,
} from "./config";
import { buildUrl, fetchJSON, tryFetchJSON } from "./http";
import { useProjectContext } from "./ProjectContext";
import { getPrimaryTelemetryBase } from "./current-project";

export type LauncherStatus = "stopped" | "starting" | "running";

type LauncherContextValue = {
  status: LauncherStatus;
  lastError: string | null;
  isBusy: boolean;
  isAwaitingStatus: boolean;
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
  const fastPollUntilRef = useRef(0);

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
          const launcherActive = await checkLauncherActive();
          const robotAlive = launcherActive ? await checkRobotAlive() : false;

          const nextStatus: LauncherStatus = robotAlive
            ? "running"
            : launcherActive
            ? "starting"
            : "stopped";

          setStatus((prev) => (prev === nextStatus ? prev : nextStatus));
          setPendingTarget((target) =>
            target && nextStatus === target ? null : target
          );
          setOptimisticStatus((current) =>
            current && nextStatus !== "starting" ? null : current
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
    setOptimisticStatus("starting");
    wakeFastPolling();
    launcherEvents.dispatchEvent(new Event("run-requested"));

    try {
      const url = buildUrl(LAUNCHER_LOCAL_API_BASE, "/launcher/run", {
        project_path: projectPath,
        profile: launcherProfile || "local:ALL",
      });
      await fetchJSON(url, { method: "POST" });
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
      const url = buildUrl(LAUNCHER_LOCAL_API_BASE, "/launcher/stop");
      await fetchJSON(url, { method: "POST" });
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
      lastError,
      isBusy,
      isAwaitingStatus,
      run,
      stop,
      restart,
    }),
    [effectiveStatus, isAwaitingStatus, isBusy, lastError, restart, run, stop]
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

async function checkLauncherActive(): Promise<boolean> {
  const url = buildUrl(LAUNCHER_LOCAL_API_BASE, "/launcher/status");
  const data = await tryFetchJSON<{ status: string }>(url);
  return data?.status === "running" || data?.status === "starting";
}

async function checkRobotAlive(): Promise<boolean> {
  const telemetryBaseUrl = await getPrimaryTelemetryBase();
  const url = buildUrl(telemetryBaseUrl, "/api/telemetry/health");
  const res = await fetch(url);
  return res.ok;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
