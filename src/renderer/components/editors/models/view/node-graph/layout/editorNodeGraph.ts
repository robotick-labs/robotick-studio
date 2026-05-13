import type { Workload } from "../../../document/modelData.js";

export type NodeId = string;

export type NodeKind =
  | "workload"
  | "group"
  | "label"
  | "model"
  | "collapsed-model"
  | "stub";

export interface Node {
  id: NodeId;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lane: number; // lane index (thread) within its section
  workload?: Workload;
  meta?: {
    modelId?: string;
    type?: string;
    children?: NodeId[];
    section?: number;
    collapsed?: boolean;
    subtitle?: string;
    stubDirection?: "incoming" | "outgoing";
    slot?: number;
    layoutDirection?: "vertical-offset";
  };
}

export interface Edge {
  from: NodeId;
  to: NodeId;
  isRemote?: boolean;
  fromPath?: string;
  toPath?: string;
  routePoints?: Array<{ x: number; y: number }>;
}

export interface RectFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaneLayout {
  laneIndex: number;
  frame: RectFrame;
  label: string;
}

export interface AddSlotLayout {
  laneIndex: number;
  frame: RectFrame;
}

export interface Section {
  index: number;
  modelId: string;
  yStart: number;
  laneCount: number;
  laneHeight: number;
  maxNodes: number;
  labelY: number;
  rootType?: string;
  hasSequencedGroup?: boolean;
  collapsed?: boolean;
  layoutDirection?: "vertical-offset";
  frame?: RectFrame;
  lanes?: LaneLayout[];
  addSlots?: AddSlotLayout[];
}

export class GraphDoc {
  readonly nodes = new Map<NodeId, Node>();
  readonly edges: Edge[] = [];
  sections: Section[] = [];
  version = 0;

  upsertNode(n: Node): void {
    this.nodes.set(n.id, n);
    this.version++;
  }
  moveNode(id: NodeId, x: number, y: number): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.x = x;
    n.y = y;
    this.version++;
  }
  setEdges(edges: Edge[]): void {
    this.edges.length = 0;
    this.edges.push(...edges);
    this.version++;
  }
  setSections(sections: Section[]): void {
    this.sections = sections.slice();
    this.version++;
  }
  getNode(id: NodeId): Node | undefined {
    return this.nodes.get(id);
  }

  bounds(): { x: number; y: number; w: number; h: number } {
    if (this.nodes.size === 0) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of this.nodes.values()) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
}
