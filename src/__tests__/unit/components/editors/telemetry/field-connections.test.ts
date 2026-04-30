import { describe, expect, it } from "vitest";
import {
  buildFieldConnectionHintsByModelPath,
  getConnectionHint,
  getConnectionTooltip,
} from "../../../../../renderer/components/editors/telemetry/view/field-connections";

describe("field connection hints (ID-based models/workloads)", () => {
  it("builds incoming remote tooltip from model_id and workload-id endpoints", () => {
    const hintsByModelPath = buildFieldConnectionHintsByModelPath([
      {
        modelPath: "models/a.model.yaml",
        modelShortName: "a",
        modelName: "Model A",
        data: {
          id: "model_A",
          workloads: [{ id: "wid_a", name: "alpha" }],
          remote_models: [
            {
              model_id: "model_B",
              connections: [
                {
                  from_remote: "wid_b.outputs.y",
                  to_local: "wid_a.inputs.x",
                },
              ],
            },
          ],
        },
      },
      {
        modelPath: "models/b.model.yaml",
        modelShortName: "b",
        modelName: "Model B",
        data: {
          id: "model_B",
          workloads: [{ id: "wid_b", name: "beta" }],
        },
      },
    ]);

    const modelAHints = hintsByModelPath.get("models/a.model.yaml");
    expect(modelAHints).toBeTruthy();
    const hint = getConnectionHint(
      "alpha.inputs.x",
      new Map(Object.entries(modelAHints ?? {}))
    );
    expect(hint).toBeTruthy();

    const tooltip = getConnectionTooltip("alpha.inputs.x", hint);
    expect(tooltip).toContain("from (remote):");
    expect(tooltip).toContain("model_B.wid_b.outputs.y");
  });
});
