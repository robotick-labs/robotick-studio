import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import {
  GraphDoc,
  type AddSlotLayout,
  type Edge,
  type LaneLayout,
  type Node,
  type RectFrame,
  type Section,
} from "./editorNodeGraph";
import type { DocumentStore } from "../../../document/documentStore";
import type { Workload } from "../../../document/modelData";
import {
  getLayoutStrategy,
  resolveLayoutMode,
  type GraphLayoutDirection,
} from "./layoutStrategies";

const NODE_SIZE = { width: 168, height: 40 } as const;
const MODEL_HEADER_HEIGHT = 52;
const MODEL_HEADER_ROW_Y = 24;
const CONTENT_GAP_Y = 20;
const CONTENT_GAP_X = 24;
const LANE_PADDING_X = 20;
const LANE_PADDING_Y = 18;
const LANE_LABEL_HEIGHT = 32;
const HORIZONTAL_SECTION_GAP = 28;
const VERTICAL_SECTION_GAP = 36;
const PLUS_SLOT_SIZE = { width: 140, height: 40 } as const;
const PLUS_SLOT_GAP = 24;
const COLLAPSED_PLACEHOLDER_HEIGHT = 0;
const MODEL_HEADER_MIN_WIDTH = 280;

const elk = new ELK();

export interface LayoutSummary {
  sections: Section[];
  totalHeight: number;
  globalMaxNodes: number;
}

export type BuildGraphOptions = {
  collapsedModelIds?: Iterable<string>;
  modelSortKey?: ModelSortKey;
  layoutDirection?: GraphLayoutDirection;
};

export type ModelSortKey = "telemetry_port" | "model_name" | "model_path";
export type { GraphLayoutDirection } from "./layoutStrategies";

type SectionDraft = {
  section: Section;
  modelNode: Node;
  localFrame: RectFrame;
  laneLayouts: LaneLayout[];
  addSlots: AddSlotLayout[];
  internalEdges: Edge[];
};

export function nodeIdFor(modelPath: string, id: string): string {
  return `${modelPath}:${id}`;
}

