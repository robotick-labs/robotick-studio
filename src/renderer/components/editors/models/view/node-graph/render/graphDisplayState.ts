import type { GraphDoc } from "../layout/editorNodeGraph";

export type EdgeVisibilityMode =
  | "none"
  | "selected-node"
  | "selected-model"
  | "expanded-models"
  | "all";

export type RemoteConnectionVisibility = "hidden" | "visible";

export interface RenderDisplayOptions {
  selectedNodeId: string | null;
  edgeVisibilityMode: EdgeVisibilityMode;
  remoteConnectionVisibility?: RemoteConnectionVisibility;
  focusDimming: boolean;
  expandedModelIds: string[];
}

export function getSelectedModelId(
  doc: GraphDoc,
  selectedNodeId: string | null,
): string | null {
  return selectedNodeId != null
    ? (doc.getNode(selectedNodeId)?.meta?.modelId ?? null)
    : null;
}

export function computeVisibleEdgeKeys(
  doc: GraphDoc,
  displayOptions: RenderDisplayOptions,
  selectedModelId: string | null,
): Set<string> {
  const visible = new Set<string>();
  const expandedModels = new Set(displayOptions.expandedModelIds);

  for (const edge of doc.edges) {
    const key = edgeKey(edge.from, edge.to);
    if (
      edge.isRemote &&
      displayOptions.remoteConnectionVisibility === "hidden"
    ) {
      continue;
    }

    if (displayOptions.edgeVisibilityMode === "all") {
      visible.add(key);
      continue;
    }

    if (displayOptions.edgeVisibilityMode === "none") {
      continue;
    }

    if (displayOptions.edgeVisibilityMode === "expanded-models") {
      if (expandedModels.size === 0) {
        continue;
      }
      const fromNode = doc.getNode(edge.from);
      const toNode = doc.getNode(edge.to);
      if (
        (fromNode?.meta?.modelId &&
          expandedModels.has(fromNode.meta.modelId)) ||
        (toNode?.meta?.modelId && expandedModels.has(toNode.meta.modelId))
      ) {
        visible.add(key);
      }
      continue;
    }

    if (displayOptions.edgeVisibilityMode === "selected-node") {
      if (!displayOptions.selectedNodeId) {
        continue;
      }
      if (
        edge.from === displayOptions.selectedNodeId ||
        edge.to === displayOptions.selectedNodeId
      ) {
        visible.add(key);
      }
      continue;
    }

    if (
      displayOptions.edgeVisibilityMode === "selected-model" &&
      displayOptions.selectedNodeId &&
      selectedModelId
    ) {
      const fromNode = doc.getNode(edge.from);
      const toNode = doc.getNode(edge.to);
      if (
        fromNode?.meta?.modelId === selectedModelId ||
        toNode?.meta?.modelId === selectedModelId
      ) {
        visible.add(key);
      }
    }
  }

  return visible;
}

export function computeRelatedNodeIds(
  doc: GraphDoc,
  visibleEdgeKeys: Set<string>,
  selectedNodeId: string | null,
  selectedModelId: string | null,
  edgeVisibilityMode: EdgeVisibilityMode,
): Set<string> {
  const related = new Set<string>();
  if (selectedNodeId) {
    related.add(selectedNodeId);
  }

  for (const key of visibleEdgeKeys) {
    const [from, to] = key.split("->", 2);
    if (from) related.add(from);
    if (to) related.add(to);
  }

  if (edgeVisibilityMode === "selected-model" && selectedModelId) {
    for (const node of doc.nodes.values()) {
      if (node.meta?.modelId === selectedModelId) {
        related.add(node.id);
      }
    }
  }

  return related;
}

export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}
