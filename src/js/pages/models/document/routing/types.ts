import type { Node } from "../../view/node-graph/layout/editorNodeGraph";
export interface ConnectionRouter {
  route(from: Node, to: Node): string;
}
