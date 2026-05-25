import type { GraphDoc } from "../view/node-graph/layout/editorNodeGraph";
import { DocumentStore } from "../document/documentStore";

const DRAG_THRESHOLD_PX = 4;

export class SlotDragController {
  private dragging = false;
  private startLane = 0;
  private startSlot = 0;
  private modelId = "";
  private sectionIndex = -1;
  private startClientX = 0;
  private startClientY = 0;
  private didDrag = false;

  constructor(
    private svg: SVGSVGElement,
    private doc: GraphDoc,
    private store: DocumentStore,
  ) {}

  attachAll(): void {
    this.svg.addEventListener("mousedown", this.onMouseDown);
  }

  detach(): void {
    this.dragging = false;
    this.svg.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
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
    this.startLane = n.lane;
    this.sectionIndex = n.meta?.section ?? -1;
    this.startSlot = n.meta?.slot ?? 0;
    this.startClientX = e.clientX;
    this.startClientY = e.clientY;
    this.didDrag = false;
    this.dragging = true;
    e.preventDefault();
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp, { once: true });
  };

  private onMouseMove = (ev: MouseEvent) => {
    if (!this.dragging) return;
    if (this.hasMovedPastDragThreshold(ev)) {
      this.didDrag = true;
    }
    // preview could be added here
  };

  private onMouseUp = (ev: MouseEvent) => {
    if (!this.dragging) {
      return;
    }

    this.dragging = false;
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);

    if (!this.didDrag && !this.hasMovedPastDragThreshold(ev)) {
      return;
    }

    const p = this.toSvg(ev);
    const targetSlot = this.resolveTargetSlot(p.y);
    if (targetSlot !== this.startSlot) {
      this.store.moveWithinLane(
        this.modelId,
        this.startLane,
        this.startSlot,
        targetSlot,
      );
      window.dispatchEvent(new CustomEvent("models-graph:store-updated"));
    }
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

  private resolveTargetSlot(dropY: number): number {
    const laneNodes = Array.from(this.doc.nodes.values())
      .filter(
        (node) =>
          node.kind === "workload" &&
          node.meta?.section === this.sectionIndex &&
          node.lane === this.startLane,
      )
      .sort((left, right) => (left.meta?.slot ?? 0) - (right.meta?.slot ?? 0));
    if (laneNodes.length === 0) {
      return 0;
    }

    const section = this.doc.sections[this.sectionIndex];
    const addSlot = section?.addSlots?.find(
      (slot) => slot.laneIndex === this.startLane,
    );
    const addSlotCenterY = addSlot
      ? addSlot.frame.y + addSlot.frame.height / 2
      : Number.POSITIVE_INFINITY;
    if (dropY >= addSlotCenterY) {
      return laneNodes.length;
    }

    let insertIndex = 0;
    for (const node of laneNodes) {
      const centerY = node.y + node.h / 2;
      if (dropY < centerY) {
        return insertIndex;
      }
      insertIndex += 1;
    }
    return laneNodes.length;
  }
}
