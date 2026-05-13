import type { ConnectionRouter, RoutedEdge } from "./connectionRouter";
import type { Edge, Node } from "../layout/editorNodeGraph";

const LOCAL_CORNER_RADIUS = 22;

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
        : buildCurvedPath(edge.routePoints, LOCAL_CORNER_RADIUS);

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

function buildCurvedPath(points: RoutePoint[], radius: number): string {
  if (points.length === 2) {
    const [start, end] = points;
    const controlY = start.y + (end.y - start.y) / 2;
    return `M${start.x},${start.y} C${start.x},${controlY} ${end.x},${controlY} ${end.x},${end.y}`;
  }

  const commands = [`M${points[0].x},${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const entry = pointAlongSegment(current, previous, radius);
    const exit = pointAlongSegment(current, next, radius);
    commands.push(`L${entry.x},${entry.y}`);
    commands.push(`Q${current.x},${current.y} ${exit.x},${exit.y}`);
  }
  const last = points[points.length - 1];
  commands.push(`L${last.x},${last.y}`);
  return commands.join(" ");
}

function pointAlongSegment(
  from: RoutePoint,
  to: RoutePoint,
  maxDistance: number,
): RoutePoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return from;
  }
  const distance = Math.min(maxDistance, length / 2);
  const ratio = distance / length;
  return {
    x: from.x + dx * ratio,
    y: from.y + dy * ratio,
  };
}
