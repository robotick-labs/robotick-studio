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

type EdgeVisibilityMode =
  | "none"
  | "selected-node"
  | "selected-model"
  | "expanded-models"
  | "all";

export interface RenderDisplayOptions {
  selectedNodeId: string | null;
  edgeVisibilityMode: EdgeVisibilityMode;
  focusDimming: boolean;
  expandedModelIds: string[];
}

const DEFAULT_RENDER_DISPLAY_OPTIONS: RenderDisplayOptions = {
  selectedNodeId: null,
  edgeVisibilityMode: "selected-model",
  focusDimming: true,
  expandedModelIds: [],
};

export class SvgView {
  constructor(
    private svg: SVGSVGElement,
    private layers: Layers,
    private router: ConnectionRouter,
    private eventScope: string = "default",
  ) {}

  render(
    doc: GraphDoc,
    displayOptions: RenderDisplayOptions = DEFAULT_RENDER_DISPLAY_OPTIONS,
  ): void {
    const resolvedOptions = {
      ...DEFAULT_RENDER_DISPLAY_OPTIONS,
      ...displayOptions,
    };
    const selectedNodeId = resolvedOptions.selectedNodeId;
    const selectedModelId =
      selectedNodeId != null
        ? (doc.getNode(selectedNodeId)?.meta?.modelId ?? null)
        : null;
    const visibleEdges = this.computeVisibleEdges(
      doc,
      resolvedOptions,
      selectedModelId,
    );
    const relatedNodeIds = this.computeRelatedNodeIds(
      doc,
      visibleEdges,
      selectedNodeId,
      selectedModelId,
      resolvedOptions.edgeVisibilityMode,
    );

    // Step 1: render all content first
    this.clearLegacySectionLabels();
    this.renderNodes(
      doc,
      selectedNodeId,
      relatedNodeIds,
      resolvedOptions.focusDimming,
    );
    this.renderEdges(
      doc,
      visibleEdges,
      selectedNodeId,
      selectedModelId,
      resolvedOptions,
    );
    this.drawPlusButtons(doc);

    // Step 2: measure actual bounding box
    const margin = 40;
    const bounds = this.svg.getBBox();

    const viewX = Math.floor(bounds.x) - margin;
    const viewY = Math.floor(bounds.y) - margin;
    const viewWidth = Math.ceil(bounds.width) + margin * 2;
    const viewHeight = Math.ceil(bounds.height) + margin * 2;

    const currentViewBox = this.svg.getAttribute("viewBox");
    if (!currentViewBox) {
      this.svg.setAttribute(
        "viewBox",
        `${viewX} ${viewY} ${viewWidth} ${viewHeight}`,
      );
    }

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
          "rect",
        );
        rect.classList.add("swimlane");
        rect.setAttribute("x", String(marginX));
        rect.setAttribute("y", String(y));
        rect.setAttribute("rx", "6");
        rect.setAttribute("ry", "6");
        rect.setAttribute("width", String(canvasWidth - marginX * 2));
        rect.setAttribute("height", String(section.laneHeight + 1));
        if (section.collapsed) {
          rect.classList.add("collapsed-swimlane");
        }
        this.layers.swim.appendChild(rect);

