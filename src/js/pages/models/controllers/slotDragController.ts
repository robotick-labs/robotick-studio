import type { GraphDoc } from "../core/graphDoc";
import type { SvgView } from "../view/svgView";
import { ModelStore } from "../core/modelStore";

const startX = 120, spacing = 180, nodeW = 140;

function slotFromX(x: number): number {
  const raw = (x - startX) / spacing;
  return Math.max(0, Math.round(raw));
}

export class SlotDragController {
  constructor(
    private svg: SVGSVGElement,
    private doc: GraphDoc,
    private view: SvgView,
    private store: ModelStore
  ) {}

  attachAll(): void {
    for (const node of this.doc.nodes.values()) {
      if (node.kind !== "workload") continue;
      const el = document.getElementById(node.id) as SVGGElement | null;
      if (!el) continue;
      this.attach(node.id, el);
    }
  }

  private attach(nodeId: string, el: SVGGElement): void {
    let startLane = 0, startSlot = 0, modelId = "", dragging = false;

    const getMeta = () => {
      const n = this.doc.getNode(nodeId)!;
      modelId = (n.meta?.modelId ?? "");
      startLane = n.lane;
      startSlot = slotFromX(n.x);
    };

    const toSvg = (e: MouseEvent) => {
      const pt = this.svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const ctm = this.svg.getScreenCTM();
      return ctm ? pt.matrixTransform(ctm.inverse()) : pt;
    };

    el.addEventListener("mousedown", (e) => {
      getMeta(); dragging = true; e.preventDefault();
      const onMove = (_ev: MouseEvent) => {
        if (!dragging) return;
        // preview could be added here
      };
      const onUp = (ev: MouseEvent) => {
        dragging = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);

        const p = toSvg(ev);
        const targetSlot = slotFromX(p.x - nodeW / 2);
        if (targetSlot !== startSlot) {
          this.store.moveWithinLane(modelId, startLane, startSlot, targetSlot);
          window.dispatchEvent(new CustomEvent("models:store-updated"));
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp, { once: true });
    });
  }
}