export async function buildGraphDocFromModel(
  store: DocumentStore,
  doc: GraphDoc,
  options: BuildGraphOptions = {},
): Promise<LayoutSummary> {
  const collapsedModelIds = new Set(options.collapsedModelIds ?? []);
  const modelSortKey = options.modelSortKey ?? "model_path";
  const layoutMode = resolveLayoutMode(options.layoutDirection);
  const layoutStrategy = getLayoutStrategy(layoutMode);
  const modelIds = store
    .getModelIds()
    .sort((left, right) => compareModelIds(store, left, right, modelSortKey));

  doc.nodes.clear();
  doc.sections = [];

  const drafts: SectionDraft[] = [];
  const collapsedNodeIds = new Map<string, string>();
  let globalMaxNodes = 0;

  for (let sectionIndex = 0; sectionIndex < modelIds.length; sectionIndex += 1) {
    const modelId = modelIds[sectionIndex];
    const model = store.get(modelId)!;
    const root = model.workloads.find(
      (workload: Workload) => workload.id === model.root.workload_id,
    )!;
    const laneRoots =
      root.type === "SyncedGroupWorkload"
        ? (root.children ?? []).map((child) => child.workload_id)
        : [root.id];
    const hasSequencedGroup = model.workloads.some(
      (workload: Workload) => workload.type === "SequencedGroupWorkload",
    );
    const isCollapsed = collapsedModelIds.has(modelId);
    const modelName =
      typeof model.name === "string" && model.name.trim() ? model.name : modelId;
    const modelNode: Node = {
      id: nodeIdFor(modelId, "__model__"),
      kind: isCollapsed ? "collapsed-model" : "model",
      label: modelName,
      x: 0,
      y: 0,
      w: estimateModelHeaderWidth(
        modelName,
        modelFileName(store.getModelSourcePath(modelId) ?? modelId),
      ),
      h: MODEL_HEADER_HEIGHT,
      lane: 0,
      meta: {
        modelId,
        section: sectionIndex,
        collapsed: isCollapsed,
        subtitle: modelFileName(store.getModelSourcePath(modelId) ?? modelId),
      },
    };
    doc.upsertNode(modelNode);

    const section: Section = {
      index: sectionIndex,
      modelId,
      yStart: 0,
      laneCount: laneRoots.length,
      laneHeight: 0,
      maxNodes: 0,
      labelY: 0,
      rootType: root.type ?? "Workload",
      hasSequencedGroup,
      collapsed: isCollapsed,
      layoutDirection: layoutMode,
      frame: {
        x: 0,
        y: 0,
        width: 0,
        height: COLLAPSED_PLACEHOLDER_HEIGHT,
      },
      lanes: [],
      addSlots: [],
    };

    const laneWorkloadIds = laneRoots.map((_, laneIndex) =>
      store.laneChildren(modelId, laneIndex),
    );
    section.maxNodes = laneWorkloadIds.reduce(
      (max, laneIds) => Math.max(max, laneIds.length),
      0,
    );
    globalMaxNodes = Math.max(globalMaxNodes, section.maxNodes);

    const internalEdges: Edge[] = [];

    if (isCollapsed) {
      collapsedNodeIds.set(modelId, modelNode.id);
      drafts.push({
        section,
        modelNode,
        localFrame: { x: 0, y: 0, width: 0, height: 0 },
        laneLayouts: [],
        addSlots: [],
        internalEdges,
      });
    } else {
      const workloadNodes = buildSectionWorkloadNodes(
        doc,
        modelId,
        model.workloads,
        laneWorkloadIds,
        sectionIndex,
        layoutMode,
      );
      const localConnections = buildInternalEdges(
        modelId,
        model.connections ?? [],
        workloadNodes,
      );
      internalEdges.push(...localConnections);
      await layoutSectionWorkloads(
        workloadNodes,
        laneWorkloadIds,
        internalEdges,
        layoutMode,
      );
      normalizeSectionGeometry(workloadNodes, internalEdges);
      const laneLayouts = buildLaneLayouts(
        workloadNodes,
        laneWorkloadIds,
        root.type ?? "Workload",
        hasSequencedGroup,
        layoutMode,
      );
      const addSlots = buildAddSlotLayouts(
        workloadNodes,
        laneLayouts,
        layoutMode,
      );
      const localFrame = unionFrames([
        ...laneLayouts.map((lane) => lane.frame),
        ...addSlots.map((slot) => slot.frame),
      ]);

      drafts.push({
        section,
        modelNode,
        localFrame,
        laneLayouts,
        addSlots,
        internalEdges,
      });
    }
  }

  positionSectionsAndModelNodes(drafts, layoutMode);
  commitSections(doc, drafts, layoutMode);

  const externalEdges = buildExternalEdges(store, modelIds, collapsedNodeIds, doc);
  const crossThreadEdges = drafts.flatMap((draft) =>
    draft.internalEdges.filter((edge) => edge.isInterThread),
  );
  const allEdges = [...drafts.flatMap((draft) => draft.internalEdges), ...externalEdges];
  await routeGlobalEdges(doc, [...crossThreadEdges, ...externalEdges], layoutMode);
  doc.setEdges(allEdges);

  const bounds = doc.bounds();
  return {
    sections: doc.sections,
    totalHeight: bounds.h + MODEL_HEADER_ROW_Y + MODEL_HEADER_HEIGHT + CONTENT_GAP_Y,
    globalMaxNodes,
  };
}

