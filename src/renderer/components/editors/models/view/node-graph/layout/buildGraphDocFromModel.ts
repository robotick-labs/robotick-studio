import {
  GraphDoc,
  type Node,
  type Edge,
  type Section,
} from "./editorNodeGraph";
import type { DocumentStore } from "../../../document/documentStore";
import type { Workload } from "../../../document/modelData";

const nodeSize = { width: 140, height: 40 } as const;
const startX = 120,
  spacing = 180,
  laneHeight = 200;
const lanePadY = (laneHeight - nodeSize.height) / 2;

export interface LayoutSummary {
  sections: Section[];
  totalHeight: number;
  globalMaxNodes: number;
}

/**
 * Create a namespaced node identifier for an item defined in a model file.
 *
 * @param modelPath - Filesystem path or module path to the model file; the model's file name (without its directory) is used as the namespace
 * @param id - Local identifier of the item within the model
 * @returns A string in the form `basename:localId`, where `basename` is the model file name with the `.model.yaml` extension removed
 */
export function nodeIdFor(modelPath: string, id: string): string {
  const base =
    modelPath
      .split("/")
      .pop()
      ?.replace(/\.model\.yaml$/, "") ?? "";
  return `${base}:${id}`;
}

/**
 * Builds a graph document of workloads and their inter-model connections from a DocumentStore and returns layout metadata.
 *
 * @param store - The DocumentStore containing models, workloads, connections, and lane information to render.
 * @param doc - The GraphDoc to populate; existing sections are replaced and nodes/edges are upserted.
 * @returns A LayoutSummary containing the document's sections, the total vertical height of the layout in pixels, and the maximum number of nodes present in any section.
 */
export function buildGraphDocFromModel(
  store: DocumentStore,
  doc: GraphDoc
): LayoutSummary {
  doc.sections = [];
  const edges: Edge[] = [];
  let yOffset = 40,
    globalMaxNodes = 0,
    sectionIndex = 0;

  for (const modelId of store.getModelIds()) {
    const m = store.get(modelId)!;
    const root = m.workloads.find((w: Workload) => w.name === m.root)!;
    const lanes =
      root.type === "SyncedGroupWorkload" ? root.children ?? [] : [root.name];

    let maxSlots = 0;
    for (let lane = 0; lane < lanes.length; lane++) {
      const laneY = yOffset + lane * laneHeight;
      const names = store.laneChildren(modelId, lane);
      maxSlots = Math.max(maxSlots, names.length);

      names.forEach((localName: string, slot: number) => {
        const id = nodeIdFor(modelId, localName);
        const workload = m.workloads.find(
          (w: Workload) => w.name === localName
        );
        if (!workload) return;
        const node: Node = {
          id,
          kind: "workload",
          label: localName,
          x: startX + slot * spacing,
          y: laneY + lanePadY,
          w: nodeSize.width,
          h: nodeSize.height,
          lane,
          workload,
          meta: { modelId, section: sectionIndex },
        };
        doc.upsertNode(node);
      });

      const parentName = lanes[lane];
      const groupWorkload = m.workloads.find(
        (w: Workload) => w.name === parentName
      );
      if (groupWorkload && groupWorkload.children == null) {
        const group: Node = {
          id: nodeIdFor(modelId, parentName),
          kind: "workload",
          label: parentName,
          x: startX,
          y: laneY + lanePadY,
          w: nodeSize.width,
          h: nodeSize.height,
          lane,
          meta: {
            modelId,
            section: sectionIndex,
            children: names.map((n: string) => nodeIdFor(modelId, n)),
          },
        };
        doc.upsertNode(group);
      }
    }

    for (const c of m.connections ?? []) {
      edges.push({
        from: nodeIdFor(modelId, c.from.split(".")[0]),
        to: nodeIdFor(modelId, c.to.split(".")[0]),
      });
    }
    for (const r of m.remote_models ?? []) {
      for (const c of r.connections ?? []) {
        if (typeof c.from === "string" && typeof c.to_remote === "string") {
          edges.push({
            from: nodeIdFor(modelId, c.from.split(".")[0]),
            to: `${r.name}:${c.to_remote.split(".")[0]}`,
            isRemote: true,
          });
        } else if (
          typeof c.from_remote === "string" &&
          typeof c.to === "string"
        ) {
          edges.push({
            from: `${r.name}:${c.from_remote.split(".")[0]}`,
            to: nodeIdFor(modelId, c.to.split(".")[0]),
            isRemote: true,
          });
        }
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
