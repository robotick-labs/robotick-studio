import type { FieldConnectionHint } from "./types";

export type ConnectionKind = "local" | "remote" | "both";
type ConnectionDirection = "input" | "output" | null;

type RawDirectConnection = {
  from?: unknown;
  to?: unknown;
};

type RawRemoteConnection = {
  from?: unknown;
  from_local?: unknown;
  to_remote?: unknown;
  from_remote?: unknown;
  to?: unknown;
  to_local?: unknown;
};

type RawRemoteModelSpec = {
  name?: unknown;
  model_id?: unknown;
  connections?: unknown;
};

type RawModelData = {
  id?: unknown;
  workloads?: unknown;
  connections?: unknown;
  remote_models?: unknown;
};

type MutableFieldConnectionHint = {
  localIncomingFrom: Set<string>;
  remoteIncomingFrom: Set<string>;
  localOutgoingTo: Set<string>;
  remoteOutgoingTo: Set<string>;
};

type LocalConnectionHintInput = {
  rawFrom: string;
  rawTo: string;
  displayFrom: string;
  displayTo: string;
};

type RemoteOutgoingConnectionHintInput = {
  rawFrom: string;
  rawToRemote: string;
  displayFrom: string;
  displayToRemote: string;
  remoteModelLabel: string;
  sourceModelLabel: string;
};

type RemoteIncomingConnectionHintInput = {
  rawFromRemote: string;
  rawTo: string;
  displayFromRemote: string;
  displayTo: string;
  remoteModelLabel: string;
  sourceModelLabel: string;
};

export type ConnectionHintModelDescriptor = {
  modelPath: string;
  modelShortName: string;
  modelName: string;
  data: unknown;
};

function normalizeTelemetryFieldPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const trimmed = path.trim();
  if (!trimmed.includes(".")) return null;
  return trimmed;
}

function endpointOwner(path: string): string {
  return path.split(".", 1)[0] ?? "";
}

function replaceEndpointOwner(path: string, owner: string): string {
  const parts = path.split(".");
  if (parts.length === 0) return path;
  parts[0] = owner;
  return parts.join(".");
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  return Array.from(new Set(paths.filter((path): path is string => Boolean(path))));
}

function pathWithDisplayOwner(
  path: string,
  workloadNames: ReadonlyMap<string, string>
): string {
  const owner = endpointOwner(path);
  return workloadNames.has(owner)
    ? replaceEndpointOwner(path, workloadNames.get(owner) ?? owner)
    : path;
}

function makeEmptyHint(): MutableFieldConnectionHint {
  return {
    localIncomingFrom: new Set<string>(),
    remoteIncomingFrom: new Set<string>(),
    localOutgoingTo: new Set<string>(),
    remoteOutgoingTo: new Set<string>(),
  };
}

function ensureHint(
  map: Map<string, MutableFieldConnectionHint>,
  path: string
): MutableFieldConnectionHint {
  const existing = map.get(path);
  if (existing) return existing;
  const created = makeEmptyHint();
  map.set(path, created);
  return created;
}

function addLocalConnectionHint(
  map: Map<string, MutableFieldConnectionHint>,
  input: LocalConnectionHintInput
): void {
  const { rawFrom, rawTo, displayFrom, displayTo } = input;
  for (const fromPath of uniquePaths([rawFrom, displayFrom])) {
    ensureHint(map, fromPath).localOutgoingTo.add(displayTo);
  }
  for (const toPath of uniquePaths([rawTo, displayTo])) {
    ensureHint(map, toPath).localIncomingFrom.add(displayFrom);
  }
}

function addRemoteOutgoingConnectionHint(
  sourceHints: Map<string, MutableFieldConnectionHint>,
  targetHints: Map<string, MutableFieldConnectionHint>,
  input: RemoteOutgoingConnectionHintInput
): void {
  const {
    rawFrom,
    rawToRemote,
    displayFrom,
    displayToRemote,
    remoteModelLabel,
    sourceModelLabel,
  } = input;
  for (const fromPath of uniquePaths([rawFrom, displayFrom])) {
    ensureHint(sourceHints, fromPath).remoteOutgoingTo.add(
      `${remoteModelLabel}.${displayToRemote}`
    );
  }
  for (const toRemotePath of uniquePaths([rawToRemote, displayToRemote])) {
    ensureHint(targetHints, toRemotePath).remoteIncomingFrom.add(
      `${sourceModelLabel}.${displayFrom}`
    );
  }
}

