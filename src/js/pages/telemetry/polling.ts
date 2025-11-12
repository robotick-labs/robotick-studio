// src/js/pages/telemetry/polling.ts
// -----------------------------------------------------------------------------
// Robotick unified telemetry polling (global-coordinated, smooth cadence)
// -----------------------------------------------------------------------------

import currentProject from "../../core/current-project.js";
import { EngineModel, EngineState, TelemetryWorkload } from "./types";
import {
  fetchLayout,
  fetchRawBuffer,
  decodeTelemetry,
  TelemetryLayout,
} from "./telemetry-client";

const LIVE_SLEEP_MS = 50; // 20Hz UI cadence; change if needed

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
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

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
// State helpers
// -----------------------------------------------------------------------------

export function mutateEngine(
  setEngines: React.Dispatch<React.SetStateAction<EngineState[]>>,
  url: string,
  mut: (engineState: EngineState) => void
): EngineState[] {
  let nextCapture: EngineState[] = [];
  setEngines((prev) => {
    const next = prev.map((e) => {
      if (e.model.instanceURL !== url) return e;
      const clone: EngineState = {
        ...e,
        workloads: e.workloads,
        pollingController: e.pollingController,
        livePollingController: e.livePollingController,
      };
      mut(clone);
      return clone;
    });
    nextCapture = next;
    return next;
  });
  return nextCapture;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// -----------------------------------------------------------------------------
// GLOBAL polling loop (replaces per-engine startLivePolling())
// -----------------------------------------------------------------------------

export async function startLivePolling(
  engines: EngineState[],
  setEngines: React.Dispatch<React.SetStateAction<EngineState[]>>
) {
  const globalController = new AbortController();
  const signal = globalController.signal;

  // Per-engine layout + session caches
  const layouts: Record<string, TelemetryLayout | null> = {};
  const sessionIds: Record<string, string | null> = {};

  try {
    while (!signal.aborted) {
      const frameStart = performance.now();
      const t0 = performance.now();

      // TEMP: limit how many engines we poll per frame (for testing)
      // Later, replace with e.g. `const activeEngines = engines.filter(e => e.isExpanded)`
      const limitedEngines = engines.slice(0, 2); // poll first 2 only for now

      // Fetch/decode all selected engines in parallel
      const results = await Promise.all(
        limitedEngines.map(async (engine) => {
          const url = engine.model.instanceURL;
          const tA = performance.now();

          // Cached layout fetch
          let layout = layouts[url];
          if (!layout) {
            layout = await fetchLayout(url);
            layouts[url] = layout;
          }

          const tB = performance.now();
          const { buffer, sessionId } = await fetchRawBuffer(url);
          const tC = performance.now();

          // Refresh layout if session changes
          if (sessionIds[url] && sessionIds[url] !== sessionId) {
            layout = await fetchLayout(url);
            layouts[url] = layout;
          }
          sessionIds[url] = sessionId;

          // Decode
          let decoded: any = {};
          if (layout && buffer && buffer.byteLength) {
            const tD = performance.now();
            decoded = decodeTelemetry(layout, buffer);
            const tE = performance.now();
            console.log(
              `[${url}] layout=${(tB - tA).toFixed(1)} raw=${(tC - tB).toFixed(
                1
              )} decode=${(tE - tD).toFixed(1)}`
            );
          }

          return { url, decoded };
        })
      );

      const tFetch = performance.now();

      // Apply all updates in one React state change
      setEngines((prev) =>
        prev.map((engine) => {
          const entry = results.find((r) => r.url === engine.model.instanceURL);
          if (!entry || !entry.decoded) return engine;

          const decoded = entry.decoded;
          const workloads = [...engine.workloads];

          for (const [name, d] of Object.entries(decoded)) {
            const idx = workloads.findIndex((w) => w.name === name);
            const patch: Partial<TelemetryWorkload> = {
              type: (d as any).type,
              config: (d as any).config,
              inputs: (d as any).inputs,
              outputs: (d as any).outputs,
              self_ms: (d as any).stats?.self_ms ?? null,
              dt_ms: (d as any).stats?.dt_ms ?? null,
              goal_ms: (d as any).stats?.goal_ms ?? null,
            };
            if (idx >= 0) workloads[idx] = { ...workloads[idx], ...patch };
            else workloads.push({ name, ...patch } as TelemetryWorkload);
          }

          return {
            ...engine,
            workloads,
            canLivePoll: true,
            hasInitialWorkloads: true,
          };
        })
      );

      const tAfterSet = performance.now();
      console.log(
        `[telemetry] fetch=${(tFetch - t0).toFixed(1)}ms  react=${(
          tAfterSet - tFetch
        ).toFixed(1)}ms`
      );

      // Maintain even cadence (~20Hz)
      const elapsed = performance.now() - frameStart;
      await sleep(Math.max(0, LIVE_SLEEP_MS - elapsed));
    }
  } catch (err) {
    if (signal.aborted) return;
    console.error("Global polling stopped:", err);
  }
}
