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

    for (const node of doc.nodes.values()) {
      if (node.kind !== "workload") {
        continue;
      }
      const section = doc.sections[node.meta?.section ?? -1];
      expect(section?.frame).toBeDefined();
      expect(node.x).toBeGreaterThanOrEqual(section.frame!.x);
      expect(node.x + node.w).toBeLessThanOrEqual(section.frame!.x + section.frame!.width);
      expect(node.y).toBeGreaterThanOrEqual(section.frame!.y);
      expect(node.y + node.h).toBeLessThanOrEqual(section.frame!.y + section.frame!.height);
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
    await buildGraphDocFromModel(store, doc);

    expect(doc.edges).toHaveLength(1);
    expect(doc.edges[0].from).toBe("source:a");
    expect(doc.edges[0].to).toBe("source:b");
    expect(doc.edges[0].routePoints?.length).toBeGreaterThanOrEqual(2);
    expect(doc.edges.every((edge) => doc.getNode(edge.from) && doc.getNode(edge.to))).toBe(
      true,
    );
  });

  it("keeps every expanded model workload inside its own rendered section", async () => {
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
    const makeModel = (id: string, names: string[]): FakeModel => ({
      name: id,
      root: { workload_id: "root" },
      workloads: [
        {
          id: "root",
          name: "root",
          type: "SequencedGroupWorkload",
          children: names.map((name) => ({ workload_id: name })),
        },
        ...names.map((name) => ({
          id: name,
          name,
          type: "Workload",
        })),
      ],
      connections: names.slice(0, -1).map((name, index) => ({
        from: `${name}.out`,
        to: `${names[index + 1]}.in`,
      })),
    });
    const models = new Map<string, FakeModel>([
      ["mind", makeModel("mind", ["mind_a", "mind_b", "mind_c"])],
      ["animator", makeModel("animator", ["anim_a", "anim_b", "anim_c", "anim_d"])],
      ["mapping", makeModel("mapping", ["mapping_a"])],
      ["spine", makeModel("spine", ["spine_a", "spine_b", "spine_c"])],
      ["simulator", makeModel("simulator", ["sim_a", "sim_b", "sim_c"])],
    ]);
    models.get("mind")!.remote_models = [
      {
        model_id: "animator",
        connections: [{ from_local: "mind_c.out", to_remote: "anim_a.in" }],
      },
    ];
    models.get("animator")!.remote_models = [
      {
        model_id: "spine",
        connections: [{ from_local: "anim_d.out", to_remote: "spine_a.in" }],
      },
    ];
    models.get("spine")!.remote_models = [
      {
        model_id: "simulator",
        connections: [{ from_local: "spine_c.out", to_remote: "sim_a.in" }],
      },
    ];

    const store = {
      getModelIds: () => Array.from(models.keys()),
      get: (modelId: string) => models.get(modelId),
      getModelSourcePath: (modelId: string) => `${modelId}.model.yaml`,
      laneChildren: (modelId: string) => {
        const model = models.get(modelId)!;
        const root = model.workloads.find((workload) => workload.id === "root")!;
        return root.children?.map((child) => child.workload_id) ?? [];
      },
    } as unknown as Parameters<typeof buildGraphDocFromModel>[0];

    const doc = new GraphDoc();
    await buildGraphDocFromModel(store, doc);

    for (const node of doc.nodes.values()) {
      if (node.kind !== "workload") {
        continue;
      }
      const section = doc.sections[node.meta?.section ?? -1];
      expect(section?.frame).toBeDefined();
      expect(node.x).toBeGreaterThanOrEqual(section.frame!.x);
      expect(node.x + node.w).toBeLessThanOrEqual(section.frame!.x + section.frame!.width);
      expect(node.y).toBeGreaterThanOrEqual(section.frame!.y);
      expect(node.y + node.h).toBeLessThanOrEqual(section.frame!.y + section.frame!.height);
    }

    for (const edge of doc.edges) {
      const source = doc.getNode(edge.from);
      const target = doc.getNode(edge.to);
      expect(source).toBeDefined();
      expect(target).toBeDefined();
      expect(edge.routePoints?.length).toBeGreaterThanOrEqual(2);
      expect(distanceToRect(edge.routePoints![0], source!)).toBe(0);
      expect(distanceToRect(edge.routePoints![edge.routePoints!.length - 1], target!)).toBe(0);
    }
  });

  it("keeps in-model threads as horizontal sibling columns while routing cross-thread edges separately", async () => {
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

    const model: FakeModel = {
      name: "Animator",
      root: { workload_id: "root" },
      workloads: [
        {
          id: "root",
          name: "Root",
          type: "SyncedGroupWorkload",
          children: [{ workload_id: "thread_a" }, { workload_id: "thread_b" }],
        },
        { id: "thread_a", name: "Thread A", type: "Workload" },
        { id: "thread_b", name: "Thread B", type: "Workload" },
        { id: "a1", name: "A1", type: "Workload" },
        { id: "a2", name: "A2", type: "Workload" },
        { id: "b1", name: "B1", type: "Workload" },
        { id: "b2", name: "B2", type: "Workload" },
      ],
      connections: [
        { from: "a1.out", to: "a2.in" },
        { from: "b1.out", to: "b2.in" },
        { from: "a2.out", to: "b1.in" },
      ],
    };

    const store = {
      getModelIds: () => ["animator"],
      get: () => model,
      getModelSourcePath: () => "animator.model.yaml",
      laneChildren: (_modelId: string, lane: number) =>
        lane === 0 ? ["a1", "a2"] : lane === 1 ? ["b1", "b2"] : [],
    } as unknown as Parameters<typeof buildGraphDocFromModel>[0];

    const doc = new GraphDoc();
    await buildGraphDocFromModel(store, doc);

    expect(doc.sections).toHaveLength(1);
    const [section] = doc.sections;
    expect(section.lanes).toHaveLength(2);
    expect(section.lanes?.[1].frame.x).toBeGreaterThan(
      section.lanes![0].frame.x + section.lanes![0].frame.width,
    );

    const lane0Nodes = Array.from(doc.nodes.values()).filter(
      (node) => node.kind === "workload" && node.lane === 0,
    );
    const lane1Nodes = Array.from(doc.nodes.values()).filter(
      (node) => node.kind === "workload" && node.lane === 1,
    );
    expect(lane0Nodes.length).toBeGreaterThan(0);
    expect(lane1Nodes.length).toBeGreaterThan(0);

    for (const node of lane0Nodes) {
      expect(node.x).toBeGreaterThanOrEqual(section.lanes![0].frame.x);
      expect(node.x + node.w).toBeLessThanOrEqual(
        section.lanes![0].frame.x + section.lanes![0].frame.width,
      );
    }
    for (const node of lane1Nodes) {
      expect(node.x).toBeGreaterThanOrEqual(section.lanes![1].frame.x);
      expect(node.x + node.w).toBeLessThanOrEqual(
        section.lanes![1].frame.x + section.lanes![1].frame.width,
      );
    }

    const crossThreadEdge = doc.edges.find(
      (edge) => edge.from === "animator:a2" && edge.to === "animator:b1",
    );
    expect(crossThreadEdge?.isInterThread).toBe(true);
    expect(crossThreadEdge?.isRemote).not.toBe(true);
    expect(crossThreadEdge?.routePoints?.length).toBeGreaterThanOrEqual(2);
  });
});

function distanceToRect(
  point: { x: number; y: number },
  node: Node,
): number {
  const closestX = Math.max(node.x, Math.min(point.x, node.x + node.w));
  const closestY = Math.max(node.y, Math.min(point.y, node.y + node.h));
  return Math.hypot(point.x - closestX, point.y - closestY);
}
