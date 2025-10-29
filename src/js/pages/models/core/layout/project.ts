import { GraphDoc, type Node, type Edge, type Section } from "../graphDoc";
import { ModelStore } from "../modelStore";
import { idFor } from "../utils/ids";

const nodeSize = { width: 140, height: 40 } as const;
const startX = 120,
  spacing = 180,
  laneHeight = 100;
const lanePadY = (laneHeight - nodeSize.height) / 2;

export interface LayoutSummary {
  sections: Section[];
  totalHeight: number;
  globalMaxNodes: number;
}

export function projectModelToDoc(
  store: ModelStore,
  doc: GraphDoc
): LayoutSummary {
  doc.sections = [];
  doc.version++;
  const edges: Edge[] = [];
  let yOffset = 40,
    globalMaxNodes = 0,
    sectionIndex = 0;

  for (const modelId of store.getModelIds()) {
    const m = store.get(modelId)!;
    const root = m.workloads.find((w) => w.name === m.root)!;
    const lanes =
      root.type === "SyncedGroupWorkload" ? root.children ?? [] : [root.name];

    let maxSlots = 0;
    for (let lane = 0; lane < lanes.length; lane++) {
      const laneY = yOffset + lane * laneHeight;
      const names = store.laneChildren(modelId, lane);
      maxSlots = Math.max(maxSlots, names.length);
      // place each workload at (slotIndex)
      names.forEach((localName, slot) => {
        const id = idFor(modelId, localName);
        const node: Node = {
          id,
          kind: "workload",
          label: localName,
          x: startX + slot * spacing,
          y: laneY + lanePadY,
          w: nodeSize.width,
          h: nodeSize.height,
          lane,
          meta: { modelId, section: sectionIndex },
        };
        doc.upsertNode(node);
      });
      // group box spans 0..(names.length-1)
      const parentName = lanes[lane];
      const group: Node = {
        id: idFor(modelId, parentName),
        kind: "group",
        label: parentName,
        x: startX - 20,
        y: laneY + lanePadY - 10,
        w: Math.max(names.length, 1) * spacing,
        h: nodeSize.height + 20,
        lane,
        meta: {
          modelId,
          section: sectionIndex,
          children: names.map((n) => idFor(modelId, n)),
        },
      };
      doc.upsertNode(group);
    }

    // edges
    for (const c of m.connections ?? []) {
      edges.push({
        from: idFor(modelId, c.from.split(".")[0]),
        to: idFor(modelId, c.to.split(".")[0]),
      });
    }
    for (const r of m.remote_models ?? []) {
      for (const c of r.connections ?? []) {
        edges.push({
          from: idFor(modelId, c.from.split(".")[0]),
          to: `${r.name}:${c.to_remote.split(".")[0]}`,
          isRemote: true,
        });
      }
    }

    doc.sections.push({
      index: sectionIndex,
      modelId,
      yStart: yOffset,
      laneCount: lanes.length,
      laneHeight,
      maxNodes: maxSlots,
      labelY: yOffset - 10,
    });

    globalMaxNodes = Math.max(globalMaxNodes, maxSlots);
    yOffset += lanes.length * laneHeight + 60;
    sectionIndex++;
  }

  doc.setEdges(edges);
  return { sections: doc.sections, totalHeight: yOffset, globalMaxNodes };
}
