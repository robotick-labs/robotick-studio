import type { GraphDoc } from "../view/node-graph/layout/editorNodeGraph";
import { DocumentStore } from "../document/documentStore";

const startX = 120,
  spacing = 180,
  nodeW = 140,
  verticalLaneHeaderHeight = 42,
  verticalNodeSpacing = 58,
  nodeH = 40;

function slotFromX(x: number): number {
  const raw = (x - startX) / spacing;
  return Math.max(0, Math.round(raw));
}

function slotFromY(y: number, sectionYStart: number): number {
  const raw =
    (y - sectionYStart - verticalLaneHeaderHeight) / verticalNodeSpacing;
  return Math.max(0, Math.round(raw));
}

export class SlotDragController {
  private dragging = false;
  private startLane = 0;
  private startSlot = 0;
  private modelId = "";
  private layoutDirection: "horizontal" | "vertical" = "horizontal";
  private sectionYStart = 0;

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
    this.layoutDirection = n.meta?.layoutDirection ?? "horizontal";
    this.sectionYStart = this.doc.sections[n.meta?.section ?? -1]?.yStart ?? 0;
    this.startSlot =
      n.meta?.slot ??
      (this.layoutDirection === "vertical"
        ? slotFromY(n.y, this.sectionYStart)
        : slotFromX(n.x));
    this.dragging = true;
    e.preventDefault();
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp, { once: true });
  };

  private onMouseMove = (_ev: MouseEvent) => {
    if (!this.dragging) return;
    // preview could be added here
  };

  private onMouseUp = (ev: MouseEvent) => {
    if (!this.dragging) {
      return;
    }

    this.dragging = false;
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);

    const p = this.toSvg(ev);
    const targetSlot =
      this.layoutDirection === "vertical"
        ? slotFromY(p.y - nodeH / 2, this.sectionYStart)
        : slotFromX(p.x - nodeW / 2);
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

  private toSvg(e: MouseEvent) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = this.svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : pt;
  }
}
