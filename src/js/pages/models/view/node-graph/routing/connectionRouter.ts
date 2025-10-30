import type { Node, Edge } from "../layout/editorNodeGraph";

export interface RoutedEdge {
  path: string;
  classList: string[];
}

export interface ConnectionRouter {
  route(from: Node, to: Node): string;
  routeAll(
    edges: Edge[],
    getNode: (id: string) => Node | undefined
  ): RoutedEdge[];
}
