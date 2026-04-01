import React, { useEffect, useState } from "react";
import type { LauncherStatus } from "../../data-sources/launcher";
import styles from "./styles/LauncherControls.module.css";
import {
  clearIntervalSafe,
  clearTimeoutSafe,
  setIntervalSafe,
  setTimeoutSafe,
} from "../../utils/domEnvironment";

/**
 * Render a launcher status indicator that displays animated dots or a flatline.
 *
 * @param status - Controls the indicator's visual state: shows cycling active dots when `"launching"` or `"stopping"`, heartbeat styles when `"running"`, and (when `"running"` and `robotAlive` is `false`) a flatline after a 5000ms delay.
 * @param robotAlive - Whether the robot is currently alive; when `false` and `status` is `"running"`, enables the delayed transition to the flatline view.
 * @returns The JSX element representing the launcher indicator (dots or flatline).
 */
export function LauncherDots({
  status,
  robotAlive,
  tooltipSummary,
}: {
  status: LauncherStatus;
  robotAlive: boolean;
  tooltipSummary: {
    running: Array<{ name: string }>;
    notRunning: Array<{ name: string }>;
  };
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [flatlineReady, setFlatlineReady] = useState(false);

  useEffect(() => {
    setActiveIndex(0);
  }, [status]);

  useEffect(() => {
    if (status !== "launching" && status !== "stopping") return;
    const id = setIntervalSafe(() => {
      setActiveIndex((prev) => (prev + 1) % 3);
    }, 500);
    return () => {
      clearIntervalSafe(id);
    };
  }, [status]);

  useEffect(() => {
    if (status === "running") {
      setRunningSince((prev) => prev ?? Date.now());
    } else {
      setRunningSince(null);
      setFlatlineReady(false);
    }
  }, [status]);

  useEffect(() => {
    if (status !== "running" || robotAlive || runningSince === null) {
      setFlatlineReady(false);
      return;
    }

    const elapsed = Date.now() - runningSince;
    if (elapsed >= 5000) {
      setFlatlineReady(true);
      return;
    }

    setFlatlineReady(false);
    const timeoutId = setTimeoutSafe(() => {
      setFlatlineReady(true);
    }, 5000 - elapsed);

    return () => {
      clearTimeoutSafe(timeoutId);
    };
  }, [status, robotAlive, runningSince]);

  const showFlatline = status === "running" && !robotAlive && flatlineReady;

  if (showFlatline) {
    return (
      <span
        className={styles.controlDots}
        aria-label={buildDotsAriaLabel(tooltipSummary)}
        role="img"
      >
        <span className={styles.flatline} />
      </span>
    );
  }

  return (
    <span
      className={styles.controlDots}
      aria-label={buildDotsAriaLabel(tooltipSummary)}
      role="img"
    >
      <span className={styles.dots}>
        {[0, 1, 2].map((index) => {
          const dotClasses = [styles.dot];

          if (
            (status === "launching" || status === "stopping") &&
            index === activeIndex
          ) {
            dotClasses.push(styles.dotActive);
          } else if (status === "running") {
            dotClasses.push(
              index === 1 ? styles.dotHeartbeatOn : styles.dotHeartbeatOff
            );
          }

          return <span key={index} className={dotClasses.join(" ")}></span>;
        })}
      </span>
    </span>
  );
}

function buildDotsAriaLabel(tooltipSummary: {
  running: Array<{ name: string }>;
  notRunning: Array<{ name: string }>;
}) {
  const running = tooltipSummary.running.map((model) => model.name).join(", ");
  const notRunning = tooltipSummary.notRunning
    .map((model) => model.name)
    .join(", ");
  if (running && notRunning) {
    return `Running: ${running}. Not running: ${notRunning}.`;
  }
  if (running) {
    return `Running: ${running}.`;
  }
  if (notRunning) {
    return `Not running: ${notRunning}.`;
  }
  return "No launcher model status available.";
}
