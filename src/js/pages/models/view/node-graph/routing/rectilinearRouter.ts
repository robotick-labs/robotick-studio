import type { ConnectionRouter, RoutedEdge } from "./connectionRouter";
import type { Edge, Node } from "../layout/editorNodeGraph";

export class RectilinearRouter implements ConnectionRouter {
  constructor(
    private spacing = 180,
    private epsilon = 50,
    private straightLen = 15,
    private baseOffset = 25,
    private offsetScale = 0.04,
    private adjacentOffsetY = 5
  ) {}

  route(from: Node, to: Node): string {
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const isHorizAligned = Math.abs(dy) < this.epsilon;
    const isAdjacent =
      isHorizAligned && Math.abs(dx) - this.spacing < this.epsilon;

    if (isAdjacent) {
      return `M${x1},${y1 + this.adjacentOffsetY} L${x2},${
        y2 + this.adjacentOffsetY
      }`;
    }

    const midX1 = x1 + this.straightLen;
    const midX2 = x2 - this.straightLen;

    const offset = this.baseOffset + Math.abs(dx) * this.offsetScale;
    const arcDir = dy === 0 && dx > 0 ? -1 : 1;
    const arcY = y1 + arcDir * offset;

    return [
      `M${x1},${y1}`,
      `L${midX1},${y1}`,
      `L${midX1},${arcY}`,
      `L${midX2},${arcY}`,
      `L${midX2},${y2}`,
      `L${x2},${y2}`,
    ].join(" ");
  }

  routeAll(
    edges: Edge[],
    getNode: (id: string) => Node | undefined
  ): RoutedEdge[] {
    const results = [];

    for (const edge of edges) {
      const from = getNode(edge.from);
      const to = getNode(edge.to);
      if (!from || !to) continue;

      const path = this.route(from, to);
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
