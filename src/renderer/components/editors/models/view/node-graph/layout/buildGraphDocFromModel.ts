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
const sectionHeaderX = 24;
const sectionHeaderHeight = 24;
const collapsedSectionHeight = 44;

export interface LayoutSummary {
  sections: Section[];
  totalHeight: number;
  globalMaxNodes: number;
}

export type BuildGraphOptions = {
  collapsedModelIds?: Iterable<string>;
};

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
  doc: GraphDoc,
  options: BuildGraphOptions = {}
): LayoutSummary {
  const collapsedModelIds = new Set(options.collapsedModelIds ?? []);

  doc.nodes.clear();
  doc.sections = [];
  const edges: Edge[] = [];
  const modelAliases = new Map<string, string>();
  const collapsedNodeIds = new Map<string, string>();
  const modelIds = store.getModelIds();
  for (const modelId of modelIds) {
    const base = modelBaseName(modelId);
    modelAliases.set(modelId, modelId);
    modelAliases.set(base, modelId);
  }

  let yOffset = 40,
    globalMaxNodes = 0,
    sectionIndex = 0;

  for (const modelId of modelIds) {
    const m = store.get(modelId)!;
    const root = m.workloads.find((w: Workload) => w.name === m.root)!;
    const lanes =
      root.type === "SyncedGroupWorkload" ? root.children ?? [] : [root.name];
    const hasSequencedGroup = m.workloads.some(
      (w: Workload) => w.type === "SequencedGroupWorkload"
    );
    const isCollapsed = collapsedModelIds.has(modelId);

    if (isCollapsed) {
      const labelY = yOffset + 8;
      const headerY = labelY - 16;
      const headerWidth = estimateSectionHeaderWidth(modelId);
      const collapsedNodeId = nodeIdFor(modelId, "__collapsed_model__");

      const collapsedNode: Node = {
        id: collapsedNodeId,
        kind: "collapsed-model",
        label: modelId,
        x: sectionHeaderX,
        y: headerY,
        w: headerWidth,
        h: sectionHeaderHeight,
        lane: 0,
        meta: { modelId, section: sectionIndex },
      };
      doc.upsertNode(collapsedNode);
      collapsedNodeIds.set(modelId, collapsedNodeId);

      doc.sections.push({
        index: sectionIndex,
        modelId,
        yStart: yOffset,
        laneCount: 0,
        laneHeight: 0,
        maxNodes: 0,
        labelY,
        rootType: root.type ?? "Workload",
        hasSequencedGroup,
        collapsed: true,
      });

      yOffset += collapsedSectionHeight;
      sectionIndex++;
      continue;
    }

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
        node.meta = {
          ...node.meta,
          type: workload.type,
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
            type: groupWorkload.type,
            children: names.map((n: string) => nodeIdFor(modelId, n)),
          },
        };
        doc.upsertNode(group);
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
      rootType: root.type ?? "Workload",
      hasSequencedGroup,
      collapsed: false,
    });

    globalMaxNodes = Math.max(globalMaxNodes, maxSlots);
    yOffset += lanes.length * laneHeight + 60;
    sectionIndex++;
  }

  for (const modelId of modelIds) {
    const m = store.get(modelId)!;
    const modelIsCollapsed = collapsedModelIds.has(modelId);

    if (!modelIsCollapsed) {
      for (const c of m.connections ?? []) {
        const from = resolveNodeId(
          modelAliases,
          collapsedNodeIds,
          modelId,
          c.from.split(".")[0],
          false
        );
        const to = resolveNodeId(
          modelAliases,
          collapsedNodeIds,
          modelId,
          c.to.split(".")[0],
          false
        );
        if (from && to) {
          edges.push({ from, to });
        }
      }
    }

    for (const r of m.remote_models ?? []) {
      const targetModelId = modelAliases.get(r.name) ?? r.name;
      for (const c of r.connections ?? []) {
        if (typeof c.from === "string" && typeof c.to_remote === "string") {
          const from = resolveNodeId(
            modelAliases,
            collapsedNodeIds,
            modelId,
            c.from.split(".")[0],
            true
          );
          const to = resolveNodeId(
            modelAliases,
            collapsedNodeIds,
            targetModelId,
            c.to_remote.split(".")[0],
            true
          );
          if (from && to) {
            edges.push({ from, to, isRemote: true });
          }
        } else if (
          typeof c.from_remote === "string" &&
          typeof c.to === "string"
        ) {
          const from = resolveNodeId(
            modelAliases,
            collapsedNodeIds,
            targetModelId,
            c.from_remote.split(".")[0],
            true
          );
          const to = resolveNodeId(
            modelAliases,
            collapsedNodeIds,
            modelId,
            c.to.split(".")[0],
            true
          );
          if (from && to) {
            edges.push({ from, to, isRemote: true });
          }
        }
      }
    }
  }

  doc.setEdges(edges);
  return { sections: doc.sections, totalHeight: yOffset, globalMaxNodes };
}

function modelBaseName(modelId: string): string {
  return (
    modelId
      .split("/")
      .pop()
      ?.replace(/\.model\.yaml$/, "") ?? modelId
  );
}

function resolveNodeId(
  modelAliases: Map<string, string>,
  collapsedNodeIds: Map<string, string>,
  modelRef: string,
  workloadName: string,
  allowCollapsedAnchor: boolean
): string | null {
  const canonicalModelId = modelAliases.get(modelRef) ?? modelRef;
  if (allowCollapsedAnchor) {
    const collapsedNodeId = collapsedNodeIds.get(canonicalModelId);
    if (collapsedNodeId) {
      return collapsedNodeId;
    }
  }
  return nodeIdFor(canonicalModelId, workloadName);
}

function estimateSectionHeaderWidth(modelId: string): number {
  return Math.min(900, Math.max(220, 34 + modelId.length * 7));
}
