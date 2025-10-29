import type { GraphDoc, Node, Section } from "../core/graphDoc";
import type { ConnectionRouter } from "../core/routing/types";
import { createSvgLayers } from "./svgLayers";

export { createSvgLayers };

const marginX = 20;

export interface Layers {
  swim: SVGGElement;
  group: SVGGElement;
  nodes: SVGGElement;
  edges: SVGGElement;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export class SvgView {
  constructor(
    private svg: SVGSVGElement,
    private layers: Layers,
    private router: ConnectionRouter
  ) {}

  render(doc: GraphDoc, size?: CanvasSize): void {
    const width =
      size?.width ?? Math.max(400, doc.bounds().w + marginX * 2 + 120);
    const height =
      size?.height ?? Math.max(200, doc.bounds().h + marginX * 2 + 60);
    this.svg.setAttribute("width", String(width));
    this.svg.setAttribute("height", String(height));
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    this.renderSwimlanes(doc.sections, width);
    this.renderSectionLabels(doc.sections);
    this.renderNodes(doc);
    this.renderEdges(doc);
  }

  private renderSwimlanes(sections: Section[], canvasWidth: number): void {
    this.layers.swim.replaceChildren();
    for (const section of sections) {
      for (let i = 0; i < section.laneCount; i++) {
        const y = section.yStart + i * section.laneHeight;
        const rect = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "rect"
        );
        rect.classList.add("swimlane");
        rect.setAttribute("x", String(marginX));
        rect.setAttribute("y", String(y));
        rect.setAttribute("rx", "6");
        rect.setAttribute("ry", "6");
        rect.setAttribute("width", String(canvasWidth - marginX * 2)); // equal width per lane
        rect.setAttribute("height", String(section.laneHeight));
        this.layers.swim.appendChild(rect);

        const label = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text"
        );
        label.classList.add("label");
        label.setAttribute("x", String(marginX + 10));
        label.setAttribute("y", String(y + 20));
        label.textContent = `Thread ${i + 1}`;
        this.layers.swim.appendChild(label);
      }
    }
  }

  private renderSectionLabels(sections: Section[]): void {
    // place labels directly on root svg to match prior behavior
    // First, remove previous model-labels
    Array.from(this.svg.querySelectorAll("text.model-label")).forEach((n) =>
      n.remove()
    );
    for (const s of sections) {
      const text = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      text.setAttribute("x", String(marginX + 10));
      text.setAttribute("y", String(s.labelY));
      text.classList.add("model-label");
      text.textContent = s.modelId;
      this.svg.appendChild(text);
    }
  }

  private ensureNode(n: Node): SVGGElement {
    let g = this.svg.getElementById(n.id) as SVGGElement | null;
    if (!g) {
      g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.id = n.id;
      g.classList.add("workload-node");
      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect"
      );
      rect.classList.add(n.kind === "group" ? "group" : "workload");
      rect.setAttribute("width", String(n.w));
      rect.setAttribute("height", String(n.h));

      const text = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      text.setAttribute("x", "10");
      text.setAttribute("y", "25");
      text.textContent = n.label;

      g.append(rect, text);
      this.layers.nodes.appendChild(g);
    }
    return g;
  }

  private renderNodes(doc: GraphDoc): void {
    for (const n of doc.nodes.values()) {
      const g = this.ensureNode(n);
      g.setAttribute("transform", `translate(${n.x},${n.y})`);
    }
  }

  private renderEdges(doc: GraphDoc): void {
    this.layers.edges.replaceChildren();
    for (const e of doc.edges) {
      const from = doc.getNode(e.from),
        to = doc.getNode(e.to);
      if (!from || !to) continue;
      const d = this.router.route(from, to);
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      path.setAttribute("d", d);
      path.classList.add(
        "connection",
        e.isRemote ? "remote-connection" : "local-connection"
      );
      this.layers.edges.appendChild(path);
    }
  }
}
