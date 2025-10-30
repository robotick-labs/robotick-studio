import type { GraphDoc, Node, Section } from "../layout/editorNodeGraph";
import type { ConnectionRouter } from "../core/routing/types";
import { createSvgLayers } from "./svgLayers";

export { createSvgLayers };

const marginX = 20;
const startX = 120;
const spacing = 180;

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

  render(doc: GraphDoc): void {
    // this.svg.setAttribute("width", String(width));
    // this.svg.setAttribute("height", String(height));
    // this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    this.renderSwimlanes(doc.sections, width);
    this.renderSectionLabels(doc.sections);
    this.renderNodes(doc);
    this.renderEdges(doc);
    this.drawPlusButtons(doc.sections);
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
        rect.setAttribute("width", String(canvasWidth - marginX * 2));
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

    const edges = this.router.routeAll(doc.edges, (id: string) =>
      doc.getNode(id)
    );

    for (const e of edges) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.classList.add("connection-group");

      const hoverPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      hoverPath.setAttribute("d", e.path);
      hoverPath.classList.add("connection-hover-area");

      const visiblePath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      visiblePath.setAttribute("d", e.path);
      visiblePath.classList.add("connection", ...e.classList);

      g.appendChild(hoverPath);
      g.appendChild(visiblePath);
      this.layers.edges.appendChild(g);
    }
  }

  private drawPlusButtons(sections: Section[]) {
    // Remove previous buttons
    Array.from(this.svg.querySelectorAll("g.plus-slot")).forEach((n) =>
      n.remove()
    );

    const ns = "http://www.w3.org/2000/svg";
    const W = 140,
      H = 40; // plus tile size (matches nodes)
    const r = 4;
    const cx = W / 2,
      cy = H / 2; // center of the tile

    for (const s of sections) {
      for (let lane = 0; lane < s.laneCount; lane++) {
        const laneY = s.yStart + lane * s.laneHeight;
        const x = startX + s.maxNodes * spacing; // first empty slot
        const y = laneY + (s.laneHeight - H) / 2;

        const g = document.createElementNS(ns, "g");
        g.classList.add("plus-slot");
        g.setAttribute("transform", `translate(${x},${y})`);
        g.setAttribute("data-section", String(s.index));
        g.setAttribute("data-lane", String(lane));
        g.setAttribute("tabindex", "0"); // keyboard focus

        // Tile background
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("width", String(W));
        rect.setAttribute("height", String(H));
        rect.classList.add("workload", "plus");

        // Pixel-perfect "+" (two centered lines)
        const h = document.createElementNS(ns, "line");
        h.setAttribute("x1", String(cx - r));
        h.setAttribute("y1", String(cy));
        h.setAttribute("x2", String(cx + r));
        h.setAttribute("y2", String(cy));

        const v = document.createElementNS(ns, "line");
        v.setAttribute("x1", String(cx));
        v.setAttribute("y1", String(cy - r));
        v.setAttribute("x2", String(cx));
        v.setAttribute("y2", String(cy + r));

        // Let CSS style hover states; set sensible defaults
        [h, v].forEach((l) => {
          l.setAttribute("stroke", "#cfead7");
          l.setAttribute("stroke-width", "2");
          l.setAttribute("stroke-linecap", "round");
        });

        const fire = () =>
          window.dispatchEvent(
            new CustomEvent("models-graph:plus-click", {
              detail: { sectionIndex: s.index, laneIndex: lane },
            })
          );

        g.addEventListener("click", fire);
        g.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fire();
          }
        });

        g.append(rect, h, v);
        this.layers.nodes.appendChild(g);
      }
    }
  }
}
