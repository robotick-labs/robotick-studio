import React from "react";
import { useLauncherContext } from "../../core/launcher-context";
import { LauncherDots } from "./LauncherDots";
import styles from "./LauncherControls.module.css";

export function LauncherControls() {
  const { status, isBusy, isAwaitingStatus, lastError, run, stop, restart } =
    useLauncherContext();
  const isRunning = status === "running";
  const isStarting = status === "starting";
  const isActive = isRunning || isStarting;
  const canRestart = isRunning && !isBusy;
  const controlsDisabled = isBusy || isAwaitingStatus;

  async function handleToggle() {
    if (isActive) {
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
        aria-label={isActive ? "Stop launcher" : "Start launcher"}
        onClick={handleToggle}
        disabled={controlsDisabled}
      >
        <span
          className={`${styles.icon} ${
            isActive ? styles.iconStop : styles.iconPlay
          }`}
        >
          {isActive ? "⏹" : "▶"}
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

      <LauncherDots status={status} />

      {lastError ? (
        <span className={styles.error} role="alert">
          {lastError}
        </span>
      ) : null}
    </div>
  );
}