function addRemoteIncomingConnectionHint(
  sourceHints: Map<string, MutableFieldConnectionHint>,
  targetHints: Map<string, MutableFieldConnectionHint>,
  input: RemoteIncomingConnectionHintInput
): void {
  const {
    rawFromRemote,
    rawTo,
    displayFromRemote,
    displayTo,
    remoteModelLabel,
    sourceModelLabel,
  } = input;
  for (const toPath of uniquePaths([rawTo, displayTo])) {
    ensureHint(sourceHints, toPath).remoteIncomingFrom.add(
      `${remoteModelLabel}.${displayFromRemote}`
    );
  }
  for (const fromRemotePath of uniquePaths([rawFromRemote, displayFromRemote])) {
    ensureHint(targetHints, fromRemotePath).remoteOutgoingTo.add(
      `${sourceModelLabel}.${displayTo}`
    );
  }
}

function toSerializableHints(
  map: Map<string, MutableFieldConnectionHint>
): Record<string, FieldConnectionHint> {
  const out: Record<string, FieldConnectionHint> = {};
  for (const [path, hint] of map) {
    out[path] = {
      localIncomingFrom: Array.from(hint.localIncomingFrom),
      remoteIncomingFrom: Array.from(hint.remoteIncomingFrom),
      localOutgoingTo: Array.from(hint.localOutgoingTo),
      remoteOutgoingTo: Array.from(hint.remoteOutgoingTo),
    };
  }
  return out;
}

export function buildFieldConnectionHintsByModelPath(
  models: readonly ConnectionHintModelDescriptor[]
): Map<string, Record<string, FieldConnectionHint>> {
  const hintsByModelPath = new Map<
    string,
    Map<string, MutableFieldConnectionHint>
  >();
  const modelIdToModelPath = new Map<string, string>();
  const workloadNamesByModelPath = new Map<string, Map<string, string>>();

  for (const model of models) {
    const modelData = (model.data ?? {}) as RawModelData;
    const modelId =
      typeof modelData.id === "string" ? modelData.id.trim() : "";
    if (modelId) {
      modelIdToModelPath.set(modelId, model.modelPath);
    }
    const workloadIdToName = new Map<string, string>();
    const workloads = Array.isArray(modelData.workloads)
      ? (modelData.workloads as Array<Record<string, unknown>>)
      : [];
    for (const workload of workloads) {
      const workloadId =
        typeof workload?.id === "string" ? workload.id.trim() : "";
      if (!workloadId) continue;
      const workloadName =
        (typeof workload?.name === "string" && workload.name.trim()) || workloadId;
      workloadIdToName.set(workloadId, workloadName);
    }
    workloadNamesByModelPath.set(model.modelPath, workloadIdToName);
    hintsByModelPath.set(model.modelPath, new Map());
  }

  for (const model of models) {
    const modelHints = hintsByModelPath.get(model.modelPath) ?? new Map();
    hintsByModelPath.set(model.modelPath, modelHints);

    const modelData = (model.data ?? {}) as RawModelData;
    const localConnections = Array.isArray(modelData.connections)
      ? (modelData.connections as RawDirectConnection[])
      : [];

    for (const connection of localConnections) {
      const rawFrom = normalizeTelemetryFieldPath(connection?.from);
      const rawTo = normalizeTelemetryFieldPath(connection?.to);
      if (!rawFrom || !rawTo) continue;
      const localWorkloads =
        workloadNamesByModelPath.get(model.modelPath) ?? new Map();
      addLocalConnectionHint(modelHints, {
        rawFrom,
        rawTo,
        displayFrom: pathWithDisplayOwner(rawFrom, localWorkloads),
        displayTo: pathWithDisplayOwner(rawTo, localWorkloads),
      });
    }
  }

  for (const sourceModel of models) {
    const sourceData = (sourceModel.data ?? {}) as RawModelData;
    const sourceHints = hintsByModelPath.get(sourceModel.modelPath) ?? new Map();
    hintsByModelPath.set(sourceModel.modelPath, sourceHints);

    const remoteModels = Array.isArray(sourceData.remote_models)
      ? (sourceData.remote_models as RawRemoteModelSpec[])
      : [];

    for (const remoteModel of remoteModels) {
      const remoteModelId =
        typeof remoteModel?.model_id === "string"
          ? remoteModel.model_id.trim()
          : "";
      const remoteName =
        typeof remoteModel?.name === "string" ? remoteModel.name.trim() : "";
      if (!remoteName && !remoteModelId) continue;

      const targetModelPath = remoteModelId
        ? modelIdToModelPath.get(remoteModelId)
        : undefined;
      if (!targetModelPath) continue;
      const sourceWorkloads =
        workloadNamesByModelPath.get(sourceModel.modelPath) ?? new Map();
      const targetWorkloads =
        workloadNamesByModelPath.get(targetModelPath) ?? new Map();
      const remoteModelLabel = remoteName || remoteModelId;

      const targetHints = hintsByModelPath.get(targetModelPath) ?? new Map();
      hintsByModelPath.set(targetModelPath, targetHints);

      const remoteConnections = Array.isArray(remoteModel.connections)
        ? (remoteModel.connections as RawRemoteConnection[])
        : [];

      for (const connection of remoteConnections) {
        const rawFrom = normalizeTelemetryFieldPath(
          connection?.from_local ?? connection?.from
        );
        const rawToRemote = normalizeTelemetryFieldPath(connection?.to_remote);
        if (rawFrom && rawToRemote) {
          addRemoteOutgoingConnectionHint(sourceHints, targetHints, {
            rawFrom,
            rawToRemote,
            displayFrom: pathWithDisplayOwner(rawFrom, sourceWorkloads),
            displayToRemote: pathWithDisplayOwner(rawToRemote, targetWorkloads),
            remoteModelLabel,
            sourceModelLabel: sourceModel.modelShortName,
          });
          continue;
        }

        const fromRemote = normalizeTelemetryFieldPath(connection?.from_remote);
        const rawTo = normalizeTelemetryFieldPath(
          connection?.to_local ?? connection?.to
        );
        if (!fromRemote || !rawTo) continue;

        addRemoteIncomingConnectionHint(sourceHints, targetHints, {
          rawFromRemote: fromRemote,
          rawTo,
          displayFromRemote: pathWithDisplayOwner(fromRemote, targetWorkloads),
          displayTo: pathWithDisplayOwner(rawTo, sourceWorkloads),
          remoteModelLabel,
          sourceModelLabel: sourceModel.modelShortName,
        });
      }
    }
  }

  const out = new Map<string, Record<string, FieldConnectionHint>>();
  for (const [modelPath, hints] of hintsByModelPath) {
    out.set(modelPath, toSerializableHints(hints));
  }
  return out;
}

