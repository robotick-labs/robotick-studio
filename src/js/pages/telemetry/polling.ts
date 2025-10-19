// src/js/pages/telemetry/polling.ts
import currentProject from "../../core/current-project.js";
import { EngineModel, EngineState, TelemetryWorkload } from "./types";

/**
 * ESP32-safe, not over-cautious:
 * - UI tick: 50 ms (20 Hz)
 * - Per-workload target revisit: 100 ms (~10 Hz)
 * - Batched polling per tick, fast (stats+outputs) vs slow (config+inputs)
 * - Cache: "no-store" and AbortSignals
 * - Empty/missing sections normalized to "-" (as requested)
 */

const LIVE_SLEEP_MS = 50; // UI poll cadence (20 Hz)
const PER_WORKLOAD_TARGET_MS = 100; // Per-workload refresh target (~10 Hz)
const SLOW_REFRESH_MS = 3000; // Config/inputs refresh interval

export function urlToId(url: string) {
  return url.replace(/[:/.]/g, "_");
}

function normalizeSection<T = any>(v: T | null | undefined): T | string {
  if (v && typeof v === "object") {
    try {
      if (Object.keys(v as any).length > 0) return v;
    } catch {
      /* fallthrough */
    }
  }
  return "-";
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
    if (!res.ok) {
      console.warn("Fetch non-OK:", urlBase + path, res.status, res.statusText);
      return null;
    }
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as any)?.name !== "AbortError") {
      console.warn("Fetch failed:", urlBase + path, err);
    }
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

export async function fetchWorkloadDetails(
  url: string,
  name: string,
  signal?: AbortSignal
): Promise<{
  config: any | string;
  inputs: any | string;
  outputs: any | string;
}> {
  const [config, inputs, outputs] = await Promise.all([
    fetchJSON(
      url,
      `/api/telemetry/workload/config?name=${encodeURIComponent(name)}`,
      signal
    ),
    fetchJSON(
      url,
      `/api/telemetry/workload/inputs?name=${encodeURIComponent(name)}`,
      signal
    ),
    fetchJSON(
      url,
      `/api/telemetry/workload/outputs?name=${encodeURIComponent(name)}`,
      signal
    ),
  ]);
  return {
    config: normalizeSection(config),
    inputs: normalizeSection(inputs),
    outputs: normalizeSection(outputs),
  };
}

export async function fetchWorkloadLiveData(
  url: string,
  name: string,
  signal?: AbortSignal
): Promise<{
  stats: any | null;
  config: any | string;
  inputs: any | string;
  outputs: any | string;
}> {
  const [stats, config, inputs, outputs] = await Promise.all([
    fetchJSON(
      url,
      `/api/telemetry/workload/stats?name=${encodeURIComponent(name)}`,
      signal
    ),
    fetchJSON(
      url,
      `/api/telemetry/workload/config?name=${encodeURIComponent(name)}`,
      signal
    ),
    fetchJSON(
      url,
      `/api/telemetry/workload/inputs?name=${encodeURIComponent(name)}`,
      signal
    ),
    fetchJSON(
      url,
      `/api/telemetry/workload/outputs?name=${encodeURIComponent(name)}`,
      signal
    ),
  ]);
  return {
    stats: stats ?? null,
    config: normalizeSection(config),
    inputs: normalizeSection(inputs),
    outputs: normalizeSection(outputs),
  };
}

// FAST path: stats + outputs only (for high-rate updates)
async function fetchWorkloadFast(
  url: string,
  name: string,
  signal?: AbortSignal
): Promise<{ stats: any | null; outputs: any | string }> {
  const [stats, outputs] = await Promise.all([
    fetchJSON(
      url,
      `/api/telemetry/workload/stats?name=${encodeURIComponent(name)}`,
      signal
    ),
    fetchJSON(
      url,
      `/api/telemetry/workload/outputs?name=${encodeURIComponent(name)}`,
      signal
    ),
  ]);
  return { stats: stats ?? null, outputs: normalizeSection(outputs) };
}

// SLOW path: config + inputs (for infrequent refresh)
async function fetchWorkloadSlow(
  url: string,
  name: string,
  signal?: AbortSignal
): Promise<{ config: any | string; inputs: any | string }> {
  const [config, inputs] = await Promise.all([
    fetchJSON(
      url,
      `/api/telemetry/workload/config?name=${encodeURIComponent(name)}`,
      signal
    ),
    fetchJSON(
      url,
      `/api/telemetry/workload/inputs?name=${encodeURIComponent(name)}`,
      signal
    ),
  ]);
  return { config: normalizeSection(config), inputs: normalizeSection(inputs) };
}

