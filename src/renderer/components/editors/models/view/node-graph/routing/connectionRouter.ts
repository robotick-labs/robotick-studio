import type { Node, Edge } from "../layout/editorNodeGraph";

export interface RoutedEdge {
  from: string;
  to: string;
  path: string;
  classList: string[];
  fromPath?: string;
  toPath?: string;
}

export interface ConnectionRouter {
  routeAll(
    edges: Edge[],
    getNode: (id: string) => Node | undefined
  ): RoutedEdge[];
}
