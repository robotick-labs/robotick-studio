import React from "react";
import { Launcher } from "../../data-sources/launcher";
import { LauncherDots } from "./LauncherDots";
import styles from "./styles/LauncherControls.module.css";

const useLauncherContext = Launcher.Context.use;

export function LauncherControls() {
  const {
    status,
    reportedStatus,
    isBusy,
    isAwaitingStatus,
    isRobotAlive,
    lastError,
    launcherModels,
    modelHealth,
    run,
    stop,
    restart,
  } = useLauncherContext();
  const isRunning = status === "running";
  const serverRunning = reportedStatus === "running";
  const serverLaunching = reportedStatus === "launching";
  const serverActive = serverRunning || serverLaunching;
  const canRestart = isRunning && !isBusy;
  const controlsDisabled = isBusy || isAwaitingStatus;
  const toggleDisabled = serverActive ? isBusy : controlsDisabled;
  const tooltipSummary = buildTooltipSummary(launcherModels, modelHealth);

  async function handleToggle() {
    if (serverActive) {
      await stop();
    } else {
      await run();
    }
  }

  async function handleRestart() {
    if (!canRestart) return;
    await restart();
  }

  return (
    <div className={styles.controlGroup}>
      <button
        type="button"
        className={styles.control}
        aria-label={serverActive ? "Stop launcher" : "Start launcher"}
        onClick={handleToggle}
        disabled={toggleDisabled}
      >
        <span
          className={`${styles.icon} ${
            serverActive ? styles.iconStop : styles.iconPlay
          }`}
        >
          {serverActive ? "⏹" : "▶"}
        </span>
      </button>

      <button
        type="button"
        className={styles.control}
        aria-label="Restart launcher"
        onClick={handleRestart}
        disabled={!canRestart || controlsDisabled}
      >
        <span className={`${styles.icon} ${styles.iconRestart}`}>↻</span>
      </button>

      <div className={styles.statusIndicator}>
        <LauncherDots
          status={status}
          robotAlive={isRobotAlive}
          tooltipSummary={tooltipSummary}
        />
        <div className={styles.statusTooltip} role="tooltip">
          <div className={styles.statusTooltipTitle}>Launcher Status</div>
          {tooltipSummary.running.length > 0 ? (
            <div className={styles.statusTooltipSection}>
              <div className={styles.statusTooltipLabel}>Running</div>
              {tooltipSummary.running.map((model) => (
                <div key={model.name} className={styles.statusTooltipRow}>
                  <span>{model.name}</span>
                  {model.detail ? (
                    <span className={styles.statusTooltipDetail}>
                      {model.detail}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {tooltipSummary.notRunning.length > 0 ? (
            <div className={styles.statusTooltipSection}>
              <div className={styles.statusTooltipLabel}>Not Running</div>
              {tooltipSummary.notRunning.map((model) => (
                <div
                  key={model.name}
                  className={`${styles.statusTooltipRow} ${styles.statusTooltipRowError}`}
                >
                  <span>{model.name}</span>
                  {model.detail ? (
                    <span className={styles.statusTooltipDetail}>
                      {model.detail}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {tooltipSummary.running.length === 0 &&
          tooltipSummary.notRunning.length === 0 ? (
            <div className={styles.statusTooltipEmpty}>
              No launcher model status available.
            </div>
          ) : null}
        </div>
      </div>

      {lastError ? (
        <span className={styles.error} role="alert">
          {lastError}
        </span>
      ) : null}
    </div>
  );
}

type TooltipRow = {
  name: string;
  detail: string | null;
};

function buildTooltipSummary(
  launcherModels: Record<string, { stage?: string; status?: string }>,
  modelHealth: Record<string, { alive: boolean; loading: boolean; error?: string | null }>
): {
  running: TooltipRow[];
  notRunning: TooltipRow[];
} {
  const names = Array.from(
    new Set([...Object.keys(launcherModels), ...Object.keys(modelHealth)])
  ).sort((left, right) => left.localeCompare(right));

  const running: TooltipRow[] = [];
  const notRunning: TooltipRow[] = [];

  for (const name of names) {
    const launcherModel = launcherModels[name];
    const health = modelHealth[name];
    const launcherRunning =
      launcherModel?.status === "running" ||
      (launcherModel?.stage === "run" && launcherModel?.status === "succeeded");
    const healthLoading = health?.loading === true;
    const healthAlive = health?.alive !== false;
    const isRunning = launcherRunning && (healthLoading || healthAlive);
    const detail = buildTooltipDetail(launcherModel, health);

    if (isRunning) {
      running.push({ name, detail });
    } else {
      notRunning.push({ name, detail });
    }
  }

  return { running, notRunning };
}

function buildTooltipDetail(
  launcherModel?: { stage?: string; status?: string },
  health?: { alive: boolean; loading: boolean; error?: string | null }
): string | null {
  if (health?.loading) {
    return "health check pending";
  }
  if (health && !health.alive) {
    return health.error?.trim() || "flatlined";
  }
  if (launcherModel?.stage && launcherModel?.status) {
    if (
      launcherModel.stage === "run" &&
      launcherModel.status === "succeeded"
    ) {
      return "launched";
    }
    return `${launcherModel.stage} • ${launcherModel.status}`;
  }
  if (launcherModel?.status) {
    return launcherModel.status;
  }
  return null;
}
