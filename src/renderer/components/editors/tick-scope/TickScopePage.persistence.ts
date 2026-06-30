import { definePanelPersistence } from "../../workbenches/PanelInstanceContext";
import type { ModelSortKey } from "../telemetry/view/TelemetryApp";

export type TickScopePanelSettings = {
  modelSortKey: ModelSortKey;
  smoothingDurationSeconds: number;
  showCpuIds: boolean;
};

export function isModelSortKey(value: unknown): value is ModelSortKey {
  return (
    value === "telemetry_port" ||
    value === "model_name" ||
    value === "model_path" ||
    value === "memory_process" ||
    value === "memory_workloads"
  );
}

export const tickScopePagePersistence =
  definePanelPersistence<TickScopePanelSettings>({
    schemaVersion: 1,
    defaults: {
      modelSortKey: "telemetry_port",
      smoothingDurationSeconds: 0,
      showCpuIds: false,
    },
    sanitize(value) {
      const input =
        value && typeof value === "object"
          ? (value as Partial<TickScopePanelSettings>)
          : {};
      const smoothingDurationSeconds = Number(input.smoothingDurationSeconds);
      return {
        modelSortKey: isModelSortKey(input.modelSortKey)
          ? input.modelSortKey
          : "telemetry_port",
        smoothingDurationSeconds:
          Number.isFinite(smoothingDurationSeconds) && smoothingDurationSeconds > 0
            ? smoothingDurationSeconds
            : 0,
        showCpuIds: input.showCpuIds === true,
      };
    },
  });
