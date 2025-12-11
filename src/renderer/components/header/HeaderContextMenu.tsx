import React from "react";
import styles from "../workspaces/PanelLayout.module.css";
import { getWindowControlsAPI } from "./WindowControls";
import {
  addWindowEventListener,
  getViewportSize,
} from "../../utils/domEnvironment";

type HeaderContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
};

/**
 * Render a context menu that provides window control actions positioned near the given coordinates.
 *
 * @param x - Initial horizontal position (pixels) where the menu should appear
 * @param y - Initial vertical position (pixels) where the menu should appear
 * @param onClose - Callback invoked when the menu should be closed (e.g., on click outside, Escape, or after action)
 * @returns The context menu element positioned within the viewport, or `null` if the window controls API is unavailable
 */
export function HeaderContextMenu({ x, y, onClose }: HeaderContextMenuProps) {
  const api = getWindowControlsAPI();
  const [isMaximized, setIsMaximized] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = React.useState({ left: x, top: y });

  React.useEffect(() => {
    if (!api) {
      onClose();
      return;
    }
    if (!api.onStateChange) {
      return;
    }
    const unsubscribe = api.onStateChange((state) =>
      setIsMaximized(Boolean(state?.isMaximized))
    );
    return () => {
      unsubscribe?.();
    };
  }, [api, onClose]);

  React.useEffect(() => {
    const close = () => onClose();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const removeClick = addWindowEventListener("click", close);
    const removeKey = addWindowEventListener("keydown", handleKey);
    return () => {
      removeClick();
      removeKey();
    };
  }, [onClose]);

  React.useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      setPlacement({ left: x, top: y });
      return;
    }
    const { offsetWidth: width, offsetHeight: height } = menu;
    const buffer = 8;
    const viewport = getViewportSize();
    const maxX = viewport.width - width - buffer;
    const maxY = viewport.height - height - buffer;
    const safeX = Math.max(buffer, Math.min(x, Math.max(buffer, maxX)));
    const safeY = Math.max(buffer, Math.min(y, Math.max(buffer, maxY)));
    setPlacement({ left: safeX, top: safeY });
  }, [x, y]);

  if (!api) {
    return null;
  }

  return (
    <div
      className={styles.contextMenu}
      ref={menuRef}
      style={{ left: placement.left, top: placement.top }}
      role="menu"
    >
      <button
        className={styles.contextMenuItem}
        onClick={() => {
          api.minimize();
          onClose();
        }}
      >
        Minimize Window
      </button>
      <button
        className={styles.contextMenuItem}
        onClick={() => {
          api.toggleMaximize();
          onClose();
        }}
      >
        {isMaximized ? "Restore Window" : "Maximize Window"}
      </button>
      <div className={styles.contextMenuDivider} />
      <button
        className={styles.contextMenuItem}
        onClick={() => {
          api.close();
          onClose();
        }}
      >
        Close Window
      </button>
    </div>
  );
}