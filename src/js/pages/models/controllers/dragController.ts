import type { GraphDoc } from "../core/graphDoc";
import type { SvgView } from "../view/svgView";

export class DragController {
  constructor(
    private svg: SVGSVGElement,
    private doc: GraphDoc,
    private view: SvgView
  ) {}

  attachAll(): void {
    for (const node of this.doc.nodes.values()) {
      const el = document.getElementById(node.id) as SVGGElement | null;
      if (!el) continue;
      this.attach(node.id, el);
    }
  }

  private attach(nodeId: string, el: SVGGElement): void {
    let offX = 0,
      offY = 0;

    const toSvg = (e: MouseEvent) => {
      const pt = this.svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = this.svg.getScreenCTM();
      return ctm ? pt.matrixTransform(ctm.inverse()) : pt;
    };

    el.addEventListener("mousedown", (e) => {
      const start = toSvg(e);
      const node = this.doc.nodes.get(nodeId);
      if (!node) return;
      offX = start.x - node.x;
      offY = start.y - node.y;

      const onMove = (ev: MouseEvent) => {
        const p = toSvg(ev);
        this.doc.moveNode(nodeId, p.x - offX, p.y - offY);
        this.view.render(this.doc);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp, { once: true });
    });
  }
}