async function layoutSectionWorkloads(
  workloadNodes: Node[],
  laneWorkloadIds: string[][],
  edges: Edge[],
  layoutMode: GraphLayoutDirection,
): Promise<void> {
  const laneNodeIds = laneWorkloadIds.map((laneIds) =>
    laneIds
      .map((workloadId) => workloadNodes.find((node) => node.id.endsWith(`:${workloadId}`))?.id)
      .filter((nodeId): nodeId is string => Boolean(nodeId)),
  );
  const nodeById = new Map(workloadNodes.map((node) => [node.id, node] as const));

  for (const laneIds of laneNodeIds) {
    const laneNodes = laneIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is Node => Boolean(node));
    const laneNodeIdSet = new Set(laneIds);
    const laneEdges = edges.filter(
      (edge) =>
        !edge.isInterThread &&
        laneNodeIdSet.has(edge.from) &&
        laneNodeIdSet.has(edge.to),
    );
    await layoutThreadWorkloads(laneNodes, laneEdges, layoutMode);
  }

  positionLaneColumns(workloadNodes, laneNodeIds, edges);
}

async function layoutThreadWorkloads(
  workloadNodes: Node[],
  edges: Edge[],
  layoutMode: GraphLayoutDirection,
): Promise<void> {
  if (workloadNodes.length === 0) {
    return;
  }

  const strategy = getLayoutStrategy(layoutMode);
  const portsByNode = new Map<string, Map<string, string>>();
  const elkEdges: ElkExtendedEdge[] = [];
  let syntheticCount = 0;

  edges.forEach((edge, index) => {
    const sourcePort = `${edge.from}:out:${index}`;
    const targetPort = `${edge.to}:in:${index}`;
    addPort(portsByNode, edge.from, sourcePort, strategy.sourcePortSide);
    addPort(portsByNode, edge.to, targetPort, strategy.targetPortSide);
    elkEdges.push({
      id: `edge:${index}`,
      sources: [sourcePort],
      targets: [targetPort],
    });
  });

  const orderedNodeIds = workloadNodes
    .slice()
    .sort((left, right) => (left.meta?.slot ?? 0) - (right.meta?.slot ?? 0))
    .map((node) => node.id);
  for (let i = 0; i < orderedNodeIds.length - 1; i += 1) {
    const sourcePort = `${orderedNodeIds[i]}:synthetic-out:${syntheticCount}`;
    const targetPort = `${orderedNodeIds[i + 1]}:synthetic-in:${syntheticCount}`;
    addPort(portsByNode, orderedNodeIds[i], sourcePort, strategy.sourcePortSide);
    addPort(portsByNode, orderedNodeIds[i + 1], targetPort, strategy.targetPortSide);
    elkEdges.push({
      id: `synthetic:${syntheticCount++}`,
      sources: [sourcePort],
      targets: [targetPort],
    });
  }

  const root: ElkNode = {
    id: "section-root",
    children: workloadNodes.map((node) => ({
      id: node.id,
      width: node.w,
      height: node.h,
      x: node.x,
      y: node.y,
      layoutOptions: {
        "org.eclipse.elk.portConstraints": "FIXED_SIDE",
      },
      ports: Array.from(portsByNode.get(node.id)?.entries() ?? []).map(
        ([id, side]) => ({
          id,
          layoutOptions: {
            "org.eclipse.elk.port.side": side,
          },
        }),
      ),
    })),
    edges: elkEdges,
  };
  strategy.configureRoot(root, {
    hasRemoteEdges: false,
  });

  const result = await elk.layout(root);
  const laidOutNodes = new Map<string, { x: number; y: number }>();
  for (const child of result.children ?? []) {
    if (typeof child.id === "string") {
      laidOutNodes.set(child.id, {
        x: child.x ?? 0,
        y: child.y ?? 0,
      });
    }
  }
  workloadNodes.forEach((node) => {
    const laidOut = laidOutNodes.get(node.id);
    if (laidOut) {
      node.x = laidOut.x;
      node.y = laidOut.y;
    }
  });

  const routeByEdgeId = new Map<string, Array<{ x: number; y: number }>>();
  for (const edge of result.edges ?? []) {
    if (!edge.id?.startsWith("edge:")) {
      continue;
    }
    const section = edge.sections?.[0];
    if (!section?.startPoint || !section?.endPoint) {
      continue;
    }
    routeByEdgeId.set(edge.id, [
      { x: section.startPoint.x, y: section.startPoint.y },
      ...((section.bendPoints ?? []).map((point) => ({ x: point.x, y: point.y }))),
      { x: section.endPoint.x, y: section.endPoint.y },
    ]);
  }
  edges.forEach((edge, index) => {
    const routePoints = routeByEdgeId.get(`edge:${index}`);
    if (routePoints) {
      edge.routePoints = routePoints;
    }
  });
}

