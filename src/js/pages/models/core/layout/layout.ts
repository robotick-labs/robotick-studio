import type {
  LoadedModel,
  ModelData,
  Workload,
} from "../../services/projectModelsLoader";
import { GraphDoc, type Edge, type Node, type Section } from "../graphDoc";
import { idFor } from "../utils/ids";

const nodeSize = { width: 140, height: 40 } as const;
const startX = 120;
const spacing = 180;
const laneHeight = 100;
const laneYPad = (laneHeight - nodeSize.height) / 2;

/** Summary used by the caller to size the canvas like the original models.ts did. */
export interface LayoutSummary {
  sections: Section[];
  totalHeight: number;
  globalMaxNodes: number;
}

/** Populates doc and returns layout summary (for viewport sizing). */
export function buildInitialDoc(
  doc: GraphDoc,
  models: LoadedModel[]
): LayoutSummary {
  const allEdges: Edge[] = [];
  const sections: Section[] = [];
  let yOffset = 40;
  let globalMaxNodes = 0;
  let sectionIndex = 0;

  for (const m of models) {
    const model = m.data;
    const root = model.workloads.find((w) => w.name === model.root);
    if (!root) continue;

    const lanes: Workload[] = collectLanes(model);
    let maxNodesInSection = 0;

    // place lanes
    for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
      const parent = lanes[laneIdx];
      const laneY = yOffset + laneIdx * laneHeight;

      if (parent.children && parent.children.length) {
        const children = parent.children
          .map((id) => model.workloads.find((w) => w.name === id))
          .filter(Boolean) as Workload[];

        children.forEach((child, j) => {
          const node: Node = {
            id: idFor(m.modelPath, child.name),
            kind: "workload",
            label: child.name,
            x: startX + j * spacing,
            y: laneY + laneYPad,
            w: nodeSize.width,
            h: nodeSize.height,
            lane: laneIdx,
            meta: { modelId: m.modelPath, section: sectionIndex },
          };
          doc.upsertNode(node);
        });

        const groupWidth = Math.max(children.length, 1) * spacing;
        const group: Node = {
          id: idFor(m.modelPath, parent.name),
          kind: "group",
          label: parent.name,
          x: startX - 20,
          y: laneY + laneYPad - 10,
          w: groupWidth,
          h: nodeSize.height + 20,
          lane: laneIdx,
          meta: {
            modelId: m.modelPath,
            children: children.map((c) => idFor(m.modelPath, c.name)),
            section: sectionIndex,
          },
        };
        doc.upsertNode(group);

        maxNodesInSection = Math.max(maxNodesInSection, children.length);
      } else {
        const node: Node = {
          id: idFor(m.modelPath, parent.name),
          kind: "workload",
          label: parent.name,
          x: startX,
          y: laneY + laneYPad,
          w: nodeSize.width,
          h: nodeSize.height,
          lane: laneIdx,
          meta: { modelId: m.modelPath, section: sectionIndex },
        };
        doc.upsertNode(node);
        maxNodesInSection = Math.max(maxNodesInSection, 1);
      }
    }

    // edges for this model
    const localEdges: Edge[] = (model.connections ?? []).map((dc) => ({
      from: idFor(m.modelPath, dc.from.split(".")[0]),
      to: idFor(m.modelPath, dc.to.split(".")[0]),
    }));
    const remoteEdges: Edge[] = [];
    for (const remote of model.remote_models ?? []) {
      const remoteModelId = remote.name;
      for (const dc of remote.connections ?? []) {
        const fromId = idFor(m.modelPath, dc.from.split(".")[0]);
        const toId = `${remoteModelId}:${dc.to_remote.split(".")[0]}`;
        remoteEdges.push({ from: fromId, to: toId, isRemote: true });
      }
    }
    allEdges.push(...localEdges, ...remoteEdges);

    const sectionHeight = lanes.length * laneHeight;
    sections.push({
      index: sectionIndex,
      modelId: m.modelPath,
      yStart: yOffset,
      laneCount: lanes.length,
      laneHeight,
      maxNodes: maxNodesInSection,
      labelY: yOffset - 10,
    });

    globalMaxNodes = Math.max(globalMaxNodes, maxNodesInSection);
    yOffset += sectionHeight + 60;
    sectionIndex++;
  }

  doc.setEdges(allEdges);
  doc.setSections(sections);

  return { sections, totalHeight: yOffset, globalMaxNodes };
}

function collectLanes(model: ModelData): Workload[] {
  const root = model.workloads.find((w) => w.name === model.root);
  if (!root) return [];
  if (root.type === "SyncedGroupWorkload") {
    const kids = (root.children ?? [])
      .map((id) => model.workloads.find((w) => w.name === id))
      .filter(Boolean) as Workload[];
    return kids;
  }
  return [root];
}
