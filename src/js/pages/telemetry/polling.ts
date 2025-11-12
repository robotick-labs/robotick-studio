// src/js/pages/telemetry/polling.ts
// -----------------------------------------------------------------------------
// Robotick unified telemetry polling (using telemetry-client.ts)
// -----------------------------------------------------------------------------
// The classic workload/config/input/output JSON endpoints are gone.
// Instead, this version uses fetchLayout() + fetchRawBuffer() + decodeTelemetry()
// to retrieve all workload data in one go.
// -----------------------------------------------------------------------------

import currentProject from "../../core/current-project.js";
import { EngineModel, EngineState, TelemetryWorkload } from "./types";
import {
  fetchLayout,
  fetchRawBuffer,
  decodeTelemetry,
  TelemetryLayout,
} from "./telemetry-client";

const LIVE_SLEEP_MS = 50; // UI poll cadence (20 Hz)

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
        workloads: e.workloads.map((w) => ({ ...w })),
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

export function getEngineSnapshot(
  setEngines: React.Dispatch<React.SetStateAction<EngineState[]>>,
  url: string
): EngineState | undefined {
  let snap: EngineState | undefined;
  setEngines((prev) => {
    snap = prev.find((e) => e.model.instanceURL === url);
    return prev;
  });
  return snap;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowMs() {
  return Date.now();
}

// -----------------------------------------------------------------------------
// Main polling loop
// -----------------------------------------------------------------------------

export async function startLivePolling(
  state: EngineState,
  setEngines: React.Dispatch<React.SetStateAction<EngineState[]>>
) {
  const url = state.model.instanceURL;
  const signal = state.livePollingController.signal;

  let layout: TelemetryLayout | null = null;
  let lastSessionId: string | null = null;

  try {
    while (true) {
      if (signal.aborted) return;

      // Refresh layout if never fetched or session changes
      if (!layout) {
        layout = await fetchLayout(url);
      }

      // Fetch raw buffer with session heade
      const { buffer, sessionId } = await fetchRawBuffer(url);
      if (!buffer || buffer.byteLength === 0) {
        await sleep(500);
        continue;
      }

      if (sessionId !== lastSessionId) {
        layout = await fetchLayout(url);
        lastSessionId = sessionId;
      }

      const decoded = layout ? decodeTelemetry(layout, buffer) : {};

      // Apply updates to engine state
      mutateEngine(setEngines, url, (engineState) => {
        engineState.canLivePoll = true;
        engineState.hasInitialWorkloads = true;
        engineState.workloads = [];

        for (const [name, w] of Object.entries(decoded)) {
          const outputs = w.outputs;
          const inputs = w.inputs;
          const config = w.config;
          const dt_ms = (w.stats?.dt_ms as number) ?? null;
          const goal_ms = (w.stats?.goal_ms as number) ?? null;
          const self_ms = (w.stats?.self_ms as number) ?? null;

          engineState.workloads.push({
            name,
            type: w.type,
            dt_ms,
            goal_ms,
            self_ms,
            config,
            inputs,
            outputs,
          });
        }
      });

      await sleep(LIVE_SLEEP_MS);
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") console.error("Live polling error:", e);
  }
}
