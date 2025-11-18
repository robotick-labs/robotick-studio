// src/js/pages/telemetry/polling.ts
// -----------------------------------------------------------------------------
// Robotick unified telemetry polling (global-coordinated, smooth cadence)
// -----------------------------------------------------------------------------

import currentProject from "../../../core/current-project";
import { EngineModel, EngineState } from "../view/types.js";
import {
  fetchLayout,
  fetchRaw,
  createTelemetryModel,
  LayoutModel,
  ITelemetryModel,
} from "../../../core/telemetry/telemetry-client";
import { HUB_API_BASE } from "../../../core/config";
import { buildUrl, fetchJSON } from "../../../core/http";

// Polling frequency (20 Hz UI cadence)
const LIVE_SLEEP_MS = 50;

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
      buildUrl(HUB_API_BASE, "/query/list-project-models", {
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
      buildUrl(HUB_API_BASE, "/query/get-model", {
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

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// GLOBAL polling loop
// -----------------------------------------------------------------------------

export async function startLivePolling(
  engines: EngineState[],
  setEngines: React.Dispatch<React.SetStateAction<EngineState[]>>
) {
  // Layout + session caches per engine
  const layouts: Record<string, LayoutModel | null> = {};
  const decodedModels: Record<string, ITelemetryModel | null> = {};
  const sessionIds: Record<string, string | null> = {};

  while (true) {
    const activeEngines = engines.filter(
      (e) =>
        localStorage.getItem(
          `telemetry-update-${urlToId(e.model.instanceURL)}`
        ) === "true"
    );

    const results = await Promise.all(
      activeEngines.map(async (engine) => {
        const url = engine.model.instanceURL;

        // Always fetch fresh raw buffer + identifying session-id
        const { raw, sid } = await fetchRaw(url);

        // If session changed → refresh layout
        let layout = layouts[url];
        let telemetryModel = decodedModels[url];
        if (
          !layout ||
          !telemetryModel ||
          (sessionIds[url] && sessionIds[url] !== sid)
        ) {
          layout = await fetchLayout(url);
          layouts[url] = layout;
          telemetryModel = layout ? createTelemetryModel(layout) : null;
          decodedModels[url] = telemetryModel;
        }
        sessionIds[url] = sid;

        if (telemetryModel) {
          telemetryModel.raw = raw;
        }

        return { url, telemetryModel };
      })
    );

    // Apply to React state in a single pass
    setEngines((prev) =>
      prev.map((engine) => {
        const r = results.find((x) => x.url === engine.model.instanceURL);
        if (
          !r ||
          !r.telemetryModel ||
          !r.telemetryModel.raw ||
          r.telemetryModel.raw.byteLength == 0
        )
          return engine;

        return {
          ...engine,
          workloads: r.telemetryModel.workloads,
          workloadsMemoryUsed: r.telemetryModel.workloads_buffer_size_used,
          processMemoryUsed: r.telemetryModel.process_memory_used,
          canLivePoll: true,
          hasInitialWorkloads: true,
        };
      })
    );

    // Maintain stable cadence
    await sleep(LIVE_SLEEP_MS);
  }
}
