import type { ConnectionRouter, RoutedEdge } from "./connectionRouter";
import type { Edge, Node } from "../layout/editorNodeGraph";

export class RectilinearRouter implements ConnectionRouter {
  constructor(
    private spacing = 180,
    private epsilon = 50,
    private straightLen = 15,
    private baseOffset = 30,
    private offsetScale = 0.04,
    private adjacentOffsetY = 4,
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

    // === Collect nodes to find far-left for the margin column & do lane checks ===
    const allNodes = new Set<Node>();
    for (const edge of uniqueEdges) {
      const f = getNode(edge.from);
      const t = getNode(edge.to);
      if (f) allNodes.add(f);
      if (t) allNodes.add(t);
    }
    const allNodesArr = Array.from(allNodes);
    const minX = Math.min(...allNodesArr.map((n) => n.x));
    const leftColumnBase = minX - this.leftMargin;

    const isFirstInLane = (node: Node): boolean => {
      const laneY = node.y + node.h / 2;
      let minLaneX = node.x;
      for (const n of allNodesArr) {
        const nLaneY = n.y + n.h / 2;
        if (Math.abs(nLaneY - laneY) <= this.epsilon) {
          if (n.x < minLaneX) minLaneX = n.x;
        }
      }
      return node.x <= minLaneX + 0.5; // tolerate tiny float jitter
    };

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
      const midX1 = x1 + this.straightLen; // exit stub
      const midX2 = targetLeft - this.straightLen; // entry stub

      let path: string;

      if (!isHorizAligned) {
        // =========================
        // INTER-LANE (between lanes)
        // Spec (with tweaks you asked for):
        //   - exit node with short horizontal stub to midX1
        //   - BOTTOM of source lane to left margin
        //   - down/up margin to TOP of target lane
        //   - EXCEPTION: if target is first in its lane → go straight into node center (no top run)
        //   - otherwise TOP run to midX2, down to center, into node
        // =========================

        const colX = allocateColumnX(leftColumnBase);

        const srcBase = this.baseOffset + Math.abs(dx) * this.offsetScale;
        const srcBottomY = placeTrackY(y1, "bottom", srcBase);

        const targetIsFirst = isFirstInLane(to);
        const tgtBase = this.baseOffset + 30; // visual separation if needed

        // If not first in lane, we use TOP track; else, direct centerline
        const tgtTopY = targetIsFirst ? null : placeTrackY(y2, "top", tgtBase);

        if (targetIsFirst) {
          // Route with exit stub, then bottom to margin, then directly into node center
          path = [
            `M${x1},${y1}`,
            `L${midX1},${y1}`, // exit stub
            `L${midX1},${srcBottomY}`, // down to bottom track
            `L${colX},${srcBottomY}`, // left to margin
            `L${colX},${y2}`, // along margin to node centerline
            `L${midX2},${y2}`, // entry stub (short)
            `L${targetLeft},${y2}`, // into node
          ].join(" ");
        } else {
          // Normal inter-lane with TOP run inside target lane
          const topY = tgtTopY as number;
          path = [
            `M${x1},${y1}`,
            `L${midX1},${y1}`, // exit stub
            `L${midX1},${srcBottomY}`, // down to bottom track
            `L${colX},${srcBottomY}`, // left to margin
            `L${colX},${topY}`, // up/down along margin to TOP of target lane
            `L${midX2},${topY}`, // right along TOP track to entry stub
            `L${midX2},${y2}`, // down to node centerline
            `L${targetLeft},${y2}`, // into node
          ].join(" ");
        }
      } else if (isAdjacent) {
        // =========================
        // INTRA-LANE ADJACENT — mid-lane short (unchanged)
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
        //   - Add short horizontal stub on exit (midX1) before dropping/rising to track
        // =========================
        const trackPos: "top" | "bottom" = dx > 0 ? "top" : "bottom";
        const base = this.baseOffset + Math.abs(dx) * this.offsetScale;
        const arcY = placeTrackY(y1, trackPos, base);

        path = [
          `M${x1},${y1}`,
          `L${midX1},${y1}`, // exit stub
          `L${midX1},${arcY}`, // up/down to track
          `L${midX2},${arcY}`, // across lane at track height
          `L${midX2},${y2}`, // down/up to centerline by target
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
