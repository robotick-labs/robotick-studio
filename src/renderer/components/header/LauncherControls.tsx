import React from "react";
import { useLauncherContext } from "../../core/launcher-context";
import { LauncherDots } from "./LauncherDots";

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
    <div className="launcher-control-group">
      <button
        type="button"
        className="launcher-control"
        aria-label={isActive ? "Stop launcher" : "Start launcher"}
        onClick={handleToggle}
        disabled={controlsDisabled}
      >
        <span className={isActive ? "icon-stop" : "icon-play"}>
          {isActive ? "⏹" : "▶"}
        </span>
      </button>

      <button
        type="button"
        className="launcher-control"
        aria-label="Restart launcher"
        onClick={handleRestart}
        disabled={!canRestart || controlsDisabled}
      >
        <span className="icon-restart">↻</span>
      </button>

      <LauncherDots status={status} />

      {lastError ? (
        <span className="launcher-error" role="alert">
          {lastError}
        </span>
      ) : null}
    </div>
  );
}