// State helpers for immutable-ish updates
export function mutateEngine(
  setEngines: React.Dispatch<React.SetStateAction<EngineState[]>>,
  url: string,
  mut: (s: EngineState) => void
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

// Long-running loops, called from TelemetryApp
export async function pollWorkloadsForever(
  state: EngineState,
  setEngines: React.Dispatch<React.SetStateAction<EngineState[]>>
) {
  const url = state.model.instanceURL;
  const signal = state.pollingController.signal;
  try {
    while (true) {
      if (signal.aborted) return;

      const data = await fetchJSON<{
        workloads?: { name?: string; type?: string }[];
      }>(url, "/api/telemetry/workloads", signal);

      const names = new Set<string>();

      if (data?.workloads) {
        const next = mutateEngine(setEngines, url, (s) => {
          s.canLivePoll = true;
          for (const w of data.workloads!) {
            const nm = w.name ?? "–";
            names.add(nm);
            if (!s.workloads.find((e) => e.name === nm)) {
              s.workloads.push({
                name: nm,
                type: w.type ?? "–",
                dt_ms: null,
                goal_ms: null,
                self_ms: null,
                // Use "-" placeholders until we fetch details
                config: "-",
                inputs: "-",
                outputs: "-",
              });
            }
          }
          s.workloads = s.workloads.filter((w) => names.has(w.name));
          s.hasInitialWorkloads = s.workloads.length > 0;
        });

        const matchedEngine = next.find((e) => e.model.instanceURL === url);
        if (!matchedEngine) return; // prevent crash

        // Fetch details for newly discovered workloads (those still at "-")
        const withNoDetails = matchedEngine.workloads.filter(
          (w) => w.config === "-" && w.inputs === "-" && w.outputs === "-"
        );

        await Promise.all(
          withNoDetails.map(async (wld) => {
            const { config, inputs, outputs } = await fetchWorkloadDetails(
              url,
              wld.name,
              signal
            );
            mutateEngine(setEngines, url, (s) => {
              const target = s.workloads.find((x) => x.name === wld.name);
              if (target) {
                target.config = config;
                target.inputs = inputs;
                target.outputs = outputs;
              }
            });
          })
        );
      } else {
        mutateEngine(setEngines, url, (s) => (s.canLivePoll = false));
      }

      await sleep(state.hasInitialWorkloads ? 3000 : 1000);
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") console.error("Polling error:", e);
  }
}

export async function startLivePolling(
  state: EngineState,
  setEngines: React.Dispatch<React.SetStateAction<EngineState[]>>
) {
  const url = state.model.instanceURL;
  const signal = state.livePollingController.signal;

  // Track slow refresh cadence locally to avoid expanding EngineState
  let lastSlowRefresh = 0;

  try {
    while (true) {
      if (signal.aborted) return;

      const snapshot = getEngineSnapshot(setEngines, url);
      const workloads = snapshot?.workloads ?? [];

      if (snapshot?.canLivePoll && workloads.length > 0) {
        const N = workloads.length;

        // Compute batch so each workload gets ≤ PER_WORKLOAD_TARGET_MS revisit
        const batchSize = Math.max(
          1,
          Math.ceil((N * LIVE_SLEEP_MS) / PER_WORKLOAD_TARGET_MS)
        );

        const startIdx = snapshot.workloadIndex % N;
        const toPoll: string[] = [];
        for (let i = 0; i < batchSize; i++) {
          toPoll.push(workloads[(startIdx + i) % N].name);
        }

        // FAST: poll stats+outputs for this batch
        const fastResults = await Promise.all(
          toPoll.map((name) => fetchWorkloadFast(url, name, signal))
        );

        // Apply fast updates (normalize outputs to "-")
        mutateEngine(setEngines, url, (s) => {
          s.workloadIndex = (s.workloadIndex + batchSize) % Math.max(1, N);
          for (let i = 0; i < toPoll.length; i++) {
            const name = toPoll[i];
            const { stats, outputs } = fastResults[i] || {};
            const target = s.workloads.find((x) => x.name === name);
            if (!target) continue;
            if (stats) {
              target.self_ms = stats.self_ms;
              target.dt_ms = stats.dt_ms;
              target.goal_ms = stats.goal_ms;
            }
            target.outputs = normalizeSection(outputs);
          }
        });

        // SLOW: refresh config+inputs periodically without blocking the fast path
        const now = nowMs();
        if (now - lastSlowRefresh >= SLOW_REFRESH_MS) {
          lastSlowRefresh = now;
          void Promise.all(
            toPoll.map(async (name) => {
              const { config, inputs } = await fetchWorkloadSlow(
                url,
                name,
                signal
              );
              mutateEngine(setEngines, url, (s) => {
                const target = s.workloads.find((x) => x.name === name);
                if (!target) return;
                target.config = normalizeSection(config);
                target.inputs = normalizeSection(inputs);
              });
            })
          );
        }
      }

      await sleep(LIVE_SLEEP_MS);
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") console.error("Live polling error:", e);
  }
}
