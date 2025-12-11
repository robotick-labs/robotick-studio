import React from "react";
import { GenericDialog } from "../dialog/GenericDialog";
import {
  addWindowEventListener,
  getViewportSize,
} from "../../utils/domEnvironment";
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

/**
 * Renders a contextual menu for panel operations (split, assign tool, maximize, close, reset, create floating).
 *
 * The menu positions itself near the provided coordinates, constrains to the viewport, shows an "Assign Tool"
 * hover submenu aligned to the menu, and presents a confirmation dialog before resetting layout.
 *
 * @param state - Active panel/editor context including `panelId`, `editorId`, `x`, `y`, `horizontalRatio`, and `verticalRatio`
 * @param editorOptions - Array of assignable editor options with `{ id, label }`; used to populate the Assign Tool submenu
 * @param canClose - Whether the current panel can be closed; disables the Close Panel action when false
 * @param isMaximized - Current maximize state; controls the Maximize/Restore menu label
 * @param onSplit - Callback invoked to split the panel: `(panelId, direction, ratio) => void`
 * @param onAssign - Callback invoked to assign a tool: `(editorId) => void`
 * @param onToggleMaximize - Callback to toggle panel maximize state
 * @param onClosePanel - Callback to close the current panel
 * @param onResetLayout - Callback to reset the workspace layout (invoked after confirming reset)
 * @param onClose - Callback to close the context menu
 * @param onCreateFloatingPanel - Callback to create a floating panel; receives optional `editorId`
 * @param showSplit - Whether split actions are shown (default `true`)
 * @param showMaximize - Whether maximize/restore action is shown (default `true`)
 * @param showReset - Whether the Reset Layout action is shown (default `true`)
 * @param showCreateFloating - Whether the Create Floating Panel action is shown (default `true`)
 * @returns The rendered context menu React element
 */
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
  const [confirmResetOpen, setConfirmResetOpen] = React.useState(false);

  React.useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      setPlacement({ left: state.x, top: state.y });
      return;
    }
    const { offsetWidth: width, offsetHeight: height } = menu;
    const buffer = 8;
    const viewport = getViewportSize();
    const maxX = viewport.width - width - buffer;
    const maxY = viewport.height - height - buffer;
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
    const removeClick = addWindowEventListener("click", close);
    const removeKey = addWindowEventListener("keydown", handleKey);
    return () => {
      removeClick();
      removeKey();
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
                setConfirmResetOpen(true);
              }}
            >
              Reset Layout
            </button>
          </>
        )}
      </div>
      {confirmResetOpen && (
        <div onClick={(event) => event.stopPropagation()}>
          <GenericDialog
            title="Reset layout?"
            message="This will restore the default workspace layout. Any custom panel arrangement will be lost."
            onClose={() => setConfirmResetOpen(false)}
            actions={[
              { label: "Cancel", onClick: () => setConfirmResetOpen(false) },
              {
                label: "Reset layout",
                variant: "primary",
                onClick: () => {
                  onResetLayout();
                  setConfirmResetOpen(false);
                  onClose();
                },
              },
            ]}
          />
        </div>
      )}
    </>
  );
}