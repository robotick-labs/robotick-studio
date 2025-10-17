// src/js/pages/telemetry/polling.ts
import currentProject from "../../core/current-project.js";
import { EngineModel, EngineState, TelemetryWorkload } from "./types";

export function urlToId(url: string) {
  return url.replace(/[:/.]/g, "_");
}

export async function fetchJSON<T = any>(
  urlBase: string,
  path: string
): Promise<T | null> {
  try {
    const res = await fetch(`${urlBase}${path}`);
    return await res.json();
  } catch (err) {
    console.warn("Fetch failed:", urlBase + path, err);
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
  return models.map((m) => ({
    modelName: m.modelName,
    modelPath: m.modelPath,
    instanceURL: m.engineURL,
  }));
}

export async function fetchWorkloadDetails(
  url: string,
  name: string
): Promise<{
  config: any;
  inputs: any;
  outputs: any;
}> {
  const [config, inputs, outputs] = await Promise.all([
    fetchJSON(url, `/api/telemetry/workload/config?name=${name}`),
    fetchJSON(url, `/api/telemetry/workload/inputs?name=${name}`),
    fetchJSON(url, `/api/telemetry/workload/outputs?name=${name}`),
  ]);
  return { config, inputs, outputs };
}

export async function fetchWorkloadLiveData(
  url: string,
  name: string
): Promise<{
  stats: any;
  inputs: any;
  outputs: any;
}> {
  const [stats, inputs, outputs] = await Promise.all([
    fetchJSON(url, `/api/telemetry/workload/stats?name=${name}`),
    fetchJSON(url, `/api/telemetry/workload/inputs?name=${name}`),
    fetchJSON(url, `/api/telemetry/workload/outputs?name=${name}`),
  ]);
  return { stats, inputs, outputs };
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

// Long-running loops, called from TelemetryApp
export async function pollWorkloadsForever(
  state: EngineState,
  setEngines: React.Dispatch<React.SetStateAction<EngineState[]>>
) {
  const url = state.model.instanceURL;
  try {
    while (true) {
      if (state.pollingController.signal.aborted) return;

      const data = await fetchJSON<{
        workloads?: { name?: string; type?: string }[];
      }>(url, "/api/telemetry/workloads");
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
                config: null,
                inputs: null,
                outputs: null,
              });
            }
          }
          s.workloads = s.workloads.filter((w) => names.has(w.name));
          s.hasInitialWorkloads = s.workloads.length > 0;
        });

        const withNoDetails = next
          .find((e) => e.model.instanceURL === url)!
          .workloads.filter(
            (w) => w.config === null && w.inputs === null && w.outputs === null
          );

        await Promise.all(
          withNoDetails.map(async (wld) => {
            const { config, inputs, outputs } = await fetchWorkloadDetails(
              url,
              wld.name
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
  try {
    while (true) {
      if (state.livePollingController.signal.aborted) return;

      const snapshot = getEngineSnapshot(setEngines, url);
      if (snapshot?.canLivePoll && snapshot.workloads.length > 0) {
        const idx = snapshot.workloadIndex % snapshot.workloads.length;
        const w = snapshot.workloads[idx];
        const name = w.name;

        const { stats, inputs, outputs } = await fetchWorkloadLiveData(
          url,
          name
        );

        mutateEngine(setEngines, url, (s) => {
          s.workloadIndex =
            (s.workloadIndex + 1) % Math.max(1, s.workloads.length);
          const target = s.workloads.find((x) => x.name === name);
          if (target) {
            if (stats) {
              target.self_ms = stats.self_ms;
              target.dt_ms = stats.dt_ms;
              target.goal_ms = stats.goal_ms;
            }
            if (inputs) target.inputs = inputs;
            if (outputs) target.outputs = outputs;
          }
        });
      }

      await sleep(50);
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") console.error("Live polling error:", e);
  }
}
