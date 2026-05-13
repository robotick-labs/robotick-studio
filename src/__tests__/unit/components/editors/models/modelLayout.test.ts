import { describe, expect, it } from "vitest";

import { GraphDoc, type Node, type Section } from "../../../../../renderer/components/editors/models/view/node-graph/layout/editorNodeGraph";
import { buildGraphDocFromModel, positionModelHeaders } from "../../../../../renderer/components/editors/models/view/node-graph/layout/buildGraphDocFromModel";

function createModelNode(
  section: number,
  label: string,
  width: number,
  kind: "model" | "collapsed-model" = "model"
): Node {
  return {
    id: `${label}:model`,
    kind,
    label,
    x: 0,
    y: 0,
    w: width,
    h: 52,
    lane: 0,
    meta: {
      modelId: label,
      section,
      collapsed: kind === "collapsed-model",
    },
  };
}

function createWorkloadNode(section: number, lane: number, x: number, y: number): Node {
  return {
    id: `workload:${section}:${lane}:${x}:${y}`,
    kind: "workload",
    label: "workload",
    x,
    y,
    w: 140,
    h: 40,
    lane,
      meta: {
        modelId: `model-${section}`,
        section,
        slot: 0,
        layoutDirection: "vertical-offset",
      },
    };
}

describe("positionModelHeaders", () => {
  it("places vertical model headers on a shared row with non-overlapping x positions", () => {
    const doc = new GraphDoc();
    const sections: Section[] = [
      {
        index: 0,
        modelId: "mind",
        yStart: 40,
        laneCount: 0,
        laneHeight: 0,
        maxNodes: 0,
        labelY: 48,
        collapsed: true,
        layoutDirection: "vertical-offset",
      },
      {
        index: 1,
        modelId: "animator",
        yStart: 220,
        laneCount: 1,
        laneHeight: 400,
        maxNodes: 4,
        labelY: 210,
        collapsed: false,
        layoutDirection: "vertical-offset",
      },
      {
        index: 2,
        modelId: "face",
        yStart: 680,
        laneCount: 1,
        laneHeight: 200,
        maxNodes: 2,
        labelY: 670,
        collapsed: false,
        layoutDirection: "vertical-offset",
      },
    ];
    doc.setSections(sections);
    doc.upsertNode(createModelNode(0, "mind", 280, "collapsed-model"));
    doc.upsertNode(createModelNode(1, "animator", 320));
    doc.upsertNode(createModelNode(2, "face", 300));
    doc.upsertNode(createWorkloadNode(1, 0, 120, 120));
    doc.upsertNode(createWorkloadNode(2, 0, 520, 160));

    positionModelHeaders(doc);

    const mind = doc.getNode("mind:model");
    const animator = doc.getNode("animator:model");
    const face = doc.getNode("face:model");
    expect(mind).toBeDefined();
    expect(animator).toBeDefined();
    expect(face).toBeDefined();

    expect(mind?.y).toBe(animator?.y);
    expect(animator?.y).toBe(face?.y);

    expect(animator!.x).toBeGreaterThan(mind!.x + mind!.w);
    expect(face!.x).toBeGreaterThan(animator!.x + animator!.w);
  });

});