function buildSectionWorkloadNodes(
  doc: GraphDoc,
  modelId: string,
  workloads: Workload[],
  laneWorkloadIds: string[][],
  sectionIndex: number,
  layoutMode: GraphLayoutDirection,
): Node[] {
  const strategy = getLayoutStrategy(layoutMode);
  const nodes: Node[] = [];
  laneWorkloadIds.forEach((laneIds, laneIndex) => {
    laneIds.forEach((workloadId, slotIndex) => {
      const workload = workloads.find((candidate) => candidate.id === workloadId);
      if (!workload) {
        return;
      }
      const seeded = strategy.seedNodePosition({
        slot: slotIndex,
        lane: laneIndex,
        sectionIndex,
        laneCount: laneWorkloadIds.length,
        indexInSection: slotIndex,
      });
      const node: Node = {
        id: nodeIdFor(modelId, workload.id),
        kind: "workload",
        label: workload.name,
        x: seeded.x,
        y: seeded.y,
        w: NODE_SIZE.width,
        h: NODE_SIZE.height,
        lane: laneIndex,
        workload,
        meta: {
          modelId,
          section: sectionIndex,
          slot: slotIndex,
          layoutDirection: layoutMode,
          type: workload.type,
        },
      };
      doc.upsertNode(node);
      nodes.push(node);
    });
  });
  return nodes;
}

function addPort(
  portsByNode: Map<string, Map<string, string>>,
  nodeId: string,
  portId: string,
  side: string,
): void {
  let ports = portsByNode.get(nodeId);
  if (!ports) {
    ports = new Map<string, string>();
    portsByNode.set(nodeId, ports);
  }
  ports.set(portId, side);
}

function buildInternalEdges(
  modelId: string,
  connections: Array<{ from: string; to: string }>,
  workloadNodes: Node[],
): Edge[] {
  const nodeIds = new Set(workloadNodes.map((node) => node.id));
  const nodesById = new Map(workloadNodes.map((node) => [node.id, node] as const));
  const edges: Edge[] = [];
  connections.forEach((connection) => {
    const from = nodeIdFor(modelId, connection.from.split(".")[0]);
    const to = nodeIdFor(modelId, connection.to.split(".")[0]);
    if (nodeIds.has(from) && nodeIds.has(to)) {
      const fromNode = nodesById.get(from);
      const toNode = nodesById.get(to);
      edges.push({
        from,
        to,
        isInterThread:
          fromNode != null &&
          toNode != null &&
          fromNode.lane !== toNode.lane,
        fromPath: connection.from,
        toPath: connection.to,
      });
    }
  });
  return edges;
}

