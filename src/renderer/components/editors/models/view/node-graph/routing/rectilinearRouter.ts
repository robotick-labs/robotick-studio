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
      const path = edge.isRemote
        ? buildStraightPath(edge.routePoints)
        : buildSplinePath(edge.routePoints);

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

type RoutePoint = { x: number; y: number };

function buildStraightPath(points: RoutePoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

function buildSplinePath(points: RoutePoint[]): string {
  if (points.length < 2) {
    return buildStraightPath(points);
  }
  if ((points.length - 1) % 3 === 0) {
    const commands = [`M${points[0].x},${points[0].y}`];
    for (let index = 1; index < points.length; index += 3) {
      const controlA = points[index];
      const controlB = points[index + 1];
      const end = points[index + 2];
      commands.push(
        `C${controlA.x},${controlA.y} ${controlB.x},${controlB.y} ${end.x},${end.y}`,
      );
    }
    return commands.join(" ");
  }
  if (points.length === 2) {
    const [start, end] = points;
    const controlY = start.y + (end.y - start.y) / 2;
    return `M${start.x},${start.y} C${start.x},${controlY} ${end.x},${controlY} ${end.x},${end.y}`;
  }
  if (points.length === 3) {
    const [start, control, end] = points;
    return `M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`;
  }

  return buildStraightPath(points);
}
