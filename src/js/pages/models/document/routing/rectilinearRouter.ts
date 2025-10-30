import type { ConnectionRouter } from "./types";
import type { Node } from "../../view/node-graph/layout/editorNodeGraph";

export class RectilinearRouter implements ConnectionRouter {
  constructor(
    private spacing = 180,
    private epsilon = 50,
    private straightLen = 15,
    private baseOffset = 25,
    private offsetScale = 0.04,
    private adjacentOffsetY = 5
  ) {}

  route(from: Node, to: Node): string {
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const isHorizAligned = Math.abs(dy) < this.epsilon;
    const isAdjacent =
      isHorizAligned && Math.abs(dx) - this.spacing < this.epsilon;

    if (isAdjacent) {
      return `M${x1},${y1 + this.adjacentOffsetY} L${x2},${
        y2 + this.adjacentOffsetY
      }`;
    }

    const midX1 = x1 + this.straightLen;
    const midX2 = x2 - this.straightLen;

    const offset = this.baseOffset + Math.abs(dx) * this.offsetScale;
    const arcDir = dy === 0 && dx > 0 ? -1 : 1;
    const arcY = y1 + arcDir * offset;

    return [
      `M${x1},${y1}`,
      `L${midX1},${y1}`,
      `L${midX1},${arcY}`,
      `L${midX2},${arcY}`,
      `L${midX2},${y2}`,
      `L${x2},${y2}`,
    ].join(" ");
  }
}
