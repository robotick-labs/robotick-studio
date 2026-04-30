import { describe, expect, it } from "vitest";
import { migrateSelectionToStableIds } from "../../../../../renderer/components/editors/telemetry/utils/persisted-selection-migration";

describe("migrateSelectionToStableIds", () => {
  const projectModels = [
    {
      modelPath: "robots/demo/models/demo-brain.model.yaml",
      modelName: "Demo Brain",
      telemetryBaseUrl: "http://demo-brain:7001",
      data: {
        id: "brain_model_ABC123",
        workloads: [
          { id: "vision_wl_X1", name: "vision" },
          { id: "logic_wl_X2", name: "logic" },
        ],
      },
    },
    {
      modelPath: "robots/demo/models/demo-spine.model.yaml",
      modelName: "Demo Spine",
      telemetryBaseUrl: "http://demo-spine:7002",
      data: {
        id: "spine_model_DEF456",
        workloads: [{ id: "motor_wl_M1", name: "motor" }],
      },
    },
  ];

  it("upgrades legacy model name/workload name selection to IDs", () => {
    const migrated = migrateSelectionToStableIds(
      {
        modelName: "Demo Brain",
        workloadName: "vision",
        fieldPath: "vision.outputs.rgb",
      },
      projectModels
    );

    expect(migrated.modelId).toBe("brain_model_ABC123");
    expect(migrated.modelPath).toBe("robots/demo/models/demo-brain.model.yaml");
    expect(migrated.workloadId).toBe("vision_wl_X1");
    expect(migrated.workloadName).toBe("vision");
    expect(migrated.fieldPath).toBe("vision.outputs.rgb");
  });

  it("prefers stable IDs and rewrites renamed workload prefixes in field paths", () => {
    const renamedModels = [
      {
        ...projectModels[0],
        data: {
          id: "brain_model_ABC123",
          workloads: [{ id: "vision_wl_X1", name: "visual_pipeline" }],
        },
      },
    ];

    const migrated = migrateSelectionToStableIds(
      {
        modelId: "brain_model_ABC123",
        workloadId: "vision_wl_X1",
        workloadName: "vision",
        fieldPath: "vision.outputs.rgb",
      },
      renamedModels
    );

    expect(migrated.workloadName).toBe("visual_pipeline");
    expect(migrated.fieldPath).toBe("visual_pipeline.outputs.rgb");
  });
});

