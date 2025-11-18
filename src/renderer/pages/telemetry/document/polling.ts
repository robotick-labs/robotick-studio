// src/js/pages/telemetry/polling.ts
// -----------------------------------------------------------------------------
// Robotick unified telemetry polling (global-coordinated, smooth cadence)
// -----------------------------------------------------------------------------

import currentProject from "../../../core/current-project";
import { EngineModel } from "../view/types.js";
import { LAUNCHER_LOCAL_API_BASE } from "../../../core/config";
import { buildUrl, fetchJSON } from "../../../core/http";

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

  const modelPaths =
    (await fetchJSON<string[]>(
      buildUrl(LAUNCHER_LOCAL_API_BASE, "/query/list-project-models", {
        project_path: projectPath,
      })
    ).catch(() => null)) ?? [];

  const results: {
    modelName: string;
    engineURL: string;
    modelPath: string;
    json: any;
  }[] = [];

  for (const modelPath of modelPaths) {
    const json = await fetchJSON<any>(
      buildUrl(LAUNCHER_LOCAL_API_BASE, "/query/get-model", {
        project_path: projectPath,
        model_path: modelPath,
      })
    ).catch(() => null);

    if (!json) continue;

    const modelName = json?.name
      ? json.name
      : modelPath
          .split("/")
          .pop()
          ?.replace(/\.model\.yaml$/, "") ?? "Unnamed";

    const telemetryPort = json?.telemetry?.port
      ? String(json.telemetry.port)
      : "7090";

    results.push({
      modelName,
      engineURL: `http://localhost:${telemetryPort}`,
      modelPath,
      json,
    });
  }
  return results;
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
