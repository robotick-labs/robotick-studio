import type { Node, Edge } from "../layout/editorNodeGraph";

export interface RoutedEdge {
  path: string;
  classList: string[];
}

export interface ConnectionRouter {
  routeAll(
    edges: Edge[],
    getNode: (id: string) => Node | undefined
  ): RoutedEdge[];
}
