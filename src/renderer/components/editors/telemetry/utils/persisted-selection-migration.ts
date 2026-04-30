type WorkloadRecord = {
  id: string;
  name: string;
};

type ModelRecord = {
  modelPath: string;
  modelName: string;
  telemetryBaseUrl?: string;
  id?: string;
  workloads: WorkloadRecord[];
};

type SelectionLike = {
  modelId?: string;
  modelPath?: string;
  modelName?: string;
  telemetryBaseUrl?: string;
  workloadId?: string;
  workloadName?: string;
  fieldPath?: string;
};

type ProjectModelLike = {
  modelPath: string;
  modelName: string;
  telemetryBaseUrl?: string;
  data?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseModelRecord(model: ProjectModelLike): ModelRecord {
  const data = asObject(model.data);
  const modelId = toTrimmedString(data?.id);
  const rawWorkloads = Array.isArray(data?.workloads) ? data?.workloads : [];
  const workloads: WorkloadRecord[] = [];

  for (const entry of rawWorkloads) {
    const workloadObject = asObject(entry);
    if (!workloadObject) continue;
    const id = toTrimmedString(workloadObject.id);
    if (!id) continue;
    const name = toTrimmedString(workloadObject.name) || id;
    workloads.push({ id, name });
  }

  return {
    modelPath: model.modelPath,
    modelName: model.modelName,
    telemetryBaseUrl: model.telemetryBaseUrl,
    id: modelId || undefined,
    workloads,
  };
}

function eqIgnoreCase(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function replaceWorkloadPrefix(
  fieldPath: string,
  fromWorkloadName: string,
  toWorkloadName: string
): string {
  if (!fieldPath || !fromWorkloadName || !toWorkloadName) return fieldPath;
  if (fromWorkloadName === toWorkloadName) return fieldPath;
  const parts = fieldPath.split(".");
  if (parts.length === 0) return fieldPath;
  if (!eqIgnoreCase(parts[0] ?? "", fromWorkloadName)) return fieldPath;
  parts[0] = toWorkloadName;
  return parts.join(".");
}

function resolveModel(
  models: ModelRecord[],
  selection: SelectionLike
): ModelRecord | null {
  const modelId = toTrimmedString(selection.modelId);
  if (modelId) {
    const byId = models.find((model) => model.id === modelId);
    if (byId) return byId;
  }

  const modelPath = toTrimmedString(selection.modelPath);
  if (modelPath) {
    const byPath = models.find((model) => model.modelPath === modelPath);
    if (byPath) return byPath;
  }

  const telemetryBaseUrl = toTrimmedString(selection.telemetryBaseUrl);
  if (telemetryBaseUrl) {
    const byUrl = models.find(
      (model) =>
        toTrimmedString(model.telemetryBaseUrl).toLowerCase() ===
        telemetryBaseUrl.toLowerCase()
    );
    if (byUrl) return byUrl;
  }

  const modelName = toTrimmedString(selection.modelName);
  if (modelName) {
    const byName = models.find((model) => eqIgnoreCase(model.modelName, modelName));
    if (byName) return byName;
  }

  return models[0] ?? null;
}

function resolveWorkload(
  model: ModelRecord,
  selection: SelectionLike
): WorkloadRecord | null {
  const workloadId = toTrimmedString(selection.workloadId);
  if (workloadId) {
    const byId = model.workloads.find((workload) => workload.id === workloadId);
    if (byId) return byId;
  }

  const workloadName = toTrimmedString(selection.workloadName);
  if (workloadName) {
    const byName = model.workloads.find((workload) =>
      eqIgnoreCase(workload.name, workloadName)
    );
    if (byName) return byName;
  }

  return null;
}

export function migrateSelectionToStableIds<T extends SelectionLike>(
  rawSelection: T,
  projectModels: ProjectModelLike[]
): T {
  const modelRecords = projectModels.map(parseModelRecord);
  if (modelRecords.length === 0) return rawSelection;

  const resolvedModel = resolveModel(modelRecords, rawSelection);
  if (!resolvedModel) return rawSelection;

  const resolvedWorkload = resolveWorkload(resolvedModel, rawSelection);
  const workloadNameBefore = toTrimmedString(rawSelection.workloadName);
  const workloadNameAfter = resolvedWorkload?.name ?? workloadNameBefore;
  const fieldPathBefore = toTrimmedString(rawSelection.fieldPath);
  const fieldPathAfter = replaceWorkloadPrefix(
    fieldPathBefore,
    workloadNameBefore,
    workloadNameAfter
  );

  return {
    ...rawSelection,
    modelId: resolvedModel.id ?? rawSelection.modelId,
    modelPath: resolvedModel.modelPath,
    modelName: resolvedModel.modelName,
    telemetryBaseUrl:
      resolvedModel.telemetryBaseUrl ?? rawSelection.telemetryBaseUrl,
    workloadId: resolvedWorkload?.id ?? rawSelection.workloadId,
    workloadName: workloadNameAfter || rawSelection.workloadName,
    fieldPath: fieldPathAfter || rawSelection.fieldPath,
  };
}

