import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorEntry } from "../../../services/EditorRegistry";
import { FloatingPanelContext } from "./FloatingPanelContext";
import {
  FloatingPanelRecord,
  getFloatingPanels,
  removeFloatingPanel,
  spawnFloatingPanel,
  subscribeFloatingPanels,
  updateFloatingPanel,
  clearFloatingPanels,
} from "./floating-panel-store";
import styles from "../PanelLayout.module.css";
import { PanelInstanceProvider } from "../PanelInstanceContext";
import { PanelContextMenu } from "../PanelContextMenu";
import type { PanelContextMenuState } from "../PanelContextMenu";
import { PanelErrorBoundary } from "../PanelErrorBoundary";
import { getDocumentBody } from "../../../utils/domEnvironment";
import { GenericPanel } from "../../dialog/GenericPanel";

type FloatingPanelLayerProps = {
  scope: string;
  editorEntries: EditorEntry[];
};

/**
 * Render and manage a set of floating panels for a given workspace scope.
 *
 * Subscribes to floating panel updates for `scope`, maintains local panel state,
 * handles panel duplication, assignment, closing and layout reset, and renders
 * each panel plus a context menu via a portal into the document body.
 *
 * @param scope - The workspace or scope identifier used to read and mutate floating panels
 * @param editorEntries - Available editor entries (id/label/component) used to populate panels and the editor selector
 * @returns A portal containing floating panel windows and an optional panel context menu, or `null` when there are no panels or the document body is unavailable
 */
