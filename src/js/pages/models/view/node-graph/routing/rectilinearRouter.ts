import type { ConnectionRouter, RoutedEdge } from "./connectionRouter";
import type { Edge, Node } from "../layout/editorNodeGraph";

export class RectilinearRouter implements ConnectionRouter {
  constructor(
    private spacing = 180,
    private epsilon = 50,
    private straightLen = 15,
    private baseOffset = 30,
    private offsetScale = 0.04,
    private adjacentOffsetY = 5,
    private minChannelSpacing = 4,
    private leftMargin = 25
  ) {}

  routeAll(
    edges: Edge[],
    getNode: (id: string) => Node | undefined
  ): RoutedEdge[] {
    const results: RoutedEdge[] = [];
    const usedArcYs: number[] = [];
    const usedColXs: number[] = [];

    // === Deduplicate by from→to key ===
    const seen = new Set<string>();
    const uniqueEdges: Edge[] = [];
    for (const edge of edges) {
      const key = `${edge.from}→${edge.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEdges.push(edge);
      }
    }

    // === Collect nodes to find far-left for the margin column ===
    const allNodes = new Set<Node>();
    for (const edge of uniqueEdges) {
      const f = getNode(edge.from);
      const t = getNode(edge.to);
      if (f) allNodes.add(f);
      if (t) allNodes.add(t);
    }
    const minX = Math.min(...Array.from(allNodes).map((n) => n.x));
    const leftColumnBase = minX - this.leftMargin;

    // Helpers
    const allocateColumnX = (baseX: number): number => {
      let x = baseX;
      while (usedColXs.some((u) => Math.abs(u - x) < this.minChannelSpacing)) {
        x -= this.minChannelSpacing;
      }
      usedColXs.push(x);
      return x;
    };

    const placeTrackY = (
      laneCenterY: number,
      pos: "top" | "bottom",
      base: number
    ): number => {
      let off = base;
      let y = laneCenterY + (pos === "top" ? -off : off);
      while (usedArcYs.some((u) => Math.abs(u - y) < this.minChannelSpacing)) {
        off += this.minChannelSpacing;
        y = laneCenterY + (pos === "top" ? -off : off);
      }
      usedArcYs.push(y);
      return y;
    };

    // === Main routing ===
    for (const edge of uniqueEdges) {
      const from = getNode(edge.from);
      const to = getNode(edge.to);
      if (!from || !to) continue;

      const x1 = from.x + from.w;
      const y1 = from.y + from.h / 2;
      const x2 = to.x;
      const y2 = to.y + to.h / 2;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const isHorizAligned = Math.abs(dy) < this.epsilon;
      const isAdjacent =
        isHorizAligned && Math.abs(dx) - this.spacing < this.epsilon;

      const targetLeft = to.x;
      const midX1 = x1 + this.straightLen;
      const midX2 = targetLeft - this.straightLen;

      let path: string;

      if (!isHorizAligned) {
        // =========================
        // INTER-LANE (between lanes)
        // Rule:
        //   - exit source via BOTTOM track
        //   - go LEFT to margin column
        //   - vertical along margin to TOP track of target lane
        //   - RIGHT along TOP track to just before node
        //   - DOWN to node center and RIGHT into node
        // =========================

        // Allocate a left margin column X (shared but spaced)
        const colX = allocateColumnX(leftColumnBase);

        // Desired horizontal offsets (scale with horizontal span)
        const srcBase = this.baseOffset + Math.abs(dx) * this.offsetScale;
        const tgtBase = this.baseOffset + 30; // keep target top track visibly separated

        // 1) Source lane BOTTOM track (horizontal)
        const srcBottomY = placeTrackY(y1, "bottom", srcBase);

        // 2) Target lane TOP track (horizontal)
        const tgtTopY = placeTrackY(y2, "top", tgtBase);

        // Route per the spec:
        path = [
          // From center → down to bottom track of source lane
          `M${x1},${y1}`,
          `L${x1},${srcBottomY}`,
          // Across to left margin
          `L${colX},${srcBottomY}`,
          // Along margin to TOP of target lane (can be up or down depending on lanes)
          `L${colX},${tgtTopY}`,
          // Across along TOP track of target lane to just before node
          `L${midX2},${tgtTopY}`,
          // Down to node center
          `L${midX2},${y2}`,
          // Into node
          `L${targetLeft},${y2}`,
        ].join(" ");
      } else if (isAdjacent) {
        // =========================
        // INTRA-LANE ADJACENT — mid-lane short
        // =========================
        path = `M${x1},${y1 + this.adjacentOffsetY} L${x2},${
          y2 + this.adjacentOffsetY
        }`;
      } else {
        // =========================
        // INTRA-LANE (same lane, non-adjacent)
        // Rule:
        //   - Left→Right: TOP track
        //   - Right→Left: BOTTOM track
        // =========================
        const trackPos: "top" | "bottom" = dx > 0 ? "top" : "bottom";
        const base = this.baseOffset + Math.abs(dx) * this.offsetScale;
        const arcY = placeTrackY(y1, trackPos, base);

        path = [
          `M${x1},${y1}`,
          `L${x1},${arcY}`, // up or down to track
          `L${midX1},${arcY}`, // short horizontal
          `L${midX2},${arcY}`, // across lane
          `L${midX2},${y2}`, // into target centerline
          `L${targetLeft},${y2}`,
        ].join(" ");
      }

      results.push({
        path,
        classList: [
          "connection",
          edge.isRemote ? "remote-connection" : "local-connection",
        ],
      });
    }

    return results;
  }
}