describe("buildGraphDocFromModel", () => {
  it("lays vertical model headers in a horizontal row even when most models are collapsed", async () => {
    type FakeWorkload = {
      id: string;
      name: string;
      type: string;
      children?: Array<{ workload_id: string }>;
    };
    type FakeModel = {
      name: string;
      root: { workload_id: string };
      workloads: FakeWorkload[];
      connections?: Array<{ from: string; to: string }>;
      remote_models?: Array<{
        model_id: string;
        connections?: Array<{
          from_local?: string;
          to_remote?: string;
          from_remote?: string;
          to_local?: string;
        }>;
      }>;
      telemetry?: { port?: number };
    };

    const models = new Map<string, FakeModel>([
      [
        "mind",
        {
          name: "Mind",
          root: { workload_id: "mind_root" },
          workloads: [{ id: "mind_root", name: "Mind Root", type: "Workload" }],
        },
      ],
      [
        "animator",
        {
          name: "Animator",
          root: { workload_id: "anim_root" },
          workloads: [
            { id: "anim_root", name: "Animator Root", type: "Workload" },
            { id: "w1", name: "One", type: "Workload" },
            { id: "w2", name: "Two", type: "Workload" },
          ],
          connections: [{ from: "w1.out", to: "w2.in" }],
        },
      ],
      [
        "face",
        {
          name: "Face",
          root: { workload_id: "face_root" },
          workloads: [{ id: "face_root", name: "Face Root", type: "Workload" }],
        },
      ],
      [
        "spine",
        {
          name: "Spine",
          root: { workload_id: "spine_root" },
          workloads: [{ id: "spine_root", name: "Spine Root", type: "Workload" }],
        },
      ],
    ]);

    const laneChildren = new Map<string, string[]>([
      ["mind:0", ["mind_root"]],
      ["animator:0", ["w1", "w2"]],
      ["face:0", ["face_root"]],
      ["spine:0", ["spine_root"]],
    ]);

    const store = {
      getModelIds: () => Array.from(models.keys()),
      get: (modelId: string) => models.get(modelId),
      getModelSourcePath: (modelId: string) => `${modelId}.model.yaml`,
      laneChildren: (modelId: string, lane: number) =>
        laneChildren.get(`${modelId}:${lane}`) ?? [],
    } as unknown as Parameters<typeof buildGraphDocFromModel>[0];

    const doc = new GraphDoc();
    await buildGraphDocFromModel(store, doc, {
      layoutDirection: "vertical-offset",
      collapsedModelIds: ["mind", "face", "spine"],
    });

    const modelNodes = Array.from(doc.nodes.values())
      .filter((node) => node.kind === "model" || node.kind === "collapsed-model")
      .sort((left, right) => (left.meta?.section ?? 0) - (right.meta?.section ?? 0));

    expect(modelNodes).toHaveLength(4);
    const sharedY = modelNodes[0].y;
    for (const node of modelNodes) {
      expect(node.y).toBe(sharedY);
    }
    for (let i = 1; i < modelNodes.length; i++) {
      expect(modelNodes[i].x).toBeGreaterThan(modelNodes[i - 1].x + modelNodes[i - 1].w);
    }
  });

  it("does not pass remote edges with missing rendered endpoints to ELK", async () => {
    type FakeWorkload = {
      id: string;
      name: string;
      type: string;
      children?: Array<{ workload_id: string }>;
    };
    type FakeModel = {
      name: string;
      root: { workload_id: string };
      workloads: FakeWorkload[];
      connections?: Array<{ from: string; to: string }>;
      remote_models?: Array<{
        model_id: string;
        connections?: Array<{
          from_local?: string;
          to_remote?: string;
          from_remote?: string;
          to_local?: string;
        }>;
      }>;
      telemetry?: { port?: number };
    };

    const models = new Map<string, FakeModel>([
      [
        "source",
        {
          name: "Source",
          root: { workload_id: "source_root" },
          workloads: [
            { id: "source_root", name: "Source Root", type: "Workload" },
            { id: "a", name: "A", type: "Workload" },
            { id: "b", name: "B", type: "Workload" },
          ],
          connections: [{ from: "a.out", to: "b.in" }],
          remote_models: [
            {
              model_id: "missing-model",
              connections: [{ from_local: "a.out", to_remote: "ghost.in" }],
            },
          ],
        },
      ],
    ]);

    const store = {
      getModelIds: () => Array.from(models.keys()),
      get: (modelId: string) => models.get(modelId),
      getModelSourcePath: (modelId: string) => `${modelId}.model.yaml`,
      laneChildren: (modelId: string, lane: number) =>
        modelId === "source" && lane === 0 ? ["a", "b"] : [],
    } as unknown as Parameters<typeof buildGraphDocFromModel>[0];

    const doc = new GraphDoc();
    await buildGraphDocFromModel(store, doc, {
      layoutDirection: "vertical-offset",
    });

    expect(doc.edges).toHaveLength(1);
    expect(doc.edges[0].from).toBe("source:a");
    expect(doc.edges[0].to).toBe("source:b");
    expect(doc.edges[0].routePoints?.length).toBeGreaterThanOrEqual(2);
    expect(doc.edges.every((edge) => doc.getNode(edge.from) && doc.getNode(edge.to))).toBe(
      true,
    );
  });
});
