import React, { useEffect, useState } from "react";
import { LauncherStatus } from "../../core/launcher-context";
import styles from "./LauncherControls.module.css";

type LauncherDotsProps = {
  status: LauncherStatus;
};

export function LauncherDots({ status }: LauncherDotsProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [status]);

  useEffect(() => {
    if (status !== "starting") return;
    const id = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % 3);
    }, 500);
    return () => {
      window.clearInterval(id);
    };
  }, [status]);

  return (
    <span className={styles.controlDots} aria-hidden>
      <span className={styles.dots}>
        {[0, 1, 2].map((index) => {
          const dotClasses = [styles.dot];

          if (status === "starting" && index === activeIndex) {
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
