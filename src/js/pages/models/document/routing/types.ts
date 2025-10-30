import type { Node } from "../../view/node-graph/editorNodeGraph";
export interface ConnectionRouter {
  route(from: Node, to: Node): string;
}