        const label = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text",
        );
        label.classList.add("label");
        label.setAttribute("x", String(marginX + 10));
        label.setAttribute("y", String(y + 20));
        if (!section.collapsed) {
          label.textContent = section.hasSequencedGroup
            ? `Thread ${i + 1} · Sequenced Group`
            : `Thread ${i + 1}`;
          this.layers.swim.appendChild(label);
        }
      }
    }
  }

  private clearLegacySectionLabels(): void {
    Array.from(this.svg.querySelectorAll("g.model-collapse-header")).forEach(
      (n) => n.remove(),
    );
  }

  private ensureNode(n: Node): SVGGElement {
    let g = Array.from(
      this.layers.nodes.querySelectorAll("g.workload-node"),
    ).find(
      (el): el is SVGGElement => el instanceof SVGGElement && el.id === n.id,
    );
    const existingKind = g?.getAttribute("data-node-kind") ?? null;
    if (g && existingKind !== n.kind) {
      g.remove();
      g = undefined;
    }
    if (!g) {
      g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.id = n.id;
      g.classList.add("workload-node");

      if (n.kind === "model" || n.kind === "collapsed-model") {
        this.populateModelNode(g, n);
        this.layers.nodes.appendChild(g);
      } else {
        const rect = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "rect",
        );
        if (n.kind === "group") {
          rect.classList.add("group");
        } else if (n.kind === "stub") {
          rect.classList.add("collapsed-stub");
        } else {
          rect.classList.add("workload");
        }
        rect.setAttribute("width", String(n.w));
        rect.setAttribute("height", String(n.h));
        g.setAttribute("data-node-kind", n.kind);

        // Append first so CSS for .workload-node text is applied before measuring
        g.append(rect);
        this.layers.nodes.appendChild(g);
        if (n.kind !== "stub") {
          const text = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text",
          );
          text.setAttribute("x", "10");
          text.setAttribute("y", "25");
          g.append(text);
          // Fit label to available width (account for left padding ~10 and a little right padding)
          const maxTextWidth = Math.max(0, n.w - 20);
          this.fitTextWithEllipsis(text, n.label, maxTextWidth);
        }
      }
    } else if (n.kind === "model" || n.kind === "collapsed-model") {
      this.populateModelNode(g, n);
    }
    g.setAttribute("data-node-kind", n.kind);
    if (n.meta?.modelId) {
      g.setAttribute("data-model-id", n.meta.modelId);
    } else {
      g.removeAttribute("data-model-id");
    }
    g.classList.remove("is-structural-group", "is-selected", "is-dimmed");
    if (
      n.workload?.type === "SyncedGroupWorkload" ||
      n.workload?.type === "SequencedGroupWorkload"
    ) {
      g.classList.add("is-structural-group");
    }
    return g;
  }

  private populateModelNode(g: SVGGElement, n: Node): void {
    const ns = "http://www.w3.org/2000/svg";
    const isCollapsed =
      n.meta?.collapsed === true || n.kind === "collapsed-model";
    const toggleWidth = 38;
    const toggleInset = 2;
    g.replaceChildren();

    const rect = document.createElementNS(ns, "rect");
    rect.classList.add("model-node-body");
    rect.setAttribute("width", String(n.w));
    rect.setAttribute("height", String(n.h));
    rect.setAttribute("rx", "6");
    rect.setAttribute("ry", "6");

    const toggleRect = document.createElementNS(ns, "path");
    toggleRect.classList.add("model-toggle-button");
    toggleRect.setAttribute(
      "d",
      roundedLeftRectPath(
        toggleInset,
        toggleInset,
        toggleWidth - toggleInset,
        n.h - toggleInset * 2,
        4
      )
    );
    toggleRect.setAttribute(
      "aria-label",
      isCollapsed ? "Expand model section" : "Collapse model section",
    );

    const divider = document.createElementNS(ns, "line");
    divider.classList.add("model-toggle-divider");
    divider.setAttribute("x1", String(toggleWidth));
    divider.setAttribute("y1", "7");
    divider.setAttribute("x2", String(toggleWidth));
    divider.setAttribute("y2", String(n.h - 7));

    const chevron = document.createElementNS(ns, "text");
    chevron.classList.add("model-toggle-chevron");
    chevron.setAttribute("x", String(toggleWidth / 2));
    chevron.setAttribute("y", String(n.h / 2 + 4));
    chevron.textContent = isCollapsed ? "▶" : "▼";

    const title = document.createElementNS(ns, "text");
    title.classList.add("model-node-title");
    title.setAttribute("x", String(toggleWidth + 12));
    title.setAttribute("y", "21");

    const subtitle = document.createElementNS(ns, "text");
    subtitle.classList.add("model-node-subtitle");
    subtitle.setAttribute("x", String(toggleWidth + 12));
    subtitle.setAttribute("y", "39");
    g.append(rect, toggleRect, divider, chevron, title, subtitle);

    this.fitTextWithEllipsis(
      title,
      n.label,
      Math.max(0, n.w - toggleWidth - 22),
    );
    this.fitTextWithEllipsis(
      subtitle,
      n.meta?.subtitle ?? n.meta?.modelId ?? "",
      Math.max(0, n.w - toggleWidth - 22),
    );
    g.setAttribute("data-node-kind", n.kind);
  }

  /**
   * Sets textContent to the longest prefix that fits within maxWidth,
   * appending a single ellipsis if truncation was needed.
   * Measures in-place so computed styles are accurate.
   */
  private fitTextWithEllipsis(
    textEl: SVGTextElement,
    full: string,
    maxWidth: number,
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

  private renderNodes(
    doc: GraphDoc,
    selectedNodeId: string | null,
    relatedNodeIds: Set<string>,
    focusDimming: boolean,
  ): void {
    // Remove stale node elements that are no longer present in the current doc
    Array.from(this.layers.nodes.querySelectorAll("g.workload-node")).forEach(
      (el) => {
        const id = (el as SVGGElement).id;
        if (!doc.nodes.has(id)) {
          el.remove();
        }
      },
    );

    for (const n of doc.nodes.values()) {
      const g = this.ensureNode(n);
      g.setAttribute("transform", `translate(${n.x},${n.y})`);
      if (selectedNodeId && n.id === selectedNodeId) {
        g.classList.add("is-selected");
      }
      if (focusDimming && selectedNodeId && !relatedNodeIds.has(n.id)) {
        g.classList.add("is-dimmed");
      }
    }
  }

  private renderEdges(
    doc: GraphDoc,
    visibleEdgeKeys: Set<string>,
    selectedNodeId: string | null,
    selectedModelId: string | null,
    displayOptions: RenderDisplayOptions,
  ): void {
    this.layers.edges.replaceChildren();

    const edges = this.router.routeAll(doc.edges, (id: string) =>
      doc.getNode(id),
    );

    for (const e of edges) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.classList.add("connection-group");

      const hoverPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      hoverPath.setAttribute("d", e.path);
      hoverPath.classList.add("connection-hover-area");

      const visiblePath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      visiblePath.setAttribute("d", e.path);
      visiblePath.classList.add("connection", ...e.classList);
      const from = e.from;
      const to = e.to;
      const edgeKey = this.edgeKey(from, to);
      const isVisible = visibleEdgeKeys.has(edgeKey);
      const fromNode = doc.getNode(from);
      const toNode = doc.getNode(to);
      const touchesSelectedNode =
        selectedNodeId != null &&
        (from === selectedNodeId || to === selectedNodeId);
      const touchesSelectedModel =
        selectedModelId != null &&
        (fromNode?.meta?.modelId === selectedModelId ||
          toNode?.meta?.modelId === selectedModelId);
      const shouldDim =
        displayOptions.focusDimming &&
        selectedNodeId != null &&
        !touchesSelectedNode &&
        !(
          displayOptions.edgeVisibilityMode === "selected-model" &&
          touchesSelectedModel
        );

      if (!isVisible) {
        g.classList.add("is-hidden");
      } else if (shouldDim) {
        g.classList.add("is-dimmed");
      }

      g.appendChild(hoverPath);
      g.appendChild(visiblePath);
      this.layers.edges.appendChild(g);
    }
  }

  private computeVisibleEdges(
    doc: GraphDoc,
    displayOptions: RenderDisplayOptions,
    selectedModelId: string | null,
  ): Set<string> {
    const visible = new Set<string>();
    const selectedNodeId = displayOptions.selectedNodeId;
    const expandedModels = new Set(displayOptions.expandedModelIds);

    for (const edge of doc.edges) {
      const key = this.edgeKey(edge.from, edge.to);

      if (displayOptions.edgeVisibilityMode === "all") {
        visible.add(key);
        continue;
      }

      if (displayOptions.edgeVisibilityMode === "none") {
        continue;
      }

      if (displayOptions.edgeVisibilityMode === "expanded-models") {
        if (expandedModels.size === 0) {
          continue;
        }
        const fromNode = doc.getNode(edge.from);
        const toNode = doc.getNode(edge.to);
        if (
          (fromNode?.meta?.modelId &&
            expandedModels.has(fromNode.meta.modelId)) ||
          (toNode?.meta?.modelId && expandedModels.has(toNode.meta.modelId))
        ) {
          visible.add(key);
        }
        continue;
      }

      if (displayOptions.edgeVisibilityMode === "selected-node") {
        if (!selectedNodeId) {
          continue;
        }
        if (edge.from === selectedNodeId || edge.to === selectedNodeId) {
          visible.add(key);
        }
        continue;
      }

      if (displayOptions.edgeVisibilityMode === "selected-model") {
        if (!selectedNodeId || !selectedModelId) {
          continue;
        }
        const fromNode = doc.getNode(edge.from);
        const toNode = doc.getNode(edge.to);
        if (
          fromNode?.meta?.modelId === selectedModelId ||
          toNode?.meta?.modelId === selectedModelId
        ) {
          visible.add(key);
        }
      }
    }

    return visible;
  }

  private computeRelatedNodeIds(
    doc: GraphDoc,
    visibleEdgeKeys: Set<string>,
    selectedNodeId: string | null,
    selectedModelId: string | null,
    edgeVisibilityMode: EdgeVisibilityMode,
  ): Set<string> {
    const related = new Set<string>();
    if (selectedNodeId) {
      related.add(selectedNodeId);
    }

    for (const key of visibleEdgeKeys) {
      const [from, to] = key.split("->", 2);
      if (from) related.add(from);
      if (to) related.add(to);
    }

    if (edgeVisibilityMode === "selected-model" && selectedModelId) {
      for (const node of doc.nodes.values()) {
        if (node.meta?.modelId === selectedModelId) {
          related.add(node.id);
        }
      }
    }

    return related;
  }

  private edgeKey(from: string, to: string): string {
    return `${from}->${to}`;
  }

  private drawPlusButtons(doc: GraphDoc) {
    // Remove previous buttons
    Array.from(this.svg.querySelectorAll("g.plus-slot")).forEach((n) =>
      n.remove(),
    );

    const sections = doc.sections;

    const ns = "http://www.w3.org/2000/svg";
    const W = 140,
      H = 40;
    const r = 4;
    const cx = W / 2,
      cy = H / 2;

    for (const s of sections) {
      if (s.collapsed) {
        continue;
      }
      for (let lane = 0; lane < s.laneCount; lane++) {
        const laneY = s.yStart + lane * s.laneHeight;

        // ⬇️ Find the rightmost node *in this lane*
        const nodesInLane = Array.from(doc.nodes.values()).filter(
          (n) => n.meta?.section === s.index && n.lane === lane,
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
          this.svg.dispatchEvent(
            new CustomEvent("models-graph:plus-click", {
              detail: {
                sectionIndex: s.index,
                laneIndex: lane,
                scope: this.eventScope,
              },
              bubbles: true,
            }),
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

function roundedLeftRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const right = x + width;
  const bottom = y + height;
  return [
    `M ${x + r} ${y}`,
    `H ${right}`,
    `V ${bottom}`,
    `H ${x + r}`,
    `Q ${x} ${bottom} ${x} ${bottom - r}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    "Z",
  ].join(" ");
}
