import React, { useEffect, useMemo } from "react";
import { RcSubtitlesOverlay } from "./components/RcSubtitlesOverlay";
import type { RcSubtitlesPersistedState } from "./components/RcSubtitlesOverlay";
import RemoteControlsPanel from "./components/remote-controls/RemoteControlsPanel";
import type { SelectedModesState } from "./components/remote-controls/RemoteControlsPanel";
import {
  Launcher,
  Project,
  ProjectData,
  definePanelPersistence,
  defineStudioPanel,
  usePanelSettings,
  usePanelInstance,
  viewer,
} from "./studio-host";
import type { RcModuleDescriptor } from "./studio-host";
import styles from "./styles/RemoteControlPage.module.css";

type RemoteControlPanelSettings = {
  selectedStream?: string;
  selectedModes?: SelectedModesState;
  subtitles?: RcSubtitlesPersistedState;
};

export const remoteControlPagePersistence =
  definePanelPersistence<RemoteControlPanelSettings>({
    schemaVersion: 1,
    defaults: {},
    sanitize(value) {
      const input =
        value && typeof value === "object"
          ? (value as RemoteControlPanelSettings)
          : {};
      const selectedModes =
        input.selectedModes && typeof input.selectedModes === "object"
          ? Object.fromEntries(
              Object.entries(input.selectedModes).filter(
                ([, modeId]) => typeof modeId === "string",
              ),
            )
          : undefined;
      const positionNormInput =
        input.subtitles?.positionNorm &&
        typeof input.subtitles.positionNorm === "object"
          ? input.subtitles.positionNorm
          : undefined;
      const positionNorm =
        typeof positionNormInput?.x === "number" &&
        typeof positionNormInput?.y === "number"
          ? {
              x: Math.min(1, Math.max(0, positionNormInput.x)),
              y: Math.min(1, Math.max(0, positionNormInput.y)),
            }
          : undefined;
      const subtitles =
        input.subtitles && typeof input.subtitles === "object"
          ? {
              positionNorm,
              collapsed:
                typeof input.subtitles.collapsed === "boolean"
                  ? input.subtitles.collapsed
                  : undefined,
            }
          : undefined;
      return {
        selectedStream:
          typeof input.selectedStream === "string"
            ? input.selectedStream
            : undefined,
        selectedModes,
        subtitles,
      };
    },
  });

export function RemoteControlPage() {
  const { projectPath } = Project.Context.use();
  const { rcModules } = ProjectData.use();
  const { status } = Launcher.Context.use();
  const panelInstance = usePanelInstance();
  const [settings, updateSettings] = usePanelSettings(remoteControlPagePersistence);
  const modules = rcModules.data;

  const viewerSelectionCache = React.useRef<{
    key: string;
    module: RcModuleDescriptor | null;
  }>({ key: "none", module: null });

  const viewerSelection = React.useMemo(() => {
    const module =
      modules.find((mod) => mod.type.startsWith("viewer/")) ?? null;
    const serializedConfig = module ? JSON.stringify(module.config ?? {}) : "";
    const key = module ? `${module.type}:${serializedConfig}` : "none";
    if (viewerSelectionCache.current.key === key) {
      return viewerSelectionCache.current;
    }
    const next = { key, module };
    viewerSelectionCache.current = next;
    return next;
  }, [modules]);

  const viewerContainerRef = React.useRef<HTMLDivElement | null>(null);
  const viewerInstanceId = React.useRef<number | null>(null);

  useEffect(() => {
    const disposeCurrentViewer = (reason: string) => {
      if (viewerInstanceId.current == null) {
        return;
      }
      void viewer.uninit(viewerInstanceId.current, reason);
      viewerInstanceId.current = null;
    };
    const { module: viewerModule, key: viewerKey } = viewerSelection;
    if (status !== "running") {
      disposeCurrentViewer(`launcher status ${status}`);
      return;
    }
    if (!viewerModule) {
      disposeCurrentViewer("no viewer module configured");
      return;
    }

    const viewerType = viewerModule.type.split("/").pop();
    if (!viewerType) {
      console.warn("Viewer module missing type suffix", viewerModule.type);
      return;
    }

    let active = true;
    const initialize = async () => {
      try {
        const id = await viewer.init({
          ...(viewerModule.config ?? {}),
          viewerType,
          projectPath,
          workbenchId: panelInstance.workbenchId,
          panelId: panelInstance.panelId,
          selectedStream: settings.selectedStream,
          onSelectedStreamChange: (selectedStream: string) =>
            updateSettings({ selectedStream }),
          container: viewerContainerRef.current ?? undefined,
        });
        if (!active) {
          if (id != null) {
            void viewer.uninit(
              id,
              "remote control viewer effect cleanup (superseded)"
            );
          }
          return;
        }
        viewerInstanceId.current = id;
      } catch (err) {
        console.warn("Viewer init failed:", err);
      }
    };

    void initialize();

    return () => {
      active = false;
      if (viewerInstanceId.current != null) {
        void viewer.uninit(
          viewerInstanceId.current,
          "remote control viewer effect cleanup"
        );
        viewerInstanceId.current = null;
      }
    };
  }, [
    panelInstance.panelId,
    panelInstance.workbenchId,
    projectPath,
    settings.selectedStream,
    status,
    updateSettings,
    viewerSelection.key,
  ]);

  const subtitlesModule = useMemo(
    () => modules.find((mod) => mod.type === "overlay/subtitles"),
    [modules]
  );
  const controlsModule = useMemo(
    () => modules.find((mod) => mod.type === "overlay/remote-controls"),
    [modules]
  );

  if (!projectPath) {
    return (
      <div className={styles.rcUi}>
        <p style={{ padding: "1rem" }}>Select a project to begin.</p>
      </div>
    );
  }

  if (status !== "running") {
    return (
      <div className={styles.rcUi}>
        <p style={{ padding: "1rem", textAlign: "center" }}>
          Launch your robot to enable remote control.
        </p>
      </div>
    );
  }

  if (rcModules.loading && modules.length === 0) {
    return (
      <div className={styles.rcUi}>
        <p style={{ padding: "1rem" }}>Loading remote control modules…</p>
      </div>
    );
  }

  return (
    <div id="rc-ui" className={styles.rcUi}>
      <div ref={viewerContainerRef} className={styles.viewerContainer} />
      {controlsModule ? (
        <RemoteControlsPanel
          config={controlsModule.config}
          selectedModes={settings.selectedModes}
          onSelectedModesChange={(selectedModes) =>
            updateSettings({ selectedModes })
          }
        />
      ) : null}
      {subtitlesModule ? (
        <RcSubtitlesOverlay
          config={subtitlesModule.config}
          persistedState={settings.subtitles}
          onPersistedStateChange={(subtitles) => updateSettings({ subtitles })}
        />
      ) : null}
      {rcModules.error ? (
        <div
          style={{ position: "absolute", top: 16, left: 16, color: "#ff6b6b" }}
        >
          Failed to load RC modules: {rcModules.error}
        </div>
      ) : null}
    </div>
  );
}

export const contribution = defineStudioPanel({
  component: RemoteControlPage,
  persistence: remoteControlPagePersistence,
});

export default contribution;
