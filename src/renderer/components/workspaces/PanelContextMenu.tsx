import React from "react";
import styles from "./PanelLayout.module.css";

export type PanelContextMenuState = {
  panelId: string;
  editorId: string;
  x: number;
  y: number;
  horizontalRatio: number;
  verticalRatio: number;
};

export type PanelContextMenuProps = {
  state: PanelContextMenuState;
  editorOptions: { id: string; label: string }[];
  canClose: boolean;
  isMaximized: boolean;
  onSplit: (
    panelId: string,
    direction: "horizontal" | "vertical",
    ratio: number
  ) => void;
  onAssign: (editorId: string) => void;
  onToggleMaximize: () => void;
  onClosePanel: () => void;
  onResetLayout: () => void;
  onClose: () => void;
  onCreateFloatingPanel: (editorId?: string) => void;
  showSplit?: boolean;
  showMaximize?: boolean;
  showReset?: boolean;
  showCreateFloating?: boolean;
};

export function PanelContextMenu({
  state,
  editorOptions,
  canClose,
  isMaximized,
  onSplit,
  onAssign,
  onToggleMaximize,
  onClosePanel,
  onResetLayout,
  onClose,
  onCreateFloatingPanel,
  showSplit = true,
  showMaximize = true,
  showReset = true,
  showCreateFloating = true,
}: PanelContextMenuProps) {
  const [assignActive, setAssignActive] = React.useState(false);
  const [assignPlacement, setAssignPlacement] = React.useState({
    left: 0,
    top: 0,
  });
  const [placement, setPlacement] = React.useState({
    left: state.x,
    top: state.y,
  });
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const assignButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      setPlacement({ left: state.x, top: state.y });
      return;
    }
    const { offsetWidth: width, offsetHeight: height } = menu;
    const buffer = 8;
    const maxX = window.innerWidth - width - buffer;
    const maxY = window.innerHeight - height - buffer;
    const safeX = Math.max(buffer, Math.min(state.x, Math.max(buffer, maxX)));
    const safeY = Math.max(buffer, Math.min(state.y, Math.max(buffer, maxY)));
    setPlacement({ left: safeX, top: safeY });
  }, [state.x, state.y]);

  const updateAssignPlacement = React.useCallback(() => {
    const button = assignButtonRef.current;
    const menuEl = menuRef.current;
    if (!button || !menuEl) return;
    setAssignPlacement({
      left: menuEl.offsetWidth,
      top: button.offsetTop,
    });
  }, [placement.left, placement.top, placement]);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setAssignActive(false);
      closeTimer.current = null;
    }, 150);
  }, [cancelClose]);

  React.useEffect(() => {
    const close = () => onClose();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", handleKey);
      cancelClose();
    };
  }, [onClose, cancelClose]);

  return (
    <>
      <div
        className={styles.contextMenu}
        ref={menuRef}
        style={{ left: placement.left, top: placement.top }}
        role="menu"
        onClick={(event) => event.stopPropagation()}
      >
        {showSplit && (
          <>
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                onSplit(state.panelId, "vertical", state.verticalRatio);
                onClose();
              }}
            >
              Split Horizontally
            </button>
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                onSplit(state.panelId, "horizontal", state.horizontalRatio);
                onClose();
              }}
            >
              Split Vertically
            </button>
            <div className={styles.contextMenuDivider} />
          </>
        )}

        {showCreateFloating && (
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              onCreateFloatingPanel(state.editorId);
              onClose();
            }}
          >
            Create Floating Panel
          </button>
        )}

        <div className={styles.contextMenuDivider} />

        <button
          type="button"
          className={styles.contextMenuItem}
          aria-expanded={assignActive}
          aria-haspopup="menu"
          data-testid="context-menu-heading-button"
          ref={assignButtonRef}
          onMouseEnter={() => {
            cancelClose();
            setAssignActive(true);
            updateAssignPlacement();
          }}
          onMouseLeave={scheduleClose}
      >
        <span className={styles.contextMenuHeadingLabel}>Assign Tool</span>
        <span className={styles.contextMenuShortcut} aria-hidden="true" />
        <span aria-hidden="true" className={styles.contextMenuHeadingIcon}>
          ▸
        </span>
      </button>
        {assignActive && (
          <div
            className={styles.contextSubmenu}
            role="menu"
            data-testid="context-menu-submenu"
            style={{ left: assignPlacement.left, top: assignPlacement.top }}
            onMouseEnter={() => {
              cancelClose();
              setAssignActive(true);
            }}
            onMouseLeave={scheduleClose}
          >
            {editorOptions.map((option) => (
              <button
                key={option.id}
                className={styles.contextMenuItem}
                onClick={() => {
                  onAssign(option.id);
                  onClose();
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <div className={styles.contextMenuDivider} />

        {showMaximize && (
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              onToggleMaximize();
              onClose();
            }}
          >
            {isMaximized ? "Restore Panel Size" : "Maximize Panel"}
          </button>
        )}

        <button
          className={styles.contextMenuItem}
          disabled={!canClose}
          onClick={() => {
            onClosePanel();
            onClose();
          }}
        >
          Close Panel
        </button>

        {showReset && (
          <>
            <div className={styles.contextMenuDivider} />
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                onResetLayout();
                onClose();
              }}
            >
              Reset Layout
            </button>
          </>
        )}
      </div>
    </>
  );
}
