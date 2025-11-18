import React, { useEffect, useState } from "react";
import { LauncherStatus } from "../../core/launcher/LauncherContext";
import styles from "./styles/LauncherControls.module.css";

type LauncherDotsProps = {
  status: LauncherStatus;
  robotAlive: boolean;
};

export function LauncherDots({ status, robotAlive }: LauncherDotsProps) {
  const [activeIndex, setActiveIndex] = useState(0);

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

  if (status === "running" && !robotAlive) {
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
