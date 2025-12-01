import React, { useEffect, useState } from "react";
import styles from "./styles/WindowControls.module.css";

type WindowControlsAPI = Window["robotick"] extends { windowControls?: infer T }
  ? NonNullable<T>
  : never;

function getWindowControlsAPI(): WindowControlsAPI | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.robotick?.windowControls;
}

export function WindowControls() {
  const api = getWindowControlsAPI();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!api?.onStateChange) return;
    const unsubscribe = api.onStateChange((state) =>
      setIsMaximized(Boolean(state?.isMaximized))
    );
    return () => {
      unsubscribe?.();
    };
  }, [api]);

  if (!api) {
    return null;
  }

  return (
    <div
      className={styles.windowControls}
      data-app-region="no-drag"
      data-testid="window-controls"
    >
      <button
        type="button"
        className={styles.button}
        aria-label="Minimize"
        onClick={() => api.minimize()}
      >
        <span className={styles.iconMinimize} />
      </button>
      <button
        type="button"
        className={styles.button}
        aria-label={isMaximized ? "Restore" : "Maximize"}
        onClick={() => api.toggleMaximize()}
      >
        <span
          className={isMaximized ? styles.iconRestore : styles.iconMaximize}
        />
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.buttonClose}`}
        aria-label="Close"
        onClick={() => api.close()}
      >
        <span className={styles.iconClose} />
      </button>
    </div>
  );
}
