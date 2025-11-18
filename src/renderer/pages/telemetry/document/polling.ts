// src/js/pages/telemetry/polling.ts
// -----------------------------------------------------------------------------
// Robotick unified telemetry polling (global-coordinated, smooth cadence)
// -----------------------------------------------------------------------------

import currentProject from "../../../core/current-project";
import { EngineModel } from "../view/types.js";

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

export function urlToId(url: string) {
  return url.replace(/[:/.]/g, "_");
}

// -----------------------------------------------------------------------------
// Model discovery (needed by TelemetryApp)
// -----------------------------------------------------------------------------

export async function fetchAllModelJSONs(): Promise<
  { modelName: string; engineURL: string; modelPath: string; json: any }[]
> {
  const projectPath = currentProject.getProjectPath();
  if (!projectPath) throw new Error("No project path set");

  const models =
    (await currentProject.getProjectModels(projectPath)) ?? [];
  return models.map((model) => ({
    modelName: model.modelName,
    engineURL: model.telemetryBaseUrl,
    modelPath: model.modelPath,
    json: model.data,
  }));
}

export async function getEngineModels(): Promise<EngineModel[]> {
  const models = await fetchAllModelJSONs();

  const extractPort = (url?: string): number => {
    if (!url) return 0;
    try {
      const parsed = new URL(url);
      return parseInt(parsed.port || "0", 10);
    } catch {
      return 0;
    }
  };

  return models
    .map((m) => ({
      modelName: m.modelName,
      modelPath: m.modelPath,
      instanceURL: m.engineURL,
    }))
    .sort((a, b) => {
      const portA = extractPort(a.instanceURL);
      const portB = extractPort(b.instanceURL);
      if (portA !== portB) return portA - portB;
      return (a.instanceURL || "").localeCompare(b.instanceURL || "");
    });
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