export function FloatingPanelLayer({
  scope,
  editorEntries,
}: FloatingPanelLayerProps) {
  const [panels, setPanels] = useState<FloatingPanelRecord[]>(() =>
    getFloatingPanels(scope)
  );
  const [contextMenu, setContextMenu] = useState<PanelContextMenuState | null>(
    null
  );
  const [refreshByPanelId, setRefreshByPanelId] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    return subscribeFloatingPanels(scope, (next) => setPanels(next));
  }, [scope]);

  useEffect(() => {
    if (contextMenu && !panels.some((p) => p.id === contextMenu.panelId)) {
      setContextMenu(null);
    }
  }, [contextMenu, panels]);

  const editorOptions = useMemo(
    () =>
      editorEntries
        .map((item) => ({
          id: item.id,
          label: item.label,
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [editorEntries]
  );

  if (panels.length === 0) {
    return null;
  }
  const body = getDocumentBody();
  if (!body) {
    return null;
  }

  const duplicatePanel = (panelId: string) => {
    const source = panels.find((panel) => panel.id === panelId);
    if (!source) return;
    spawnFloatingPanel(scope, {
      editorId: source.editorId,
      title: source.title,
      settings: { ...source.settings },
    });
  };

  const handleAssign = (panelId: string, editorId: string) => {
    updateFloatingPanel(scope, panelId, { editorId });
  };

  const handleClose = (panelId: string) => {
    removeFloatingPanel(scope, panelId);
  };

  const handleReset = () => {
    clearFloatingPanels(scope);
  };

  const handleContextMenuOpen = (
    panelId: string,
    editorId: string,
    event: ContextMenuTriggerEvent
  ) => {
    event.preventDefault();
    setContextMenu({
      panelId,
      editorId,
      x: event.clientX,
      y: event.clientY,
      horizontalRatio: 0.5,
      verticalRatio: 0.5,
    });
  };

  return createPortal(
    <>
      {panels.map((panel) => (
        <FloatingPanelWindow
          key={panel.id}
          scope={scope}
          panel={panel}
          refreshVersion={refreshByPanelId[panel.id] ?? 0}
          editorEntries={editorEntries}
          editorOptions={editorOptions}
          onContextMenu={handleContextMenuOpen}
        />
      ))}
      {contextMenu && (
        <PanelContextMenu
          state={contextMenu}
          editorOptions={editorOptions}
          canClose
          isMaximized={false}
          onSplit={(panelId) => duplicatePanel(panelId)}
          onAssign={(editorId) => handleAssign(contextMenu.panelId, editorId)}
          onRefreshPanel={() =>
            setRefreshByPanelId((prev) => ({
              ...prev,
              [contextMenu.panelId]: (prev[contextMenu.panelId] ?? 0) + 1,
            }))
          }
          onToggleMaximize={() => {}}
          onClosePanel={() => handleClose(contextMenu.panelId)}
          onResetLayout={handleReset}
          onClose={() => setContextMenu(null)}
          onCreateFloatingPanel={(editorId) =>
            duplicatePanel(contextMenu.panelId)
          }
          showMaximize={false}
          showReset={false}
          showCreateFloating={false}
        />
      )}
    </>,
    body
  );
}

type ContextMenuTriggerEvent = {
  preventDefault: () => void;
  clientX: number;
  clientY: number;
};

type FloatingPanelWindowProps = {
  scope: string;
  panel: FloatingPanelRecord;
  refreshVersion: number;
  editorEntries: EditorEntry[];
  editorOptions: { id: string; label: string }[];
  onContextMenu: (
    panelId: string,
    editorId: string,
    event: ContextMenuTriggerEvent
  ) => void;
};

/**
 * Renders a single floating panel window with its editor content, panel context, and editor-selection UI.
 *
 * Provides the panel's context (title, settings, setters, and close) to descendants and invokes `onContextMenu`
 * when the user opens the panel context menu via mouse or keyboard.
 *
 * @param scope - Workspace identifier that owns this panel
 * @param panel - The floating panel record (id, title, editorId, settings, position/size, etc.)
 * @param editorEntries - Available editor entries; the entry matching `panel.editorId` is used (falls back to the first)
 * @param editorOptions - Lightweight list of editor ids and labels used to populate the editor selector overlay
 * @param onContextMenu - Called to open the panel's context menu; receives the panel id, current editor id, and an event-like object with `preventDefault`, `clientX`, and `clientY`
 * @returns A React element representing the floating panel window, its content, and associated controls
 */
function FloatingPanelWindow({
  scope,
  panel,
  refreshVersion,
  editorEntries,
  editorOptions,
  onContextMenu,
}: FloatingPanelWindowProps) {
  const entry =
    editorEntries.find((candidate) => candidate.id === panel.editorId) ??
    editorEntries[0];
  const title = panel.title ?? entry.label;
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const Component = entry.Component;
  const handleEditorChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    updateFloatingPanel(scope, panel.id, { editorId: event.target.value });
    setSelectorOpen(false);
  };
  const closeSelector = () => setSelectorOpen(false);

  return (
    <PanelInstanceProvider panelId={panel.id} workspaceId={scope}>
      <FloatingPanelContext.Provider
        value={{
          scope,
          id: panel.id,
          title: panel.title,
          settings: panel.settings,
          setTitle: (nextTitle) =>
            updateFloatingPanel(scope, panel.id, { title: nextTitle }),
          setSettings: (settings) =>
            updateFloatingPanel(scope, panel.id, { settings }),
          updateSettings: (partial) =>
            updateFloatingPanel(scope, panel.id, {
              settings: { ...panel.settings, ...partial },
            }),
          close: () => removeFloatingPanel(scope, panel.id),
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onContextMenu={(event) => onContextMenu(panel.id, entry.id, event)}
          onKeyDown={(event) => {
            const isContextMenuKey =
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10");
            const isActivationKey =
              event.key === "Enter" ||
              event.key === " " ||
              event.key === "Space";
            if (!isContextMenuKey && !isActivationKey) {
              return;
            }
            event.preventDefault();
            const target = event.currentTarget as HTMLElement | null;
            const rect = target?.getBoundingClientRect();
            const clientX =
              rect && Number.isFinite(rect.left)
                ? rect.left + rect.width / 2
                : 0;
            const clientY =
              rect && Number.isFinite(rect.top)
                ? rect.top + rect.height / 2
                : 0;
            onContextMenu(panel.id, entry.id, {
              preventDefault: () => event.preventDefault(),
              clientX,
              clientY,
            });
          }}
        >
          <PanelErrorBoundary
            editorId={entry.id}
            onRetry={() => setSelectorOpen(false)}
          >
            <GenericPanel
              title={title}
              onClose={() => removeFloatingPanel(scope, panel.id)}
              storageKey={`floating-panel:${scope}:${panel.id}`}
              initialPosition={panel.initialPosition}
              initialSize={panel.initialSize}
              minSize={panel.minSize}
            >
              <div className={styles.floatingContent}>
                <div className={styles.panelBody}>
                  <React.Suspense
                    fallback={
                      <div className={styles.panelLoading}>Loading…</div>
                    }
                  >
                    <React.Fragment key={`${panel.id}:${refreshVersion}`}>
                      <Component />
                    </React.Fragment>
                  </React.Suspense>
                </div>
                {editorOptions.length > 1 && (
                  <div className={styles.panelOverlay}>
                    {selectorOpen ? (
                      <select
                        ref={selectRef}
                        className={styles.panelSelector}
                        value={entry.id}
                        onChange={handleEditorChange}
                        onBlur={closeSelector}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.stopPropagation();
                            closeSelector();
                            selectRef.current?.blur();
                          }
                        }}
                      >
                        {editorOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        className={styles.panelSelectorButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectorOpen(true);
                          requestAnimationFrame(() =>
                            selectRef.current?.focus()
                          );
                        }}
                        aria-label="Open editor selector"
                        title="Switch editor"
                      >
                        ▾
                      </button>
                    )}
                  </div>
                )}
              </div>
            </GenericPanel>
          </PanelErrorBoundary>
        </div>
      </FloatingPanelContext.Provider>
    </PanelInstanceProvider>
  );
}
