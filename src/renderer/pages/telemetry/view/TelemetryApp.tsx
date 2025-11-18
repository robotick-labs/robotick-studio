// src/js/pages/telemetry/view/TelemetryApp.tsx
import React, { useMemo } from "react";
import { EngineModel } from "./types";
import { TelemetryModel } from "./TelemetryModel";
import { useProjectContext } from "../../../core/launcher/ProjectContext";
import { useLauncherData } from "../../../core/launcher/LauncherDataContext";
import { useLauncherContext } from "../../../core/launcher/LauncherContext";
import styles from "../Telemetry.module.css";

export function TelemetryApp() {
  const { projectPath } = useProjectContext();
  const { status } = useLauncherContext();
  const { projectModels } = useLauncherData();

  const engineModels = useMemo<EngineModel[]>(() => {
    const extractPort = (url?: string): number => {
      if (!url) return 0;
      try {
        const parsed = new URL(url);
        return parseInt(parsed.port || "0", 10);
      } catch {
        return 0;
      }
    };

    return [...projectModels.data]
      .map((model) => ({
        modelName: model.modelName,
        modelPath: model.modelPath,
        instanceURL: model.telemetryBaseUrl,
      }))
      .sort((a, b) => {
        const portA = extractPort(a.instanceURL);
        const portB = extractPort(b.instanceURL);
        if (portA !== portB) return portA - portB;
        return (a.instanceURL || "").localeCompare(b.instanceURL || "");
      });
  }, [projectModels.data]);

  if (!projectPath) {
    return <p>Select a project to view telemetry.</p>;
  }

  if (status !== "running") {
    return (
      <div className={styles.status}>
        <p>Launch your robot to enable telemetry.</p>
      </div>
    );
  }

  if (projectModels.loading) {
    return <p>Loading telemetry models…</p>;
  }

  if (projectModels.error) {
    return <p>Failed to load models: {projectModels.error}</p>;
  }

  if (engineModels.length === 0) {
    return <p>No telemetry models available.</p>;
  }

  return (
    <>
      {engineModels.map((model, index) => (
        <TelemetryModel key={model.instanceURL} model={model} index={index} />
      ))}
    </>
  );
}
