import React, { useEffect, useState } from "react";
import type { LauncherStatus } from "../../data-sources/launcher";
import styles from "./styles/LauncherControls.module.css";

export function LauncherDots({
  status,
  robotAlive,
}: {
  status: LauncherStatus;
  robotAlive: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [flatlineReady, setFlatlineReady] = useState(false);

  useEffect(() => {
    setActiveIndex(0);
  }, [status]);

  useEffect(() => {
    if (status !== "launching") return;
    const id = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % 3);
    }, 500);
    return () => {
      window.clearInterval(id);
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
    const timeoutId = window.setTimeout(() => {
      setFlatlineReady(true);
    }, 5000 - elapsed);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [status, robotAlive, runningSince]);

  const showFlatline = status === "running" && !robotAlive && flatlineReady;

  if (showFlatline) {
    return (
      <span className={styles.controlDots} aria-hidden>
        <span className={styles.flatline} />
      </span>
    );
  }

  return (
    <span className={styles.controlDots} aria-hidden>
      <span className={styles.dots}>
        {[0, 1, 2].map((index) => {
          const dotClasses = [styles.dot];

          if (status === "launching" && index === activeIndex) {
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
