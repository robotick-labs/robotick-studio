import type { ConnectionRouter, RoutedEdge } from "./connectionRouter";
import type { Edge, Node } from "../layout/editorNodeGraph";

// ELK is the authoritative routing source. Edges without ELK points are not rendered.
export class RectilinearRouter implements ConnectionRouter {
  routeAll(edges: Edge[], getNode: (id: string) => Node | undefined): RoutedEdge[] {
    const results: RoutedEdge[] = [];

    for (const edge of edges) {
      const from = getNode(edge.from);
      const to = getNode(edge.to);
      if (!from || !to || !edge.routePoints || edge.routePoints.length < 2) {
        continue;
      }
      const path = edge.routePoints
        .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
        .join(" ");

      results.push({
        from: edge.from,
        to: edge.to,
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