function buildExternalEdges(
  store: DocumentStore,
  modelIds: string[],
  collapsedNodeIds: Map<string, string>,
  doc: GraphDoc,
): Edge[] {
  const edges: Edge[] = [];

  for (const modelId of modelIds) {
    const model = store.get(modelId);
    if (!model) {
      continue;
    }

    for (const remoteModel of model.remote_models ?? []) {
      for (const connection of remoteModel.connections ?? []) {
        if (
          typeof connection.from_local === "string" &&
          typeof connection.to_remote === "string"
        ) {
          addExternalEdge(
            edges,
            doc,
            resolveNodeId(
              collapsedNodeIds,
              modelId,
              connection.from_local.split(".")[0],
              true,
            ),
            resolveNodeId(
              collapsedNodeIds,
              remoteModel.model_id,
              connection.to_remote.split(".")[0],
              true,
            ),
            connection.from_local,
            connection.to_remote,
          );
        } else if (
          typeof connection.from_remote === "string" &&
          typeof connection.to_local === "string"
        ) {
          addExternalEdge(
            edges,
            doc,
            resolveNodeId(
              collapsedNodeIds,
              remoteModel.model_id,
              connection.from_remote.split(".")[0],
              true,
            ),
            resolveNodeId(
              collapsedNodeIds,
              modelId,
              connection.to_local.split(".")[0],
              true,
            ),
            connection.from_remote,
            connection.to_local,
          );
        }
      }
    }
  }

  return edges;
}

function addExternalEdge(
  edges: Edge[],
  doc: GraphDoc,
  from: string | null,
  to: string | null,
  fromPath?: string,
  toPath?: string,
): void {
  if (!from || !to || !doc.getNode(from) || !doc.getNode(to)) {
    return;
  }
  edges.push({ from, to, fromPath, toPath, isRemote: true });
}

function normalizeSectionGeometry(nodes: Node[], edges: Edge[]): void {
  if (nodes.length === 0) {
    return;
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  nodes.forEach((node) => {
    node.x -= minX;
    node.y -= minY;
  });
  edges.forEach((edge) => {
    if (!edge.routePoints) {
      return;
    }
    edge.routePoints = edge.routePoints.map((point) => ({
      x: point.x - minX,
      y: point.y - minY,
    }));
  });
}

function positionLaneColumns(
  nodes: Node[],
  laneNodeIds: string[][],
  edges: Edge[],
): void {
  let cursorX = 0;
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));

  laneNodeIds.forEach((ids) => {
    const laneNodes = ids
      .map((id) => nodeById.get(id))
      .filter((node): node is Node => Boolean(node));
    if (laneNodes.length === 0) {
      cursorX += NODE_SIZE.width + CONTENT_GAP_X;
      return;
    }

    const minX = Math.min(...laneNodes.map((node) => node.x));
    const maxX = Math.max(...laneNodes.map((node) => node.x + node.w));
    const minY = Math.min(...laneNodes.map((node) => node.y));
    const deltaX = cursorX - minX;
    const deltaY = -minY;

    laneNodes.forEach((node) => {
      node.x += deltaX;
      node.y += deltaY;
    });

    const laneNodeIdSet = new Set(ids);
    edges.forEach((edge) => {
      if (
        edge.isInterThread ||
        !edge.routePoints ||
        !laneNodeIdSet.has(edge.from) ||
        !laneNodeIdSet.has(edge.to)
      ) {
        return;
      }
      edge.routePoints = edge.routePoints.map((point) => ({
        x: point.x + deltaX,
        y: point.y + deltaY,
      }));
    });

    cursorX += maxX - minX + LANE_PADDING_X * 2 + CONTENT_GAP_X;
  });
}

