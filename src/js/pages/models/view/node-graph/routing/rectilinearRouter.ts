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

    // === Separate inter-lane and in-lane edges ===
    const groupedByTarget = new Map<string, Edge[]>();
    const otherEdges: Edge[] = [];

    for (const edge of uniqueEdges) {
      const from = getNode(edge.from);
      const to = getNode(edge.to);
      if (!from || !to) continue;

      const dx = to.x - (from.x + from.w);
      const dy = to.y + to.h / 2 - (from.y + from.h / 2);
      const isHorizAligned = Math.abs(dy) < this.epsilon;
      const isAdjacent =
        isHorizAligned && Math.abs(dx) - this.spacing < this.epsilon;

      if (!isHorizAligned && !isAdjacent) {
        if (!groupedByTarget.has(edge.to)) groupedByTarget.set(edge.to, []);
        groupedByTarget.get(edge.to)!.push(edge);
      } else {
        otherEdges.push(edge);
      }
    }

    // === Handle merged inter-lane groups ===
    for (const [targetId, edgesToTarget] of groupedByTarget.entries()) {
      const to = getNode(targetId);
      if (!to) continue;

      const x2 = to.x;
      const y2 = to.y + to.h / 2;
      const targetLeft = x2;
      const midX2 = targetLeft - this.straightLen;

      // Shared margin and top-lane geometry
      let colX = leftColumnBase;
      while (
        usedColXs.some((used) => Math.abs(used - colX) < this.minChannelSpacing)
      ) {
        colX -= this.minChannelSpacing;
      }
      usedColXs.push(colX);

      let arcY2 = y2 - (this.baseOffset + 30); // shared top path inside lane
      while (
        usedArcYs.some(
          (used) => Math.abs(used - arcY2) < this.minChannelSpacing
        )
      ) {
        arcY2 -= this.minChannelSpacing;
      }
      usedArcYs.push(arcY2);

      const midX3 = targetLeft - this.straightLen;

      // Shared tail path from left column → top of lane → node
      const sharedTail = [
        `L${colX},${arcY2}`,
        `L${midX3},${arcY2}`,
        `L${midX3},${y2}`,
        `L${targetLeft},${y2}`,
      ];

      // Each source connects to the shared left column
      for (const edge of edgesToTarget) {
        const from = getNode(edge.from);
        if (!from) continue;

        const x1 = from.x + from.w;
        const y1 = from.y + from.h / 2;
        const midX1 = x1 + this.straightLen;

        // Determine vertical route to merge point
        let colY =
          y1 - (this.baseOffset + Math.abs(x2 - x1) * this.offsetScale);
        while (
          usedArcYs.some(
            (used) => Math.abs(used - colY) < this.minChannelSpacing
          )
        ) {
          colY -= this.minChannelSpacing;
        }
        usedArcYs.push(colY);

        const path = [
          `M${x1},${y1}`,
          `L${midX1},${y1}`,
          `L${midX1},${colY}`,
          `L${colX},${colY}`,
          ...sharedTail,
        ].join(" ");

        results.push({
          path,
          classList: [
            "connection",
            edge.isRemote ? "remote-connection" : "local-connection",
          ],
        });
      }
    }

    // === Handle all other (in-lane and adjacent) edges ===
    for (const edge of otherEdges) {
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
        // Simple short connection
        path = `M${x1},${y1 + this.adjacentOffsetY} L${x2},${
          y2 + this.adjacentOffsetY
        }`;
      } else {
        // Normal in-lane arc
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
