// src/js/pages/telemetry/polling.ts
// -----------------------------------------------------------------------------
// Robotick unified telemetry polling (global-coordinated, smooth cadence)
// -----------------------------------------------------------------------------

import currentProject from "../../core/current-project.js";
import { EngineModel, EngineState } from "./types";
import { decodeTelemetry, TelemetryLayout } from "./telemetry-client";

// Polling frequency (20 Hz UI cadence)
const LIVE_SLEEP_MS = 50;

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

export function urlToId(url: string) {
  return url.replace(/[:/.]/g, "_");
}

export async function fetchJSON<T = any>(
  urlBase: string,
  path: string,
  signal?: AbortSignal
): Promise<T | null> {
  try {
    const res = await fetch(`${urlBase}${path}`, {
      cache: "no-store",
      signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Model discovery (needed by TelemetryApp)
// -----------------------------------------------------------------------------

export async function fetchAllModelJSONs(): Promise<
  { modelName: string; engineURL: string; modelPath: string; json: any }[]
> {
  const projectPath = currentProject.getProjectPath();
  if (!projectPath) throw new Error("No project path set");

  const modelPaths = await fetchJSON<string[]>(
    "http://localhost:7081",
    `/query/list-project-models?project_path=${encodeURIComponent(projectPath)}`
  );

  const results: {
    modelName: string;
    engineURL: string;
    modelPath: string;
    json: any;
  }[] = [];

  if (!modelPaths) return results;

  for (const modelPath of modelPaths) {
    const json = await fetchJSON<any>(
      "http://localhost:7081",
      `/query/get-model?project_path=${encodeURIComponent(
        projectPath
      )}&model_path=${encodeURIComponent(modelPath)}`
    );

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

// Low-level endpoint wrappers
async function fetchLayout(url: string): Promise<TelemetryLayout | null> {
  try {
    const r = await fetch(`${url}/api/telemetry/workloads_buffer/layout`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as TelemetryLayout;
  } catch {
    return null;
  }
}

async function fetchRaw(
  url: string
): Promise<{ buf: ArrayBuffer; sid: string }> {
  try {
    const r = await fetch(`${url}/api/telemetry/workloads_buffer/raw`, {
      cache: "no-store",
    });
    const buf = await r.arrayBuffer();
    const sid =
      r.headers.get("x-session-id") ||
      r.headers.get("x-robotick-session-id") ||
      "";
    return { buf, sid };
  } catch {
    return { buf: new ArrayBuffer(0), sid: "" };
  }
}

// -----------------------------------------------------------------------------
// GLOBAL polling loop
// -----------------------------------------------------------------------------

export async function startLivePolling(
  engines: EngineState[],
  setEngines: React.Dispatch<React.SetStateAction<EngineState[]>>
) {
  // Layout + session caches per engine
  const layouts: Record<string, TelemetryLayout | null> = {};
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

        // 1) Cached layout
        let layout = layouts[url];
        if (!layout) {
          layout = await fetchLayout(url);
          layouts[url] = layout;
        }

        // 2) Raw buffer + session
        const { buf, sid } = await fetchRaw(url);

        // 3) If session changed → refresh layout
        if (sessionIds[url] && sessionIds[url] !== sid) {
          layout = await fetchLayout(url);
          layouts[url] = layout;
        }
        sessionIds[url] = sid;

        // 4) Decode with absolute-offset inlining
        const decoded = layout
          ? decodeTelemetry(layout, buf)
          : { workloads: [] };

        return { url, decoded };
      })
    );

    // 5) Apply to React state in a single pass
    setEngines((prev) =>
      prev.map((engine) => {
        const r = results.find((x) => x.url === engine.model.instanceURL);
        if (!r) return engine;

        return {
          ...engine,
          workloads: r.decoded.workloads,
          canLivePoll: true,
          hasInitialWorkloads: true,
        };
      })
    );

    // 6) Maintain stable cadence
    await sleep(LIVE_SLEEP_MS);
  }
}