function buildLaneLayouts(
  nodes: Node[],
  laneWorkloadIds: string[][],
  rootType: string,
  hasSequencedGroup: boolean,
  layoutMode: GraphLayoutDirection,
): LaneLayout[] {
  const layouts: LaneLayout[] = [];
  laneWorkloadIds.forEach((laneIds, laneIndex) => {
    const laneNodes = nodes.filter((node) => node.lane === laneIndex);
    if (laneNodes.length === 0) {
      layouts.push({
        laneIndex,
        label: hasSequencedGroup ? `Thread ${laneIndex + 1} · Sequenced Group` : `Thread ${laneIndex + 1}`,
        frame: {
          x: laneIndex * (NODE_SIZE.width + CONTENT_GAP_X),
          y: 0,
          width: NODE_SIZE.width + LANE_PADDING_X * 2,
          height: NODE_SIZE.height + LANE_LABEL_HEIGHT + LANE_PADDING_Y * 2,
        },
      });
      return;
    }
    const minX = Math.min(...laneNodes.map((node) => node.x));
    const maxX = Math.max(...laneNodes.map((node) => node.x + node.w));
    const minY = Math.min(...laneNodes.map((node) => node.y));
    const maxY = Math.max(...laneNodes.map((node) => node.y + node.h));
    const frame: RectFrame = {
      x: minX - LANE_PADDING_X,
      y: minY - LANE_LABEL_HEIGHT,
      width: maxX - minX + LANE_PADDING_X * 2,
      height: maxY - minY + LANE_LABEL_HEIGHT + LANE_PADDING_Y,
    };
    layouts.push({
      laneIndex,
      label:
        hasSequencedGroup || rootType === "SequencedGroupWorkload"
          ? `Thread ${laneIndex + 1} · Sequenced Group`
          : `Thread ${laneIndex + 1}`,
      frame,
    });
  });

  return layouts.sort((left, right) => left.frame.x - right.frame.x);
}

function buildAddSlotLayouts(
  nodes: Node[],
  laneLayouts: LaneLayout[],
  layoutMode: GraphLayoutDirection,
): AddSlotLayout[] {
  return laneLayouts.map((laneLayout) => {
    const laneNodes = nodes.filter((node) => node.lane === laneLayout.laneIndex);
    const maxY =
      laneNodes.length > 0
        ? Math.max(...laneNodes.map((node) => node.y + node.h))
        : laneLayout.frame.y + laneLayout.frame.height - LANE_PADDING_Y;
    return {
      laneIndex: laneLayout.laneIndex,
      frame: {
        x: laneLayout.frame.x + laneLayout.frame.width / 2 - PLUS_SLOT_SIZE.width / 2,
        y: maxY + PLUS_SLOT_GAP,
        width: PLUS_SLOT_SIZE.width,
        height: PLUS_SLOT_SIZE.height,
      },
    };
  });
}

function positionSectionsAndModelNodes(
  drafts: SectionDraft[],
  layoutMode: GraphLayoutDirection,
): void {
  let cursorX = 24;
  const contentY = MODEL_HEADER_ROW_Y + MODEL_HEADER_HEIGHT + CONTENT_GAP_Y;
  drafts.forEach((draft) => {
    const columnWidth = Math.max(draft.modelNode.w, draft.localFrame.width);
    draft.modelNode.x = cursorX + (columnWidth - draft.modelNode.w) / 2;
    draft.modelNode.y = MODEL_HEADER_ROW_Y;
    const contentX = cursorX + (columnWidth - draft.localFrame.width) / 2;
    translateSectionDraft(draft, contentX, contentY);
    cursorX += columnWidth + VERTICAL_SECTION_GAP;
  });
}

function translateSectionDraft(
  draft: SectionDraft,
  offsetX: number,
  offsetY: number,
): void {
  const localFrame = draft.localFrame;
  const deltaX = offsetX - localFrame.x;
  const deltaY = offsetY - localFrame.y;

  draft.section.frame = translateFrame(localFrame, deltaX, deltaY);
  draft.section.yStart = draft.section.frame.y;
  draft.section.laneHeight = draft.section.frame.height;
  draft.section.labelY = draft.section.frame.y + 20;
  draft.section.lanes = draft.laneLayouts.map((lane) => ({
    laneIndex: lane.laneIndex,
    label: lane.label,
    frame: translateFrame(lane.frame, deltaX, deltaY),
  }));
  draft.section.addSlots = draft.addSlots.map((slot) => ({
    laneIndex: slot.laneIndex,
    frame: translateFrame(slot.frame, deltaX, deltaY),
  }));

  for (const edge of draft.internalEdges) {
    if (edge.routePoints) {
      edge.routePoints = edge.routePoints.map((point) => ({
        x: point.x + deltaX,
        y: point.y + deltaY,
      }));
    }
  }
}

