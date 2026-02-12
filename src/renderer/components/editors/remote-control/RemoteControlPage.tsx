// src/renderer/components/editors/remote-control/RemoteControlPage.tsx

import React, { useEffect, useMemo } from "react";
import viewer from "../../viewer/viewer";
import { RcSubtitlesOverlay } from "./components/RcSubtitlesOverlay";
import RemoteControlsPanel from "./components/remote-controls/RemoteControlsPanel";
import { Project, ProjectData, Launcher } from "../../../data-sources/launcher";
import type { RcModuleDescriptor } from "../../../data-sources/launcher";
import styles from "./styles/RemoteControlPage.module.css";

export default function RemoteControlPage() {
  const { projectPath } = Project.Context.use();
  const { rcModules } = ProjectData.use();
  const { status } = Launcher.Context.use();
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
    const { module: viewerModule, key: viewerKey } = viewerSelection;
    if (status !== "running") {
      viewerInstanceId.current = null;
      void viewer.uninit(undefined, `launcher status ${status}`);
      return;
    }
    if (!viewerModule) {
      viewerInstanceId.current = null;
      void viewer.uninit(undefined, "no viewer module configured");
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
  }, [projectPath, status, viewerSelection.key]);

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
        <RemoteControlsPanel config={controlsModule.config} />
      ) : null}
      {subtitlesModule ? (
        <RcSubtitlesOverlay config={subtitlesModule.config} />
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
