import type { Node } from "../editorNodeGraph";
export interface ConnectionRouter {
  route(from: Node, to: Node): string;
}