export function getDirectionForPath(path: string): ConnectionDirection {
  if (path.includes(".inputs.")) return "input";
  if (path.includes(".outputs.")) return "output";
  return null;
}

export function getConnectionHint(
  path: string,
  hints?: ReadonlyMap<string, FieldConnectionHint>
): FieldConnectionHint | null {
  if (!hints || hints.size === 0) {
    return null;
  }

  const exact = hints.get(path);
  if (exact) return exact;

  let best: FieldConnectionHint | null = null;
  let bestKeyLength = -1;
  for (const [key, hint] of hints) {
    if (!path.startsWith(`${key}.`)) continue;
    if (key.length > bestKeyLength) {
      best = hint;
      bestKeyLength = key.length;
    }
  }
  return best;
}

export function getConnectionKindFromHint(
  hint: FieldConnectionHint | null
): ConnectionKind | null {
  if (!hint) return null;
  const hasLocal =
    hint.localIncomingFrom.length > 0 || hint.localOutgoingTo.length > 0;
  const hasRemote =
    hint.remoteIncomingFrom.length > 0 || hint.remoteOutgoingTo.length > 0;
  if (hasLocal && hasRemote) return "both";
  if (hasLocal) return "local";
  if (hasRemote) return "remote";
  return null;
}

export function getConnectionTooltip(
  path: string,
  hint: FieldConnectionHint | null
): string | null {
  if (!hint) return null;

  const direction = getDirectionForPath(path);
  const lines: string[] = [];

  if (direction === "input") {
    if (hint.localIncomingFrom.length > 0) {
      lines.push("from (local):");
      for (const source of hint.localIncomingFrom) lines.push(`- ${source}`);
    }
    if (hint.remoteIncomingFrom.length > 0) {
      lines.push("from (remote):");
      for (const source of hint.remoteIncomingFrom) lines.push(`- ${source}`);
    }
  } else if (direction === "output") {
    if (hint.localOutgoingTo.length > 0) {
      lines.push("to (local):");
      for (const target of hint.localOutgoingTo) lines.push(`- ${target}`);
    }
    if (hint.remoteOutgoingTo.length > 0) {
      lines.push("to (remote):");
      for (const target of hint.remoteOutgoingTo) lines.push(`- ${target}`);
    }
  }

  if (lines.length === 0) return null;
  return lines.join("\n");
}

export function isInputConnectionDriven(
  path: string,
  hint: FieldConnectionHint | null
): boolean {
  if (!hint) return false;
  if (getDirectionForPath(path) !== "input") return false;
  return hint.localIncomingFrom.length > 0 || hint.remoteIncomingFrom.length > 0;
}
