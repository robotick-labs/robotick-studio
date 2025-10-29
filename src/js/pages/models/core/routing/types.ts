import type { Node } from "../graphDoc";

export interface ConnectionRouter {
  route(from: Node, to: Node): string; // SVG path 'd'
}
