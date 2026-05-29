import { describe, expect, it, vi } from "vitest";

const getProjectModelsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../renderer/data-sources/launcher", () => ({
  launcherService: {
    getProjectModels: getProjectModelsMock,
  },
}));

import { loadAllModels } from "../../../../../renderer/components/editors/models/document/modelData";

describe("modelData strict id-ref parsing", () => {
  it("loads strict id-based model data", async () => {
    getProjectModelsMock.mockResolvedValue([
      {
        modelPath: "models/example.model.yaml",
        data: {
          id: "example_model_ABCD1234",
          name: "Example",
          comment: "Model-level description",
          root: { workload_id: "root_workload_1234" },
          workloads: [
            {
              id: "root_workload_1234",
              name: "root",
              comment: "Root workload description",
              type: "SequencedGroupWorkload",
              tick_rate_hz: 60,
              children: [{ workload_id: "worker_workload_5678" }],
              config: {},
              inputs: {},
            },
            {
              id: "worker_workload_5678",
              name: "worker",
              type: "WorkerWorkload",
              tick_rate_hz: 60,
              config: {},
              inputs: {},
              outputs: { done: true },
            },
          ],
          connections: [
            {
              from: "worker_workload_5678.outputs.done",
              to: "root_workload_1234.inputs.child_done",
            },
          ],
          remote_models: [
            {
              model_id: "remote_model_QWER9876",
              comment: "Remote model link",
              connections: [
                {
                  from_local: "worker_workload_5678.outputs.done",
                  to_remote: "remote_workload_ZZZZ1111.inputs.done",
                  comment: "Send done flag",
                },
              ],
            },
          ],
        },
      },
    ]);

    const loaded = await loadAllModels("/tmp/project");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.data.id).toBe("example_model_ABCD1234");
  });

  it("rejects legacy name-based shape", async () => {
    getProjectModelsMock.mockResolvedValue([
      {
        modelPath: "models/legacy.model.yaml",
        data: {
          name: "Legacy",
          root: "node",
          workloads: [
            {
              name: "node",
              type: "LegacyWorkload",
              tick_rate_hz: 60,
              config: {},
              inputs: {},
            },
          ],
        },
      },
    ]);

    await expect(loadAllModels("/tmp/project")).rejects.toThrow(
      "missing required top-level 'id'",
    );
  });

  it("rejects invalid telemetry push rate values", async () => {
    getProjectModelsMock.mockResolvedValue([
      {
        modelPath: "models/example.model.yaml",
        data: {
          id: "example_model_ABCD1234",
          root: { workload_id: "root_workload_1234" },
          telemetry: {
            telemetry_push_rate_hz: -1,
          },
          workloads: [
            {
              id: "root_workload_1234",
              name: "root",
              type: "SequencedGroupWorkload",
              tick_rate_hz: 60,
              config: {},
              inputs: {},
            },
          ],
        },
      },
    ]);

    await expect(loadAllModels("/tmp/project")).rejects.toThrow(
      "telemetry.telemetry_push_rate_hz must be a non-negative finite number",
    );
  });
});
