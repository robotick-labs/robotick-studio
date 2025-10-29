import { describe, it, expect } from "vitest";
import { buildInitialDoc } from "../core/layout/layout";
import { GraphDoc } from "../core/graphDoc";
import type { LoadedModel } from "../services/projectModelsLoader";

const sample: LoadedModel = {
  modelPath: "foo.model.yaml",
  data: {
    root: "Root",
    workloads: [
      { name: "Root", type: "SyncedGroupWorkload", children: ["A", "B"] },
      { name: "A" },
      { name: "B" },
    ],
    connections: [{ from: "A.inputs.x", to: "B.inputs.y" }],
  },
};

describe("layout", () => {
  it("creates nodes and edges", () => {
    const doc = new GraphDoc();
    buildInitialDoc(doc, [sample]);
    expect(doc.nodes.size).toBeGreaterThan(0);
    expect(doc.edges.length).toBe(1);
  });
});
