import type { FieldConnectionHint } from "./types";

export type ConnectionKind = "local" | "remote" | "both";
type ConnectionDirection = "input" | "output" | null;

type RawDirectConnection = {
  from?: unknown;
  to?: unknown;
};

type RawRemoteConnection = {
  from?: unknown;
  to_remote?: unknown;
};

type RawRemoteModelSpec = {
  name?: unknown;
  connections?: unknown;
};

type RawModelData = {
  connections?: unknown;
  remote_models?: unknown;
};

type MutableFieldConnectionHint = {
  localIncomingFrom: Set<string>;
  remoteIncomingFrom: Set<string>;
  localOutgoingTo: Set<string>;
  remoteOutgoingTo: Set<string>;
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

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase();
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
  const shortNameToModelPath = new Map<string, string>();
  const modelNameToModelPath = new Map<string, string>();

  for (const model of models) {
    shortNameToModelPath.set(
      normalizeLookupKey(model.modelShortName),
      model.modelPath
    );
    modelNameToModelPath.set(normalizeLookupKey(model.modelName), model.modelPath);
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
      const from = normalizeTelemetryFieldPath(connection?.from);
      const to = normalizeTelemetryFieldPath(connection?.to);
      if (!from || !to) continue;
      ensureHint(modelHints, from).localOutgoingTo.add(to);
      ensureHint(modelHints, to).localIncomingFrom.add(from);
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
      const remoteName =
        typeof remoteModel?.name === "string" ? remoteModel.name.trim() : "";
      if (!remoteName) continue;

      const lookupKey = normalizeLookupKey(remoteName);
      const targetModelPath =
        shortNameToModelPath.get(lookupKey) ??
        modelNameToModelPath.get(lookupKey);
      if (!targetModelPath) continue;

      const targetHints = hintsByModelPath.get(targetModelPath) ?? new Map();
      hintsByModelPath.set(targetModelPath, targetHints);

      const remoteConnections = Array.isArray(remoteModel.connections)
        ? (remoteModel.connections as RawRemoteConnection[])
        : [];

      for (const connection of remoteConnections) {
        const from = normalizeTelemetryFieldPath(connection?.from);
        const toRemote = normalizeTelemetryFieldPath(connection?.to_remote);
        if (!from || !toRemote) continue;

        ensureHint(sourceHints, from).remoteOutgoingTo.add(
          `${remoteName}.${toRemote}`
        );
        ensureHint(targetHints, toRemote).remoteIncomingFrom.add(
          `${sourceModel.modelShortName}.${from}`
        );
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
