import React, { useEffect, useState } from "react";
import { getWindow } from "../../utils/domEnvironment";
import type { RobotickWindowControls } from "../../types/robotick-globals";
import styles from "./styles/WindowControls.module.css";

export type WindowControlsAPI = RobotickWindowControls;

type WindowControlsProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Retrieve the Robotick window controls bridge API from the global window object.
 *
 * @returns `WindowControlsAPI` if exposed at `window.robotick.windowControls`, `undefined` otherwise.
 */
export function getWindowControlsAPI(): WindowControlsAPI | undefined {
  const win = getWindow();
  return win?.robotick?.windowControls;
}

/**
 * Render window control buttons (minimize, maximize/restore, close) that use the renderer bridge API.
 *
 * The component waits for the bridge API to become available (SSR-safe) and subscribes to window state
 * changes to reflect the maximized/restored state of the window.
 *
 * @returns A JSX element containing the window control buttons, or `null` if the window controls API is not available.
 */
export function WindowControls(props: WindowControlsProps = {}) {
  // Lazily resolve the window controls API so SSR renders without touching
  // `window`, then re-check on the client after hydration in case the bridge
  // becomes available later.
  const [api, setApi] = useState<WindowControlsAPI | undefined>(() =>
    getWindowControlsAPI()
  );
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (api) return;
    const win = getWindow();
    if (!win) {
      return;
    }
    let cancelled = false;
    const attemptResolve = () => {
      if (cancelled) {
        return true;
      }
      const next = getWindowControlsAPI();
      if (next) {
        setApi(next);
        return true;
      }
      return false;
    };
    if (attemptResolve()) {
      return () => {
        cancelled = true;
      };
    }
    const interval = win.setInterval(() => {
      if (attemptResolve() && typeof interval === "number") {
        win.clearInterval(interval);
      }
    }, 100);
    return () => {
      cancelled = true;
      if (typeof interval === "number") {
        win.clearInterval(interval);
      }
    };
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

  const handleClose = () => {
    api.close();
  };

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
        onClick={handleClose}
      >
        <span className={styles.iconClose} />
      </button>
    </div>
  );
}
