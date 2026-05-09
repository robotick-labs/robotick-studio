import { launcherService } from "../../../../data-sources/launcher";

export interface Workload {
  id: string;
  name: string;
  comment?: string;
  type?: string;
  tick_rate_hz: number;
  children?: Array<{ workload_id: string }>;
  config: Record<string, unknown>;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

export interface DirectConnection {
  from: string;
  to: string;
  comment?: string;
}
export interface RemoteDirectConnection {
  from_local?: string;
  to_remote?: string;
  from_remote?: string;
  to_local?: string;
  comment?: string;
}
export interface RemoteModelSpec {
  model_id: string;
  comment?: string;
  connections?: RemoteDirectConnection[];
}

export interface ModelData {
  id: string;
  name?: string;
  comment?: string;
  telemetry?: {
    port?: number;
    telemetry_push_rate_hz?: number;
    [key: string]: unknown;
  };
  root: { workload_id: string };
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
    data: parseStrictModelData(data, modelPath),
  }));
}

function parseStrictModelData(raw: unknown, modelPath: string): ModelData {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${modelPath}: model must be an object`);
  }
  const model = raw as Partial<ModelData>;
  if (typeof model.id !== "string" || model.id.trim().length === 0) {
    throw new Error(`${modelPath}: missing required top-level 'id'`);
  }
  if (model.comment != null && typeof model.comment !== "string") {
    throw new Error(`${modelPath}: optional 'comment' must be a string`);
  }
  if (!model.root || typeof model.root !== "object") {
    throw new Error(`${modelPath}: root must be an object with workload_id`);
  }
  if (
    typeof (model.root as { workload_id?: unknown }).workload_id !== "string" ||
    !(model.root as { workload_id: string }).workload_id.trim()
  ) {
    throw new Error(`${modelPath}: root.workload_id must be a non-empty string`);
  }
  if (!Array.isArray(model.workloads)) {
    throw new Error(`${modelPath}: workloads must be an array`);
  }
  const workloads = model.workloads as Workload[];
  const workloadIds = new Set<string>();
  for (const workload of workloads) {
    if (!workload || typeof workload !== "object") {
      throw new Error(`${modelPath}: each workload must be an object`);
    }
    if (typeof workload.id !== "string" || workload.id.trim().length === 0) {
      throw new Error(`${modelPath}: each workload requires non-empty 'id'`);
    }
    if (workload.comment != null && typeof workload.comment !== "string") {
      throw new Error(
        `${modelPath}: workload '${workload.id}' optional 'comment' must be a string`,
      );
    }
    if (workloadIds.has(workload.id)) {
      throw new Error(`${modelPath}: duplicate workload id '${workload.id}'`);
    }
    workloadIds.add(workload.id);
    if (!Array.isArray(workload.children)) continue;
    for (const child of workload.children) {
      if (
        !child ||
        typeof child !== "object" ||
        typeof child.workload_id !== "string" ||
        child.workload_id.trim().length === 0
      ) {
        throw new Error(
          `${modelPath}: workload '${workload.id}' children must use { workload_id }`,
        );
      }
    }
  }

  const rootId = model.root.workload_id;
  if (!workloadIds.has(rootId)) {
    throw new Error(
      `${modelPath}: root.workload_id '${rootId}' does not match any workload id`,
    );
  }

  for (const workload of workloads) {
    for (const child of workload.children ?? []) {
      if (!workloadIds.has(child.workload_id)) {
        throw new Error(
          `${modelPath}: workload '${workload.id}' child '${child.workload_id}' not found`,
        );
      }
    }
  }

  for (const connection of model.connections ?? []) {
    validateEndpointOwner(
      modelPath,
      "connections[].from",
      connection.from,
      workloadIds,
    );
    validateEndpointOwner(modelPath, "connections[].to", connection.to, workloadIds);
  }

  const remoteModelIds = new Set<string>();
  for (const remoteModel of model.remote_models ?? []) {
    if (
      !remoteModel ||
      typeof remoteModel !== "object" ||
      typeof remoteModel.model_id !== "string" ||
      remoteModel.model_id.trim().length === 0
    ) {
      throw new Error(
        `${modelPath}: remote_models entries require non-empty 'model_id'`,
      );
    }
    if (remoteModelIds.has(remoteModel.model_id)) {
      throw new Error(
        `${modelPath}: duplicate remote model_id '${remoteModel.model_id}'`,
      );
    }
    if (remoteModel.comment != null && typeof remoteModel.comment !== "string") {
      throw new Error(
        `${modelPath}: remote model '${remoteModel.model_id}' optional 'comment' must be a string`,
      );
    }
    remoteModelIds.add(remoteModel.model_id);
    for (const connection of remoteModel.connections ?? []) {
      const hasOutgoing =
        typeof connection.from_local === "string" &&
        typeof connection.to_remote === "string";
      const hasIncoming =
        typeof connection.from_remote === "string" &&
        typeof connection.to_local === "string";
      if (!hasOutgoing && !hasIncoming) {
        throw new Error(
          `${modelPath}: remote connection must use from_local/to_remote or from_remote/to_local`,
        );
      }
      if (hasOutgoing) {
        validateEndpointOwner(
          modelPath,
          "remote_models[].connections[].from_local",
          connection.from_local as string,
          workloadIds,
        );
      }
      if (hasIncoming) {
        validateEndpointOwner(
          modelPath,
          "remote_models[].connections[].to_local",
          connection.to_local as string,
          workloadIds,
        );
      }
    }
  }

  return model as ModelData;
}

function validateEndpointOwner(
  modelPath: string,
  fieldPath: string,
  endpoint: string,
  workloadIds: Set<string>,
) {
  const ownerId = endpoint.split(".")[0];
  if (!ownerId || !workloadIds.has(ownerId)) {
    throw new Error(
      `${modelPath}: ${fieldPath} owner '${ownerId}' does not match any local workload id`,
    );
  }
}
