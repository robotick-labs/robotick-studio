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

type FloatingPanelLayerProps = {
  scope: string;
  editorEntries: EditorEntry[];
};

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
      editorEntries.map((item) => ({
        id: item.id,
        label: item.label,
      })),
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
    event: React.MouseEvent
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

type FloatingPanelWindowProps = {
  scope: string;
  panel: FloatingPanelRecord;
  editorEntries: EditorEntry[];
  editorOptions: { id: string; label: string }[];
  onContextMenu: (
    panelId: string,
    editorId: string,
    event: React.MouseEvent<HTMLDivElement>
  ) => void;
};

function FloatingPanelWindow({
  scope,
  panel,
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
          onContextMenu={(event) => onContextMenu(panel.id, entry.id, event)}
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
                <PanelErrorBoundary
                  editorId={entry.id}
                  onRetry={() => setSelectorOpen(false)}
                >
                  <React.Suspense
                    fallback={
                      <div className={styles.panelLoading}>Loading…</div>
                    }
                  >
                    <Component />
                  </React.Suspense>
                </PanelErrorBoundary>
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
                        requestAnimationFrame(() => selectRef.current?.focus());
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
        </div>
      </FloatingPanelContext.Provider>
    </PanelInstanceProvider>
  );
}
