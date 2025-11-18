import React from "react";
import { useLauncherContext } from "../../core/launcher";
import { LauncherDots } from "./LauncherDots";
import styles from "./styles/LauncherControls.module.css";

export function LauncherControls() {
  const {
    status,
    reportedStatus,
    isBusy,
    isAwaitingStatus,
    isRobotAlive,
    lastError,
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

      <LauncherDots status={status} robotAlive={isRobotAlive} />

      {lastError ? (
        <span className={styles.error} role="alert">
          {lastError}
        </span>
      ) : null}
    </div>
  );
}
