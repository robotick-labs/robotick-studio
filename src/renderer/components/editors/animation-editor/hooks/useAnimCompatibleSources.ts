import React from "react";

import type {
  ProjectData,
  useLauncherService,
  WorkloadsRegistryResponse,
} from "../../../../data-sources/launcher";

export type CompatibleSourceRef = {
  id: string;
  type: string;
  label: string;
  modelName: string;
  modelPath: string;
  telemetryBaseUrl: string;
  workloadName: string;
};

function collectAnimCompatibleWorkloadTypes(response: WorkloadsRegistryResponse): Set<string> {
  const out = new Set<string>();
  const typeByName = new Map<string, { fields?: Array<{ name?: string; type?: string }> }>();
  for (const entry of response.types ?? []) {
    if (entry?.name) {
      typeByName.set(String(entry.name), entry);
    }
  }

  for (const workload of response.workloads ?? []) {
    const inputTypeName = workload.inputs?.type;
    const outputTypeName = workload.outputs?.type;
    if (!inputTypeName || !outputTypeName) continue;
    const inputsDef = typeByName.get(inputTypeName);
    const outputsDef = typeByName.get(outputTypeName);
    if (!inputsDef?.fields || !outputsDef?.fields) continue;

    const hasAnimControls = inputsDef.fields.some((f) => {
      const name = String(f?.name ?? "").toLowerCase();
      const type = String(f?.type ?? "");
      return name === "anim_controls" && type === "AnimControls";
    });
    const hasAnimState = outputsDef.fields.some((f) => {
      const name = String(f?.name ?? "").toLowerCase();
      const type = String(f?.type ?? "");
      return name === "anim_state" && type === "AnimState";
    });

    if (hasAnimControls && hasAnimState) {
      out.add(workload.type);
    }
  }
  return out;
}

type UseAnimCompatibleSourcesArgs = {
  launcherService: ReturnType<typeof useLauncherService>;
  projectModels: ReturnType<typeof ProjectData.use>["projectModels"];
  projectPath: string | null | undefined;
};

export function useAnimCompatibleSources({
  launcherService,
  projectModels,
  projectPath,
}: UseAnimCompatibleSourcesArgs) {
  const [animCompatibleWorkloadTypes, setAnimCompatibleWorkloadTypes] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    let cancelled = false;
    async function loadRegistry() {
      if (!projectPath) return;
      try {
        const response = await launcherService.fetchProjectWorkloadsRegistry(projectPath, "linux");
        if (cancelled) return;
        setAnimCompatibleWorkloadTypes(collectAnimCompatibleWorkloadTypes(response));
      } catch {
        if (cancelled) return;
        setAnimCompatibleWorkloadTypes(new Set());
      }
    }
    void loadRegistry();
    return () => {
      cancelled = true;
    };
  }, [launcherService, projectPath]);

  return React.useMemo(() => {
    if (animCompatibleWorkloadTypes.size === 0) {
      return [] as CompatibleSourceRef[];
    }
    const refs: CompatibleSourceRef[] = [];
    projectModels.data.forEach((model) => {
      const modelData =
        model.data && typeof model.data === "object"
          ? (model.data as Record<string, unknown>)
          : null;
      const workloads = Array.isArray(modelData?.workloads) ? modelData.workloads : [];
      workloads.forEach((entry, index) => {
        if (!entry || typeof entry !== "object") return;
        const obj = entry as Record<string, unknown>;
        const type = String((entry as Record<string, unknown>).type ?? "").trim();
        if (!type || !animCompatibleWorkloadTypes.has(type)) return;
        const workloadName = String(obj.name ?? obj.id ?? type).trim();
        const modelName = model.modelName || model.modelPath;
        refs.push({
          id: `${model.modelPath}::${String(obj.id ?? obj.name ?? `${type}#${index}`)}`,
          type,
          label: `${modelName} | ${workloadName}`,
          modelName,
          modelPath: model.modelPath,
          telemetryBaseUrl: model.telemetryBaseUrl ?? "",
          workloadName,
        });
      });
    });
    return refs;
  }, [animCompatibleWorkloadTypes, projectModels.data]);
}
