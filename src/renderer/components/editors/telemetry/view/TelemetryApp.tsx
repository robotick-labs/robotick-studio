// src/js/components/editors/telemetry/view/TelemetryApp.tsx
import React, { useEffect, useMemo, useState } from "react";
import { EngineModel } from "./types";
import { TelemetryModel } from "./TelemetryModel";
import {
  Project,
  ProjectData,
  Launcher,
} from "../../../../data-sources/launcher";
import styles from "../Telemetry.module.css";
import { buildFieldConnectionHintsByModelPath } from "./field-connections";
import { useTelemetryService } from "../../../../data-sources/telemetry/internal/TelemetryService";

export type ModelSortKey =
  | "telemetry_port"
  | "model_name"
  | "model_path"
  | "memory_process"
  | "memory_workloads";

function extractPort(url?: string): number {
  if (!url) return 0;
  try {
    const parsed = new URL(url);
    return parseInt(parsed.port || "0", 10);
  } catch {
    return 0;
  }
}

function compareEngineModels(
  left: EngineModel,
  right: EngineModel,
  sortKey: ModelSortKey,
  getLatestMetrics: (
    baseUrl: string,
  ) => { processMemoryUsed: number; workloadsMemoryUsed: number },
): number {
  switch (sortKey) {
    case "model_name":
      return left.modelName.localeCompare(right.modelName);
    case "model_path":
      return left.modelPath.localeCompare(right.modelPath);
    case "memory_process": {
      const leftMetrics = getLatestMetrics(left.instanceURL);
      const rightMetrics = getLatestMetrics(right.instanceURL);
      const byProcess =
        rightMetrics.processMemoryUsed - leftMetrics.processMemoryUsed;
      if (byProcess !== 0) return byProcess;
      return left.modelName.localeCompare(right.modelName);
    }
    case "memory_workloads": {
      const leftMetrics = getLatestMetrics(left.instanceURL);
      const rightMetrics = getLatestMetrics(right.instanceURL);
      const byWorkloads =
        rightMetrics.workloadsMemoryUsed - leftMetrics.workloadsMemoryUsed;
      if (byWorkloads !== 0) return byWorkloads;
      return left.modelName.localeCompare(right.modelName);
    }
    case "telemetry_port":
    default: {
      const portA = extractPort(left.instanceURL);
      const portB = extractPort(right.instanceURL);
      if (portA !== portB) return portA - portB;
      return (left.instanceURL || "").localeCompare(right.instanceURL || "");
    }
  }
}

/**
 * Render the telemetry UI for the current project, showing status messages or a list of telemetry models.
 *
 * Models are ordered by their telemetry instance port (ascending); when ports are equal, models are ordered by instance URL.
 *
 * @returns A React element that displays either a prompt/status message or a list of TelemetryModel components for the current project
 */
export function TelemetryApp({
  modelSortKey = "telemetry_port",
}: {
  modelSortKey?: ModelSortKey;
}) {
  const { projectPath } = Project.Context.use();
  const { status } = Launcher.Context.use();
  const { projectModels } = ProjectData.use();
  const telemetryService = useTelemetryService();
  const [layoutRevision, setLayoutRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const telemetryBaseUrls = projectModels.data
      .map((model) => model.telemetryBaseUrl)
      .filter((url): url is string => Boolean(url));
    if (telemetryBaseUrls.length === 0) {
      return;
    }

    for (const baseUrl of telemetryBaseUrls) {
      void telemetryService
        .ensureLayout(baseUrl)
        .then(() => {
          if (cancelled) {
            return;
          }
          setLayoutRevision((prev) => prev + 1);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          console.warn(`[telemetry] Failed to warm layout for ${baseUrl}`, error);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [projectModels.data, telemetryService]);

  const engineModels = useMemo<EngineModel[]>(() => {
    const hintsByModelPath = buildFieldConnectionHintsByModelPath(
      projectModels.data.map((model) => ({
        modelPath: model.modelPath,
        modelShortName: model.modelShortName,
        modelName: model.modelName,
        data: model.data,
      }))
    );

    return [...projectModels.data]
      .map((model) => ({
        modelName: model.modelName,
        modelPath: model.modelPath,
        instanceURL: model.telemetryBaseUrl,
        preferredSampleRateHz: model.preferredTelemetrySampleRateHz,
        fieldConnectionHints: hintsByModelPath.get(model.modelPath) ?? {},
      }))
      .sort((a, b) =>
        compareEngineModels(a, b, modelSortKey, (baseUrl) => {
          const latest = telemetryService.getLatestModel(baseUrl);
          return {
            processMemoryUsed: latest?.process_memory_used ?? -1,
            workloadsMemoryUsed: latest?.workloads_buffer_size_used ?? -1,
          };
        }),
      );
  }, [layoutRevision, modelSortKey, projectModels.data, telemetryService]);

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
    const rawError: unknown = projectModels.error;
    const errorMessage =
      rawError instanceof Error
        ? rawError.message
        : String(rawError ?? "Unknown error");
    return <p>Failed to load models: {errorMessage}</p>;
  }

  if (engineModels.length === 0) {
    return <p>No telemetry models available.</p>;
  }

  return (
    <>
      {engineModels.map((model, index) => {
        const modelKey = `${model.instanceURL ?? "unknown"}|${model.modelPath}`;
        return <TelemetryModel key={modelKey} model={model} index={index} />;
      })}
    </>
  );
}
