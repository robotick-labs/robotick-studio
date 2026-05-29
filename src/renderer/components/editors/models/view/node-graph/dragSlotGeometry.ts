import type { GraphDoc, Node, RectFrame } from "./layout/editorNodeGraph";

export type LaneSlotRow = {
  slotIndex: number;
  frame: RectFrame;
  centerY: number;
};

export function getLaneSlotRows(
  doc: GraphDoc,
  sectionIndex: number,
  laneIndex: number,
): LaneSlotRow[] {
  const section = doc.sections[sectionIndex];
  const lane = section?.lanes?.find((entry) => entry.laneIndex === laneIndex);
  if (!lane) {
    return [];
  }

  const laneNodes = getLaneWorkloadNodes(doc, sectionIndex, laneIndex);
  if (laneNodes.length === 0) {
    return [];
  }

  const addSlotCenterY =
    section?.addSlots?.find((slot) => slot.laneIndex === laneIndex)?.frame.y ??
    null;
  const centers = laneNodes.map((node) => node.y + node.h / 2);

  return laneNodes.map((node, slotIndex) => {
    const centerY = centers[slotIndex];
    const top =
      slotIndex === 0
        ? node.y - 12
        : (centers[slotIndex - 1] + centerY) / 2;
    const bottom =
      slotIndex === laneNodes.length - 1
        ? addSlotCenterY != null
          ? (centerY + addSlotCenterY) / 2
          : node.y + node.h + 12
        : (centerY + centers[slotIndex + 1]) / 2;

    return {
      slotIndex,
      centerY,
      frame: {
        x: lane.frame.x,
        y: top,
        width: lane.frame.width,
        height: Math.max(16, bottom - top),
      },
    };
  });
}

export function getLaneWorkloadNodes(
  doc: GraphDoc,
  sectionIndex: number,
  laneIndex: number,
  options?: { excludeNodeId?: string },
): Node[] {
  const excludeNodeId = options?.excludeNodeId;
  return Array.from(doc.nodes.values())
    .filter(
      (node) =>
        node.kind === "workload" &&
        node.meta?.section === sectionIndex &&
        node.lane === laneIndex &&
        node.id !== excludeNodeId,
    )
    .sort((left, right) => (left.meta?.slot ?? 0) - (right.meta?.slot ?? 0));
}
