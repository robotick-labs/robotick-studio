import type { ProjectModelDescriptor } from "../../data-sources/launcher";
import type { TelemetryAnimator } from "./viewer-schema";

function normalizeKey(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function getDescriptorModelId(descriptor: ProjectModelDescriptor): string {
  const data = descriptor.data as { id?: unknown } | undefined;
  return typeof data?.id === "string" ? data.id.trim() : "";
}

export function resolveAnimatorModelDescriptor(
  animator: TelemetryAnimator,
  descriptors: ProjectModelDescriptor[]
): ProjectModelDescriptor | null {
  const modelId = (animator.modelId ?? "").trim();
  if (modelId) {
    const byId = descriptors.find((descriptor) => getDescriptorModelId(descriptor) === modelId);
    if (byId) return byId;
  }

  const modelName = normalizeKey(animator.modelName);
  if (!modelName) {
    return null;
  }

  return (
    descriptors.find((descriptor) => {
      const shortName = normalizeKey(descriptor.modelShortName);
      if (shortName && shortName === modelName) {
        return true;
      }
      return normalizeKey(descriptor.modelName) === modelName;
    }) ?? null
  );
}

export function resolveAnimatorWorkloadName(
  animator: TelemetryAnimator,
  descriptor: ProjectModelDescriptor | null
): string | null {
  const workloadId = (animator.workloadId ?? "").trim();
  if (workloadId && descriptor) {
    const data = descriptor.data as { workloads?: Array<Record<string, unknown>> } | undefined;
    const workloads = Array.isArray(data?.workloads) ? data.workloads : [];
    const match = workloads.find(
      (workload) => typeof workload?.id === "string" && workload.id.trim() === workloadId
    );
    const byIdName = typeof match?.name === "string" ? match.name.trim() : "";
    if (byIdName) {
      return byIdName;
    }
  }

  const workloadName = (animator.workloadName ?? "").trim();
  return workloadName || null;
}

export function resolveAnimatorTelemetryWorkloadName(
  animator: TelemetryAnimator,
  descriptor: ProjectModelDescriptor | null
): string | null {
  const workloadId = (animator.workloadId ?? "").trim();
  if (workloadId) {
    return workloadId;
  }

  return resolveAnimatorWorkloadName(animator, descriptor);
}
