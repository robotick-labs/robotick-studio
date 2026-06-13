import { describe, expect, it } from "vitest";
import type { ProjectModelDescriptor } from "@/data-sources/launcher";
import {
  resolveAnimatorModelDescriptor,
  resolveAnimatorTelemetryWorkloadName,
  resolveAnimatorWorkloadName,
} from "../../../../renderer/components/viewer/telemetry-animator-resolution";

function createDescriptor(overrides: Partial<ProjectModelDescriptor>): ProjectModelDescriptor {
  return {
    modelPath: "models/sample.model.yaml",
    modelName: "Sample",
    modelShortName: "sample",
    telemetryPort: 7090,
    telemetryBaseUrl: "http://localhost:7090",
    telemetryPushRateHz: 20,
    data: {},
    ...overrides,
  };
}

describe("telemetry animator resolution", () => {
  it("resolves model by stable modelId before legacy modelName", () => {
    const descriptors: ProjectModelDescriptor[] = [
      createDescriptor({
        modelName: "Expression",
        modelShortName: "barr-e-expression",
        data: { id: "animator_model_7K3M9Q2T" },
      }),
    ];

    const descriptor = resolveAnimatorModelDescriptor(
      { id: "a", modelId: "animator_model_7K3M9Q2T", modelName: "wrong" },
      descriptors
    );

    expect(descriptor?.modelShortName).toBe("barr-e-expression");
  });

  it("falls back to model name matching when modelId is absent", () => {
    const descriptors: ProjectModelDescriptor[] = [
      createDescriptor({
        modelName: "Barr.e Expression",
        modelShortName: "barr-e-expression",
      }),
    ];

    const descriptor = resolveAnimatorModelDescriptor(
      { id: "a", modelName: "BARR.E EXPRESSION" },
      descriptors
    );

    expect(descriptor?.modelShortName).toBe("barr-e-expression");
  });

  it("resolves workload by stable workloadId before workloadName", () => {
    const descriptor = createDescriptor({
      data: {
        workloads: [
          { id: "cochlear_visualizer_workload_BD141921", name: "cochlear_visualiser" },
        ],
      },
    });

    const workloadName = resolveAnimatorWorkloadName(
      { id: "a", workloadId: "cochlear_visualizer_workload_BD141921", workloadName: "old" },
      descriptor
    );

    expect(workloadName).toBe("cochlear_visualiser");
  });

  it("uses stable workloadId as the telemetry workload lookup key", () => {
    const descriptor = createDescriptor({
      data: {
        workloads: [
          { id: "cochlear_visualizer_workload_BD141921", name: "cochlear_visualiser" },
        ],
      },
    });

    const workloadName = resolveAnimatorTelemetryWorkloadName(
      { id: "a", workloadId: "cochlear_visualizer_workload_BD141921", workloadName: "old" },
      descriptor
    );

    expect(workloadName).toBe("cochlear_visualizer_workload_BD141921");
  });

  it("falls back to workloadName when workloadId is unresolved", () => {
    const workloadName = resolveAnimatorWorkloadName(
      { id: "a", workloadId: "missing", workloadName: "mic" },
      null
    );

    expect(workloadName).toBe("mic");
  });
});
