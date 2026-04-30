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
const modelHeaderYFromSectionStart = -52;
const modelHeaderHeight = 52;
const modelToNextHeaderGap = 40;

export interface LayoutSummary {
  sections: Section[];
  totalHeight: number;
  globalMaxNodes: number;
}

export type BuildGraphOptions = {
  collapsedModelIds?: Iterable<string>;
  modelSortKey?: ModelSortKey;
};

export type ModelSortKey = "telemetry_port" | "model_name" | "model_path";

/**
 * Create a namespaced node identifier for an item defined in a model file.
 *
 * @param modelPath - Filesystem path or module path to the model file; the model's file name (without its directory) is used as the namespace
 * @param id - Local identifier of the item within the model
 * @returns A string in the form `basename:localId`, where `basename` is the model file name with the `.model.yaml` extension removed
 */
export function nodeIdFor(modelPath: string, id: string): string {
  return `${modelPath}:${id}`;
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
  options: BuildGraphOptions = {},
): LayoutSummary {
  const collapsedModelIds = new Set(options.collapsedModelIds ?? []);

  doc.nodes.clear();
  doc.sections = [];
  const edges: Edge[] = [];
  const collapsedNodeIds = new Map<string, string>();
  const modelSortKey = options.modelSortKey ?? "model_path";
  const modelIds = store
    .getModelIds()
    .sort((left, right) => compareModelIds(store, left, right, modelSortKey));
  let yOffset = 40,
    globalMaxNodes = 0,
    sectionIndex = 0;

  for (const modelId of modelIds) {
    const m = store.get(modelId)!;
    const root = m.workloads.find(
      (w: Workload) => w.id === m.root.workload_id,
    )!;
    const lanes =
      root.type === "SyncedGroupWorkload"
        ? (root.children ?? []).map((child) => child.workload_id)
        : [root.id];
    const hasSequencedGroup = m.workloads.some(
      (w: Workload) => w.type === "SequencedGroupWorkload",
    );
    const isCollapsed = collapsedModelIds.has(modelId);
    const modelName =
      typeof m.name === "string" && m.name.trim()
        ? m.name
        : modelId;
    const modelNodeId = nodeIdFor(modelId, "__model__");
    const modelNode: Node = {
      id: modelNodeId,
      kind: isCollapsed ? "collapsed-model" : "model",
      label: modelName,
      x: sectionHeaderX,
      y: yOffset + modelHeaderYFromSectionStart,
      w: estimateModelHeaderWidth(
        modelName,
        modelFileName(store.getModelSourcePath(modelId) ?? modelId),
      ),
      h: modelHeaderHeight,
      lane: 0,
      meta: {
        modelId,
        section: sectionIndex,
        collapsed: isCollapsed,
        subtitle: modelFileName(store.getModelSourcePath(modelId) ?? modelId),
      },
    };
    doc.upsertNode(modelNode);

    if (isCollapsed) {
      const labelY = yOffset + 8;
      collapsedNodeIds.set(modelId, modelNodeId);

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

      yOffset += modelHeaderHeight + modelToNextHeaderGap;
      sectionIndex++;
      continue;
    }

    let maxSlots = 0;
    for (let lane = 0; lane < lanes.length; lane++) {
      const laneY = yOffset + lane * laneHeight;
      const workloadIds = store.laneChildren(modelId, lane);
      maxSlots = Math.max(maxSlots, workloadIds.length);

      workloadIds.forEach((workloadId: string, slot: number) => {
        const workload = m.workloads.find((w: Workload) => w.id === workloadId);
        if (!workload) return;
        const id = nodeIdFor(modelId, workload.id);
        const node: Node = {
          id,
          kind: "workload",
          label: workload.name,
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

      const parentId = lanes[lane];
      const groupWorkload = m.workloads.find(
        (w: Workload) => w.id === parentId,
      );
      if (groupWorkload && groupWorkload.children == null) {
        const group: Node = {
          id: nodeIdFor(modelId, parentId),
          kind: "workload",
          label: groupWorkload.name,
          x: startX,
          y: laneY + lanePadY,
          w: nodeSize.width,
          h: nodeSize.height,
          lane,
          meta: {
            modelId,
            section: sectionIndex,
            type: groupWorkload.type,
            children: workloadIds.map((id: string) => nodeIdFor(modelId, id)),
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
    yOffset +=
      lanes.length * laneHeight -
      modelHeaderYFromSectionStart +
      modelToNextHeaderGap;
    sectionIndex++;
  }

  for (const modelId of modelIds) {
    const m = store.get(modelId)!;
    const modelIsCollapsed = collapsedModelIds.has(modelId);

    if (!modelIsCollapsed) {
      for (const c of m.connections ?? []) {
        const from = resolveNodeId(
          collapsedNodeIds,
          modelId,
          c.from.split(".")[0],
          false,
        );
        const to = resolveNodeId(
          collapsedNodeIds,
          modelId,
          c.to.split(".")[0],
          false,
        );
        if (from && to) {
          edges.push({ from, to });
        }
      }
    }

    for (const r of m.remote_models ?? []) {
      const targetModelId = r.model_id;
      for (const c of r.connections ?? []) {
        if (
          typeof c.from_local === "string" &&
          typeof c.to_remote === "string"
        ) {
          const from = resolveNodeId(
            collapsedNodeIds,
            modelId,
            c.from_local.split(".")[0],
            true,
          );
          const to = resolveNodeId(
            collapsedNodeIds,
            targetModelId,
            c.to_remote.split(".")[0],
            true,
          );
          if (from && to) {
            edges.push({ from, to, isRemote: true });
          }
        } else if (
          typeof c.from_remote === "string" &&
          typeof c.to_local === "string"
        ) {
          const from = resolveNodeId(
            collapsedNodeIds,
            targetModelId,
            c.from_remote.split(".")[0],
            true,
          );
          const to = resolveNodeId(
            collapsedNodeIds,
            modelId,
            c.to_local.split(".")[0],
            true,
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

function compareModelIds(
  store: DocumentStore,
  leftModelId: string,
  rightModelId: string,
  sortKey: ModelSortKey
): number {
  const left = store.get(leftModelId);
  const right = store.get(rightModelId);
  const leftName =
    typeof left?.name === "string" && left.name.trim()
      ? left.name
      : leftModelId;
  const rightName =
    typeof right?.name === "string" && right.name.trim()
      ? right.name
      : rightModelId;

  if (sortKey === "model_name") {
    const byName = leftName.localeCompare(rightName);
    if (byName !== 0) return byName;
    return leftModelId.localeCompare(rightModelId);
  }

  if (sortKey === "telemetry_port") {
    const leftPort = Number(left?.telemetry?.port ?? 0);
    const rightPort = Number(right?.telemetry?.port ?? 0);
    if (leftPort !== rightPort) {
      return leftPort - rightPort;
    }
    return leftModelId.localeCompare(rightModelId);
  }

  return leftModelId.localeCompare(rightModelId);
}

function modelFileName(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}

function estimateModelHeaderWidth(modelName: string, subtitle: string): number {
  const longest = Math.max(modelName.length, subtitle.length);
  return Math.min(900, Math.max(280, 84 + longest * 7));
}

function resolveNodeId(
  collapsedNodeIds: Map<string, string>,
  modelId: string,
  workloadId: string,
  allowCollapsedAnchor: boolean,
): string | null {
  if (allowCollapsedAnchor) {
    const collapsedNodeId = collapsedNodeIds.get(modelId);
    if (collapsedNodeId) {
      return collapsedNodeId;
    }
  }
  return nodeIdFor(modelId, workloadId);
}
