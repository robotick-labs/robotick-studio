import type { GraphDoc, Node, Section } from "../layout/editorNodeGraph";
import type { ConnectionRouter } from "../routing/connectionRouter";
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
    // Step 1: render all content first
    this.renderSectionLabels(doc.sections);
    this.renderNodes(doc);
    this.renderEdges(doc);
    this.drawPlusButtons(doc);

    // Step 2: measure actual bounding box
    const margin = 40;
    const bounds = this.svg.getBBox();

    const viewX = Math.floor(bounds.x) - margin;
    const viewY = Math.floor(bounds.y) - margin;
    const viewWidth = Math.ceil(bounds.width) + margin * 2;
    const viewHeight = Math.ceil(bounds.height) + margin * 2;

    this.svg.setAttribute("width", String(viewWidth));
    this.svg.setAttribute("height", String(viewHeight));
    this.svg.setAttribute(
      "viewBox",
      `${viewX} ${viewY} ${viewWidth} ${viewHeight}`
    );

    // Step 3: re-render swimlanes with final width
    this.renderSwimlanes(doc.sections, viewWidth);
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
        rect.setAttribute("height", String(section.laneHeight + 1));
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

      // Append first so CSS for .workload-node text is applied before measuring
      g.append(rect, text);
      this.layers.nodes.appendChild(g);

      // Fit label to available width (account for left padding ~10 and a little right padding)
      const maxTextWidth = Math.max(0, n.w - 20);
      this.fitTextWithEllipsis(text, n.label, maxTextWidth);
    }
    return g;
  }

  /**
   * Sets textContent to the longest prefix that fits within maxWidth,
   * appending a single ellipsis if truncation was needed.
   * Measures in-place so computed styles are accurate.
   */
  private fitTextWithEllipsis(
    textEl: SVGTextElement,
    full: string,
    maxWidth: number
  ): void {
    // 1) Try full text first (no ellipsis if it fits)
    textEl.textContent = full;
    if (textEl.getComputedTextLength() <= maxWidth) {
      return;
    }

    // 2) Binary search longest fitting prefix with an ellipsis
    let lo = 0;
    let hi = full.length;
    let best = 0;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      // Trim trailing underscores/spaces before ellipsis to avoid "_…"
      const trial = full.slice(0, mid).replace(/[_\s]+$/, "") + "…";
      textEl.textContent = trial;

      if (textEl.getComputedTextLength() <= maxWidth) {
        best = mid; // mid fits → try to take more
        lo = mid + 1;
      } else {
        hi = mid - 1; // mid too long → take less
      }
    }

    const finalPrefix = full.slice(0, best).replace(/[_\s]+$/, "");
    textEl.textContent = finalPrefix + "…";
    textEl.setAttribute("title", full); // show full label on hover
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

  private drawPlusButtons(doc: GraphDoc) {
    // Remove previous buttons
    Array.from(this.svg.querySelectorAll("g.plus-slot")).forEach((n) =>
      n.remove()
    );

    const sections = doc.sections;

    const ns = "http://www.w3.org/2000/svg";
    const W = 140,
      H = 40;
    const r = 4;
    const cx = W / 2,
      cy = H / 2;

    for (const s of sections) {
      for (let lane = 0; lane < s.laneCount; lane++) {
        const laneY = s.yStart + lane * s.laneHeight;

        // ⬇️ Find the rightmost node *in this lane*
        const nodesInLane = Array.from(doc.nodes.values()).filter(
          (n) => n.meta?.section === s.index && n.lane === lane
        );

        const maxX =
          nodesInLane.length > 0
            ? Math.max(...nodesInLane.map((n) => n.x))
            : startX - spacing;

        const x = maxX + spacing;

        const y = laneY + (s.laneHeight - H) / 2;

        const g = document.createElementNS(ns, "g");
        g.classList.add("plus-slot");
        g.setAttribute("transform", `translate(${x},${y})`);
        g.setAttribute("data-section", String(s.index));
        g.setAttribute("data-lane", String(lane));
        g.setAttribute("tabindex", "0");

        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("width", String(W));
        rect.setAttribute("height", String(H));
        rect.classList.add("workload", "plus");

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