function commitSections(
  doc: GraphDoc,
  drafts: SectionDraft[],
  layoutMode: GraphLayoutDirection,
): void {
  const sections: Section[] = [];
  drafts.forEach((draft) => {
    const deltaX = (draft.section.frame?.x ?? 0) - draft.localFrame.x;
    const deltaY = (draft.section.frame?.y ?? 0) - draft.localFrame.y;
    for (const node of doc.nodes.values()) {
      if (node.meta?.section !== draft.section.index || node.id === draft.modelNode.id) {
        continue;
      }
      node.x += deltaX;
      node.y += deltaY;
    }
    draft.section.layoutDirection = layoutMode;
    sections.push(draft.section);
  });
  doc.setSections(sections);
}

export function positionModelHeaders(doc: GraphDoc): void {
  let verticalCursorX = 24;
  for (const section of doc.sections) {
    const modelNode = Array.from(doc.nodes.values()).find(
      (node) =>
        (node.kind === "model" || node.kind === "collapsed-model") &&
        node.meta?.section === section.index,
    );
    if (!modelNode) {
      continue;
    }
    const frameX = section.frame?.x ?? verticalCursorX;
    const frameWidth = section.frame?.width ?? modelNode.w;
    modelNode.x = frameX + (frameWidth - modelNode.w) / 2;
    modelNode.y = MODEL_HEADER_ROW_Y;
    verticalCursorX = frameX + frameWidth + VERTICAL_SECTION_GAP;
  }
}

function translateFrame(frame: RectFrame, dx: number, dy: number): RectFrame {
  return {
    x: frame.x + dx,
    y: frame.y + dy,
    width: frame.width,
    height: frame.height,
  };
}

