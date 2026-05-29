import type { GraphDoc } from "../view/node-graph/layout/editorNodeGraph";
import type { DragPreviewState } from "../view/node-graph/dragPreviewState";
import { getLaneSlotRows } from "../view/node-graph/dragSlotGeometry";
import { DocumentStore } from "../document/documentStore";

const DRAG_THRESHOLD_PX = 4;

type SlotDragControllerHandlers = {
  onDragPreviewChange: (preview: DragPreviewState | null) => void;
};

export class SlotDragController {
  private dragging = false;
  private startLane = 0;
  private startSlot = 0;
  private modelId = "";
  private draggedNodeId = "";
  private sectionIndex = -1;
  private startClientX = 0;
  private startClientY = 0;
  private didDrag = false;
  private pointerOffsetX = 0;
  private pointerOffsetY = 0;
  private suppressNextClick = false;

  constructor(
    private svg: SVGSVGElement,
    private doc: GraphDoc,
    private store: DocumentStore,
    private handlers: SlotDragControllerHandlers,
  ) {}

  attachAll(): void {
    this.svg.addEventListener("mousedown", this.onMouseDown);
    this.svg.addEventListener("click", this.onClickCapture, true);
  }

  detach(): void {
    this.dragging = false;
    this.svg.removeEventListener("mousedown", this.onMouseDown);
    this.svg.removeEventListener("click", this.onClickCapture, true);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("keydown", this.onKeyDown);
    this.handlers.onDragPreviewChange(null);
  }

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) {
      return;
    }

    const target = e.target as Element | null;
    const g = target?.closest("g.workload-node") as SVGGElement | null;
    if (!g?.id) {
      return;
    }

    const n = this.doc.getNode(g.id);
    if (!n || n.kind !== "workload") {
      return;
    }

    this.modelId = n.meta?.modelId ?? "";
    this.draggedNodeId = n.id;
    this.startLane = n.lane;
    this.sectionIndex = n.meta?.section ?? -1;
    this.startSlot = n.meta?.slot ?? 0;
    this.startClientX = e.clientX;
    this.startClientY = e.clientY;
    const startPoint = this.toSvg(e);
    this.pointerOffsetX = startPoint.x - n.x;
    this.pointerOffsetY = startPoint.y - n.y;
    this.didDrag = false;
    this.suppressNextClick = false;
    this.dragging = true;
    e.preventDefault();
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp, { once: true });
    window.addEventListener("keydown", this.onKeyDown);
  };

  private onMouseMove = (ev: MouseEvent) => {
    if (!this.dragging) return;
    if (this.hasMovedPastDragThreshold(ev)) {
      this.didDrag = true;
      this.suppressNextClick = true;
    }
    if (!this.didDrag) {
      return;
    }
    const point = this.toSvg(ev);
    const preview = this.buildPreview(point.x, point.y);
    this.handlers.onDragPreviewChange(preview);
  };

  private onMouseUp = (ev: MouseEvent) => {
    if (!this.dragging) {
      return;
    }

    this.dragging = false;
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("keydown", this.onKeyDown);

    if (!this.didDrag && !this.hasMovedPastDragThreshold(ev)) {
      this.handlers.onDragPreviewChange(null);
      return;
    }

    const p = this.toSvg(ev);
    const targetSlot = this.resolveTargetSlot(p.x, p.y);
    if (targetSlot != null && targetSlot !== this.startSlot) {
      this.handlers.onDragPreviewChange({
        ...this.buildPreview(p.x, p.y),
        phase: "drop-pending",
        targetSlot,
      });
      this.store.moveWithinLane(
        this.modelId,
        this.startLane,
        this.startSlot,
        targetSlot,
      );
      window.dispatchEvent(new CustomEvent("models-graph:store-updated"));
      return;
    }
    this.handlers.onDragPreviewChange(null);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    this.didDrag = false;
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("keydown", this.onKeyDown);
    this.handlers.onDragPreviewChange(null);
  };

  private onClickCapture = (event: MouseEvent) => {
    if (!this.suppressNextClick) {
      return;
    }
    this.suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  private hasMovedPastDragThreshold(e: MouseEvent): boolean {
    return (
      Math.hypot(e.clientX - this.startClientX, e.clientY - this.startClientY) >=
      DRAG_THRESHOLD_PX
    );
  }

  private toSvg(e: MouseEvent) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = this.svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : pt;
  }

  private resolveTargetSlot(pointerX: number, pointerY: number): number | null {
    const draggedNode = this.doc.getNode(this.draggedNodeId);
    if (!draggedNode || draggedNode.kind !== "workload") {
      return null;
    }

    const dragLeft = pointerX - this.pointerOffsetX;
    const dragTop = pointerY - this.pointerOffsetY;
    const dragCenterX = dragLeft + draggedNode.w / 2;
    const dragCenterY = dragTop + draggedNode.h / 2;
    const section = this.doc.sections[this.sectionIndex];
    const laneFrame = section?.lanes?.find(
      (lane) => lane.laneIndex === this.startLane,
    )?.frame;
    if (
      !laneFrame ||
      dragCenterX < laneFrame.x - 24 ||
      dragCenterX > laneFrame.x + laneFrame.width + 24
    ) {
      return null;
    }

    const rows = getLaneSlotRows(this.doc, this.sectionIndex, this.startLane);
    if (rows.length === 0) {
      return null;
    }

    const dragBottom = dragTop + draggedNode.h;
    let bestRow = rows[0];
    let bestOverlap = -1;

    for (const row of rows) {
      const rowTop = row.frame.y;
      const rowBottom = row.frame.y + row.frame.height;
      const overlap = Math.max(
        0,
        Math.min(dragBottom, rowBottom) - Math.max(dragTop, rowTop),
      );
      if (
        overlap > bestOverlap ||
        (overlap === bestOverlap &&
          Math.abs(dragCenterY - row.centerY) <
            Math.abs(dragCenterY - bestRow.centerY))
      ) {
        bestRow = row;
        bestOverlap = overlap;
      }
    }
    return bestRow.slotIndex;
  }

  private buildPreview(pointerX: number, pointerY: number): DragPreviewState {
    return {
      phase: "dragging",
      draggedNodeId: this.draggedNodeId,
      sectionIndex: this.sectionIndex,
      laneIndex: this.startLane,
      sourceSlot: this.startSlot,
      targetSlot: this.resolveTargetSlot(pointerX, pointerY),
      pointerX,
      pointerY,
      pointerOffsetX: this.pointerOffsetX,
      pointerOffsetY: this.pointerOffsetY,
    };
  }
}
