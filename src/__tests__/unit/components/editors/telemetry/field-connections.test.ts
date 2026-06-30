import { describe, expect, it } from "vitest";
import {
  buildFieldConnectionHintsByModelPath,
  getConnectionHint,
  getConnectionTooltip,
} from "../../../../../renderer/components/editors/telemetry/view/field-connections";

describe("field connection hints (ID-based models/workloads)", () => {
  it("matches live telemetry paths keyed by workload ids while displaying workload names", () => {
    const hintsByModelPath = buildFieldConnectionHintsByModelPath([
      {
        modelPath: "models/expression.model.yaml",
        modelShortName: "expression",
        modelName: "Expression",
        data: {
          id: "expression_model",
          workloads: [
            { id: "anim_wid", name: "anim_clips_evaluator" },
            { id: "spine_state_wid", name: "spine_control_state" },
          ],
          connections: [
            {
              from: "anim_wid.outputs.channels.shiver_amount_norm",
              to: "spine_state_wid.inputs.state.shiver_amount_norm",
            },
          ],
        },
      },
    ]);

    const hints = new Map(
      Object.entries(hintsByModelPath.get("models/expression.model.yaml") ?? {})
    );
    const rawPathHint = getConnectionHint(
      "spine_state_wid.inputs.state.shiver_amount_norm",
      hints
    );
    const friendlyPathHint = getConnectionHint(
      "spine_control_state.inputs.state.shiver_amount_norm",
      hints
    );

    expect(rawPathHint?.localIncomingFrom).toContain(
      "anim_clips_evaluator.outputs.channels.shiver_amount_norm"
    );
    expect(friendlyPathHint?.localIncomingFrom).toContain(
      "anim_clips_evaluator.outputs.channels.shiver_amount_norm"
    );
    expect(
      getConnectionTooltip(
        "spine_state_wid.inputs.state.shiver_amount_norm",
        rawPathHint
      )
    ).toContain("anim_clips_evaluator.outputs.channels.shiver_amount_norm");
  });

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
    const rawPathHint = getConnectionHint(
      "wid_a.inputs.x",
      new Map(Object.entries(modelAHints ?? {}))
    );
    expect(hint).toBeTruthy();
    expect(rawPathHint).toBeTruthy();

    const tooltip = getConnectionTooltip("alpha.inputs.x", hint);
    expect(tooltip).toContain("from (remote):");
    expect(tooltip).toContain("model_B.beta.outputs.y");
    expect(getConnectionTooltip("wid_a.inputs.x", rawPathHint)).toContain(
      "model_B.beta.outputs.y"
    );
  });
});
