export type DragPreviewState = {
  phase: "dragging" | "drop-pending";
  draggedNodeId: string;
  sectionIndex: number;
  laneIndex: number;
  sourceSlot: number;
  targetSlot: number | null;
  pointerX: number;
  pointerY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
};
