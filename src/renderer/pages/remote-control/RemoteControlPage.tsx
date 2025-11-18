// src/renderer/pages/remote-control/RemoteControlPage.tsx

import React, { useEffect, useMemo, useState } from "react";
import viewer from "../../components/viewer/viewer";
import { RcSubtitlesOverlay } from "./components/RcSubtitlesOverlay";
import { RcTelemetryOverlay } from "./components/RcTelemetryOverlay";
import RemoteControlsPanel from "./components/RemoteControlsPanel";
import { useProjectContext } from "../../core/ProjectContext";
import { HUB_API_BASE } from "../../core/config";
import { buildUrl, fetchJSON } from "../../core/http";
import styles from "./styles/RemoteControlPage.module.css";

type RcModuleDescriptor = {
  type: string;
  config?: Record<string, unknown>;
};

type RcSettingsResponse = {
  modules?: unknown;
  viewer?: Record<string, unknown>;
};

export default function RemoteControlPage() {
  const { projectPath } = useProjectContext();
  const [modules, setModules] = useState<RcModuleDescriptor[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setModules([]);
      return;
    }
    const abortController = new AbortController();

    async function loadSettings() {
      try {
        const config = await fetchRCSettings(projectPath, abortController.signal);
        if (!abortController.signal.aborted) {
          setModules(normalizeModules(config));
          setError(null);
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        console.warn("Failed to load RC settings:", err);
        setModules([]);
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    loadSettings();
    return () => {
      abortController.abort();
    };
  }, [projectPath]);

  useEffect(() => {
    const viewerModule = modules.find((mod) => mod.type.startsWith("viewer/"));
    if (!viewerModule) {
      void viewer.uninit();
      return;
    }

    const viewerType = viewerModule.type.split("/").pop();
    if (!viewerType) {
      console.warn("Viewer module missing type suffix", viewerModule.type);
      return;
    }

    try {
      viewer.init({ ...(viewerModule.config ?? {}), viewerType });
    } catch (err) {
      console.warn("Viewer init failed:", err);
    }

    return () => {
      void viewer.uninit();
    };
  }, [modules]);

  const subtitlesModule = useMemo(
    () => modules.find((mod) => mod.type === "overlay/subtitles"),
    [modules]
  );
  const telemetryModule = useMemo(
    () => modules.find((mod) => mod.type === "overlay/telemetry"),
    [modules]
  );

  if (!projectPath) {
    return (
      <div className={styles.rcUi}>
        <p style={{ padding: "1rem" }}>Select a project to begin.</p>
      </div>
    );
  }

  return (
    <div id="rc-ui" className={styles.rcUi}>
      <div id="viewer-container" className={styles.viewerContainer} />
      <RemoteControlsPanel />
      {subtitlesModule ? (
        <RcSubtitlesOverlay config={subtitlesModule.config} />
      ) : null}
      {telemetryModule ? (
        <RcTelemetryOverlay config={telemetryModule.config} />
      ) : null}
      {error ? (
        <div style={{ position: "absolute", top: 16, left: 16, color: "#ff6b6b" }}>
          Failed to load RC modules: {error}
        </div>
      ) : null}
    </div>
  );
}

function normalizeModules(settings: RcSettingsResponse | null): RcModuleDescriptor[] {
  if (!settings) return [];
  const modules: RcModuleDescriptor[] = [];

  const rawModules = Array.isArray(settings.modules) ? settings.modules : [];
  for (const raw of rawModules) {
    if (!raw || typeof raw !== "object") continue;
    const type = String((raw as { type?: unknown }).type ?? "").trim();
    if (!type) continue;
    const config = (raw as { config?: Record<string, unknown> }).config;
    modules.push({ type, config });
  }

  return modules;
}

async function fetchRCSettings(projectPath: string, signal: AbortSignal) {
  const url = buildUrl(HUB_API_BASE, "/query/get-project-rc-settings", {
    project_path: projectPath,
  });
  return await fetchJSON<RcSettingsResponse>(url, { signal });
}
