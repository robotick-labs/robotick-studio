import type { ConnectionRouter, RoutedEdge } from "./connectionRouter";
import type { Edge, Node } from "../layout/editorNodeGraph";

export class RectilinearRouter implements ConnectionRouter {
  constructor(
    private spacing = 180,
    private epsilon = 50,
    private straightLen = 15,
    private baseOffset = 25,
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

    // === Compute far-left margin X ===
    const allNodes = new Set<Node>();
    for (const edge of uniqueEdges) {
      const from = getNode(edge.from);
      const to = getNode(edge.to);
      if (from) allNodes.add(from);
      if (to) allNodes.add(to);
    }

    const minX = Math.min(...Array.from(allNodes).map((n) => n.x));
    const leftColumnBase = minX - this.leftMargin;

    // === Main routing loop ===
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

      if (isAdjacent) {
        path = `M${x1},${y1 + this.adjacentOffsetY} L${x2},${
          y2 + this.adjacentOffsetY
        }`;
      } else if (!isHorizAligned) {
        // === INTER-LANE ===
        const arcDir = dx > 0 ? -1 : 1;

        // === Allocate vertical lane on left margin ===
        let arcOffset = this.baseOffset + Math.abs(dx) * this.offsetScale;
        let colY = y1 + arcDir * arcOffset;

        let attempts = 0;
        while (
          usedArcYs.some(
            (used) => Math.abs(used - colY) < this.minChannelSpacing
          ) &&
          attempts < 20
        ) {
          arcOffset += this.minChannelSpacing;
          colY = y1 + arcDir * arcOffset;
          attempts++;
        }
        usedArcYs.push(colY);

        // === Allocate horizontal position of vertical column ===
        let colX = leftColumnBase;
        attempts = 0;
        while (
          usedColXs.some(
            (used) => Math.abs(used - colX) < this.minChannelSpacing
          ) &&
          attempts < 20
        ) {
          colX -= this.minChannelSpacing;
          attempts++;
        }
        usedColXs.push(colX);

        // === Final arcY after fan-in should always run along TOP of swimlane ===
        let arcY2 = y2 - (this.baseOffset + Math.abs(dx) * this.offsetScale);

        attempts = 0;
        while (
          usedArcYs.some(
            (used) => Math.abs(used - arcY2) < this.minChannelSpacing
          ) &&
          attempts < 20
        ) {
          arcY2 -= this.minChannelSpacing;
          attempts++;
        }
        usedArcYs.push(arcY2);

        const midX3 = targetLeft - this.straightLen;

        path = [
          `M${x1},${y1}`,
          `L${midX1},${y1}`,
          `L${midX1},${colY}`,
          `L${colX},${colY}`,
          `L${colX},${arcY2}`,
          `L${midX3},${arcY2}`,
          `L${midX3},${y2}`,
          `L${targetLeft},${y2}`,
        ].join(" ");
      } else {
        // === IN-LANE ===
        const arcDir = dx > 0 ? -1 : 1;
        let arcOffset = this.baseOffset + Math.abs(dx) * this.offsetScale;
        let arcY = y1 + arcDir * arcOffset;

        let attempts = 0;
        while (
          usedArcYs.some(
            (used) => Math.abs(used - arcY) < this.minChannelSpacing
          ) &&
          attempts < 20
        ) {
          arcOffset += this.minChannelSpacing;
          arcY = y1 + arcDir * arcOffset;
          attempts++;
        }
        usedArcYs.push(arcY);

        path = [
          `M${x1},${y1}`,
          `L${midX1},${y1}`,
          `L${midX1},${arcY}`,
          `L${midX2},${arcY}`,
          `L${midX2},${y2}`,
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