function unionFrames(frames: RectFrame[]): RectFrame {
  if (frames.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...frames.map((frame) => frame.x));
  const minY = Math.min(...frames.map((frame) => frame.y));
  const maxX = Math.max(...frames.map((frame) => frame.x + frame.width));
  const maxY = Math.max(...frames.map((frame) => frame.y + frame.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

async function routeGlobalEdges(
  doc: GraphDoc,
  edges: Edge[],
  _layoutMode: GraphLayoutDirection,
): Promise<void> {
  const routeTargets = edges.filter(
    (edge) =>
      (!edge.routePoints || edge.routePoints.length < 2) &&
      doc.getNode(edge.from) &&
      doc.getNode(edge.to),
  );
  if (routeTargets.length === 0) {
    return;
  }

  const routedNodeIds = new Set<string>();
  routeTargets.forEach((edge) => {
    routedNodeIds.add(edge.from);
    routedNodeIds.add(edge.to);
  });
  const routedNodes = Array.from(routedNodeIds)
    .map((id) => doc.getNode(id))
    .filter((node): node is Node => Boolean(node));
  if (routedNodes.length !== routedNodeIds.size) {
    return;
  }

  const duplicateCounts = new Map<string, number>();
  const duplicateIndexes = new Map<string, number>();
  routeTargets.forEach((edge) => {
    const key = `${edge.from}->${edge.to}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  });

  const elkEdges = routeTargets.map((edge, index) => {
    const from = doc.getNode(edge.from)!;
    const to = doc.getNode(edge.to)!;
    const key = `${edge.from}->${edge.to}`;
    const duplicateIndex = duplicateIndexes.get(key) ?? 0;
    duplicateIndexes.set(key, duplicateIndex + 1);
    const section = buildFixedGlobalSection(
      `global-edge:${index}:section`,
      from,
      to,
      duplicateIndex,
      duplicateCounts.get(key) ?? 1,
    );
    return {
      id: `global-edge:${index}`,
      sources: [edge.from],
      targets: [edge.to],
      sections: [section],
    };
  });

  const root: ElkNode = {
    id: "global-routing-root",
    children: routedNodes.map((node) => ({
      id: node.id,
      width: node.w,
      height: node.h,
      x: node.x,
      y: node.y,
    })),
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "fixed",
      "elk.edgeRouting": "ORTHOGONAL",
    },
  };

  const result = await elk.layout(root);
  const routesById = new Map<string, Array<{ x: number; y: number }>>();
  for (const edge of result.edges ?? []) {
    const section = edge.sections?.[0];
    if (!edge.id || !section?.startPoint || !section?.endPoint) {
      continue;
    }
    routesById.set(edge.id, [
      { x: section.startPoint.x, y: section.startPoint.y },
      ...((section.bendPoints ?? []).map((point) => ({ x: point.x, y: point.y }))),
      { x: section.endPoint.x, y: section.endPoint.y },
    ]);
  }

  routeTargets.forEach((edge, index) => {
    edge.routePoints = routesById.get(`global-edge:${index}`);
  });
}

function buildFixedGlobalSection(
  id: string,
  from: Node,
  to: Node,
  duplicateIndex: number,
  duplicateCount: number,
): {
  id: string;
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  bendPoints: Array<{ x: number; y: number }>;
} {
  const sourceX = distributedPortX(from, duplicateIndex, duplicateCount);
  const targetX = distributedPortX(to, duplicateIndex, duplicateCount);
  const startPoint = { x: sourceX, y: from.y + from.h };
  const endPoint = { x: targetX, y: to.y };
  const verticalGap = Math.abs(endPoint.y - startPoint.y);
  const laneOffset = 48 + duplicateIndex * 14;
  const midY =
    endPoint.y > startPoint.y
      ? startPoint.y + verticalGap / 2
      : Math.max(startPoint.y, endPoint.y) + laneOffset;

  return {
    id,
    startPoint,
    endPoint,
    bendPoints: [
      { x: startPoint.x, y: midY },
      { x: endPoint.x, y: midY },
    ],
  };
}

function distributedPortX(
  node: Node,
  duplicateIndex: number,
  duplicateCount: number,
): number {
  if (duplicateCount <= 1) {
    return node.x + node.w / 2;
  }
  return node.x + (node.w * (duplicateIndex + 1)) / (duplicateCount + 1);
}

function compareModelIds(
  store: DocumentStore,
  leftModelId: string,
  rightModelId: string,
  sortKey: ModelSortKey,
): number {
  const left = store.get(leftModelId);
  const right = store.get(rightModelId);
  const leftName =
    typeof left?.name === "string" && left.name.trim()
      ? left.name
      : leftModelId;
  const rightName =
    typeof right?.name === "string" && right.name.trim()
      ? right.name
      : rightModelId;

  if (sortKey === "model_name") {
    const byName = leftName.localeCompare(rightName);
    if (byName !== 0) {
      return byName;
    }
    return leftModelId.localeCompare(rightModelId);
  }

  if (sortKey === "telemetry_port") {
    const leftPort = Number(left?.telemetry?.port ?? 0);
    const rightPort = Number(right?.telemetry?.port ?? 0);
    if (leftPort !== rightPort) {
      return leftPort - rightPort;
    }
    return leftModelId.localeCompare(rightModelId);
  }

  return leftModelId.localeCompare(rightModelId);
}

function modelFileName(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}

function estimateModelHeaderWidth(modelName: string, subtitle: string): number {
  const longest = Math.max(modelName.length, subtitle.length);
  return Math.min(900, Math.max(MODEL_HEADER_MIN_WIDTH, 84 + longest * 7));
}

function resolveNodeId(
  collapsedNodeIds: Map<string, string>,
  modelId: string,
  workloadId: string,
  allowCollapsedAnchor: boolean,
): string | null {
  if (allowCollapsedAnchor) {
    const collapsedNodeId = collapsedNodeIds.get(modelId);
    if (collapsedNodeId) {
      return collapsedNodeId;
    }
  }
  return nodeIdFor(modelId, workloadId);
}
