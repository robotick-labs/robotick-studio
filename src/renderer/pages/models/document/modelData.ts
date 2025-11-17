import currentProject from "../../../core/current-project";

export interface Workload {
  name: string;
  type?: string;
  tick_rate_hz: number;
  children?: string[];
  config: Record<string, string>;
  inputs: Record<string, string>;
}

export interface DirectConnection {
  from: string;
  to: string;
}
export interface RemoteDirectConnection {
  from: string;
  to_remote: string;
}
export interface RemoteModelSpec {
  name: string;
  connections?: RemoteDirectConnection[];
}

export interface ModelData {
  root: string;
  workloads: Workload[];
  connections?: DirectConnection[];
  remote_models?: RemoteModelSpec[];
}

export interface LoadedModel {
  modelPath: string;
  data: ModelData;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return (await res.json()) as T;
}

export async function loadAllModels(): Promise<LoadedModel[]> {
  const projectPath = (currentProject as any).getProjectPath?.();
  if (!projectPath) throw new Error("No project path set");

  const base = "http://localhost:7081";
  const models = await fetchJSON<string[]>(
    `${base}/query/list-project-models?project_path=${encodeURIComponent(
      projectPath
    )}`
  );

  const out: LoadedModel[] = [];
  for (const modelPath of models) {
    const data = await fetchJSON<ModelData>(
      `${base}/query/get-model?project_path=${encodeURIComponent(
        projectPath
      )}&model_path=${encodeURIComponent(modelPath)}`
    );
    out.push({ modelPath, data });
  }
  return out;
}
