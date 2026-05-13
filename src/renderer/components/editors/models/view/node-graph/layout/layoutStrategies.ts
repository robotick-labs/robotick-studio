import type { ElkNode } from "elkjs/lib/elk-api";

export type GraphLayoutDirection = "vertical-offset";

export type LayoutOrientation = "vertical";

export type LayoutModeContext = {
  hasRemoteEdges: boolean;
};

export interface LayoutStrategy {
  id: GraphLayoutDirection;
  orientation: LayoutOrientation;
  sourcePortSide: "SOUTH";
  targetPortSide: "NORTH";
  configureRoot(node: ElkNode, ctx: LayoutModeContext): void;
  seedNodePosition(params: {
    slot: number;
    lane: number;
    sectionIndex: number;
    laneCount: number;
    indexInSection: number;
  }): { x: number; y: number };
}

const BASE_NODE_SPACING = 56;
const BASE_LAYER_SPACING = 64;

const verticalOffset: LayoutStrategy = {
  id: "vertical-offset",
  orientation: "vertical",
  sourcePortSide: "SOUTH",
  targetPortSide: "NORTH",
  configureRoot(node) {
    node.layoutOptions = {
      ...(node.layoutOptions ?? {}),
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": String(BASE_NODE_SPACING),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(BASE_LAYER_SPACING),
      "elk.edgeRouting": "SPLINES",
      "elk.layered.mergeEdges": "false",
      "elk.layered.mergeHierarchyEdges": "false",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
      "elk.layered.layering.strategy": "LONGEST_PATH_SOURCE",
      "elk.layered.nodePlacement.favorStraightEdges": "true",
    };
  },
  seedNodePosition({ slot, lane, sectionIndex, indexInSection }) {
    const fan = (indexInSection % 3) - 1;
    return {
      x: lane * 220 + fan * 36,
      y: slot * 170 + sectionIndex * 36,
    };
  },
};

export function resolveLayoutMode(
  _value?: string | null | undefined,
): GraphLayoutDirection {
  return "vertical-offset";
}

export function getLayoutStrategy(
  _mode?: GraphLayoutDirection,
): LayoutStrategy {
  return verticalOffset;
}
