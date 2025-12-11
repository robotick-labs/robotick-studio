import React, { useEffect, useState } from "react";
import { getWindow } from "../../utils/domEnvironment";
import type { RobotickWindowControls } from "../../types/robotick-globals";
import styles from "./styles/WindowControls.module.css";

export type WindowControlsAPI = RobotickWindowControls;

type WindowControlsProps = React.HTMLAttributes<HTMLDivElement>;

export function getWindowControlsAPI(): WindowControlsAPI | undefined {
  const win = getWindow();
  return win?.robotick?.windowControls;
}

export function WindowControls(props: WindowControlsProps = {}) {
  const [api, setApi] = useState<WindowControlsAPI | undefined>(() =>
    getWindowControlsAPI(),
  );
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (api) return;
    setApi(getWindowControlsAPI());
  }, [api]);

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
      {...props}
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
