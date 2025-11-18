import currentProject from "../../../core/current-project";
import { HUB_API_BASE } from "../../../core/config";
import { buildUrl, fetchJSON } from "../../../core/http";

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

export async function loadAllModels(): Promise<LoadedModel[]> {
  const projectPath = (currentProject as any).getProjectPath?.();
  if (!projectPath) throw new Error("No project path set");

  const models = await fetchJSON<string[]>(
    buildUrl(HUB_API_BASE, "/query/list-project-models", {
      project_path: projectPath,
    })
  );

  const out: LoadedModel[] = [];
  for (const modelPath of models) {
    const data = await fetchJSON<ModelData>(
      buildUrl(HUB_API_BASE, "/query/get-model", {
        project_path: projectPath,
        model_path: modelPath,
      })
    );
    out.push({ modelPath, data });
  }
  return out;
}
