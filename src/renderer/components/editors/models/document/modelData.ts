import { launcherService } from "../../../../data-sources/launcher";

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

export async function loadAllModels(
  projectPath: string
): Promise<LoadedModel[]> {
  if (!projectPath) {
    throw new Error("No project path set");
  }
  const models = (await launcherService.getProjectModels(projectPath)) ?? [];
  return models.map(({ modelPath, data }) => ({
    modelPath,
    data: data as ModelData,
  }));
}
