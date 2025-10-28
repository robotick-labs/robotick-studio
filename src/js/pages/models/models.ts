// graph.ts

type Conn = { from: string; to: string; isRemote?: boolean };

interface Workload {
  name: string;
  type?: string;
  children?: string[];
}

interface DirectConnection {
  from: string;
  to: string;
}

interface RemoteDirectConnection {
  from: string;
  to_remote: string;
}

interface RemoteModelSpec {
  name: string;
  connections?: RemoteDirectConnection[];
}

interface ModelData {
  root: string;
  workloads: Workload[];
  connections?: DirectConnection[];
  remote_models?: RemoteModelSpec[];
}

const nodeSize = { width: 140, height: 40 } as const;
const marginX = 20;

let svg!: SVGSVGElement;
let swimlaneLayer!: SVGGElement;
let groupLayer!: SVGGElement;
let connectionsLayer!: SVGGElement;
let nodeLayer!: SVGGElement;

let currentLocalConns: Conn[] = [];
let currentRemoteConns: Conn[] = [];

import currentProject from "../../core/current-project.js";

export function init(): void {
  const el = document.getElementById("graph");
  if (!el || !(el instanceof SVGSVGElement)) {
    throw new Error(`#graph <svg> not found or not an SVGSVGElement`);
  }
  svg = el;

  swimlaneLayer = createSvgLayer("swimlanes-layer");
  groupLayer = createSvgLayer("groups-layer");
  connectionsLayer = createSvgLayer("connections-layer");
  nodeLayer = createSvgLayer("nodes-layer");

  svg.appendChild(swimlaneLayer);
  svg.appendChild(groupLayer);
  svg.appendChild(connectionsLayer);
  svg.appendChild(nodeLayer);

  void loadAndRenderModel();
}

function createSvgLayer(id: string): SVGGElement {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("id", id);
  return g;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return (await res.json()) as T;
}

const idFor = (modelPath: string, id: string): string =>
  `${
    modelPath
      .split("/")
      .pop()
      ?.replace(/\.model\.yaml$/, "") ?? ""
  }:${id}`;

async function loadAndRenderModel(): Promise<void> {
  try {
    const projectPath = (currentProject as any).getProjectPath?.();
    if (!projectPath) throw new Error("No project path set");

    const models = await fetchJSON<string[]>(
      `http://localhost:7081/query/list-project-models?project_path=${encodeURIComponent(
        projectPath
      )}`
    );

    let yOffset = 40;
    let maxTotalNodeCount = 0;
    const allLocalConns: Conn[] = [];
    const allRemoteConns: Conn[] = [];

    for (const modelPath of models) {
      const model = await loadModel(projectPath, modelPath);
      const root = model.workloads.find((w) => w.name === model.root);
      if (!root) continue;

      drawSectionLabel(modelPath, yOffset - 10);

      const { height: sectionHeight, maxNodes } = drawSwimlanes(
        modelPath,
        root,
        model.workloads,
        100,
        yOffset
      );

      maxTotalNodeCount = Math.max(maxTotalNodeCount, maxNodes);
      yOffset += sectionHeight + 60;

      const localConns: Conn[] = (model.connections ?? []).map((dc) => ({
        from: idFor(modelPath, dc.from.split(".")[0]),
        to: idFor(modelPath, dc.to.split(".")[0]),
      }));

      const remoteConns: Conn[] = [];
      for (const remote of model.remote_models ?? []) {
        const remoteModelId = remote.name;
        for (const dc of remote.connections ?? []) {
          const fromId = idFor(modelPath, dc.from.split(".")[0]);
          const toId = `${remoteModelId}:${dc.to_remote.split(".")[0]}`;
          remoteConns.push({ from: fromId, to: toId, isRemote: true });
        }
      }

      allLocalConns.push(...localConns);
      allRemoteConns.push(...remoteConns);
    }

    // === Final sizing ===
    const finalWidth =
      marginX * 2 + 120 + (maxTotalNodeCount - 1) * 180 + nodeSize.width + 40;
    svg.setAttribute("width", String(finalWidth));
    svg.setAttribute("height", String(yOffset));
    svg.setAttribute("viewBox", `0 0 ${finalWidth} ${yOffset + 60}`);

    swimlaneLayer
      .querySelectorAll<SVGRectElement>("rect.swimlane")
      .forEach((lane) =>
        lane.setAttribute("width", String(finalWidth - 2 * marginX))
      );

    updateConnections(allLocalConns, allRemoteConns);
  } catch (err) {
    console.error("Error loading or rendering model:", err);
  }
}

function drawSectionLabel(name: string, y: number): void {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", String(marginX + 10));
  text.setAttribute("y", String(y));
  text.classList.add("model-label");
  text.textContent = name;
  svg.appendChild(text);
}

async function loadModel(
  project_path: string,
  model_path: string
): Promise<ModelData> {
  const res = await fetch(
    `http://localhost:7081/query/get-model?project_path=${encodeURIComponent(
      project_path
    )}&model_path=${encodeURIComponent(model_path)}`
  );
  if (!res.ok) throw new Error("Failed to fetch model");
  return (await res.json()) as ModelData;
}

function drawSwimlanes(
  modelPath: string,
  root: Workload,
  workloads: Workload[],
  height: number,
  yStart = 0
): { height: number; maxNodes: number } {
  const startX = 120;
  const spacing = 180;
  const offsetY = (height - nodeSize.height) / 2;

  let lanes: Workload[] = [];

  if (root.type === "SyncedGroupWorkload") {
    lanes = (root.children ?? [])
      .map((childId) => workloads.find((w) => w.name === childId))
      .filter(Boolean) as Workload[];
  } else {
    lanes = [root];
  }

  let maxNodeCount = 0;
  const totalHeight = lanes.length * height;

  lanes.forEach((laneParent, i) => {
    const y = yStart + i * height;

    const lane = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    lane.classList.add("swimlane");
    lane.setAttribute("x", String(marginX));
    lane.setAttribute("y", String(y));
    lane.setAttribute("rx", "6");
    lane.setAttribute("ry", "6");
    lane.setAttribute("width", "0"); // Will be filled in later
    lane.setAttribute("height", String(height));
    swimlaneLayer.appendChild(lane);

    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    label.classList.add("label");
    label.setAttribute("x", String(marginX + 10));
    label.setAttribute("y", String(y + 20));
    label.textContent = `Thread ${i + 1}`;
    swimlaneLayer.appendChild(label);

    const all: string[] = [laneParent.name];

    all.forEach((childId, idx) => {
      const workload = workloads.find((w) => w.name === childId);
      if (!workload) return;

      const x = startX + idx * spacing;
      maxNodeCount = Math.max(maxNodeCount, idx + 1);

      if (workload.children?.length) {
        workload.children.forEach((subId, j) => {
          const sub = workloads.find((w) => w.name === subId);
          if (!sub) return;
          maxNodeCount = Math.max(maxNodeCount, j + 1);
          createNode(
            idFor(modelPath, sub.name),
            sub.name,
            startX + j * spacing,
            y + offsetY
          );
        });

        const boxWidth = workload.children.length * spacing;
        createGroupBox(
          idFor(modelPath, workload.name),
          startX - 20,
          y + offsetY - 10,
          boxWidth,
          nodeSize.height + 20
        );
      } else {
        createNode(
          idFor(modelPath, workload.name),
          workload.name,
          x,
          y + offsetY
        );
      }
    });
  });

  return { height: totalHeight, maxNodes: maxNodeCount };
}

function createNode(id: string, name: string, x: number, y: number): void {
  const padL = 10;
  const padR = 8;
  const usable = nodeSize.width - padL - padR;

  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.classList.add("workload-node");
  g.setAttribute("id", id);
  g.setAttribute("transform", `translate(${x},${y})`);

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.classList.add("workload");
  rect.setAttribute("width", String(nodeSize.width));
  rect.setAttribute("height", String(nodeSize.height));

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", String(padL));
  text.setAttribute("y", "25");
  text.textContent = name;

  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = name;
  text.appendChild(title);

  g.appendChild(rect);
  g.appendChild(text);
  nodeLayer.appendChild(g);

  ellipsizeSvgText(text, name, usable);
  makeDraggable(g);
}

function ellipsizeSvgText(
  textEl: SVGTextElement,
  full: string,
  maxWidth: number
): void {
  textEl.textContent = full;
  if (textEl.getComputedTextLength() <= maxWidth) return;

  const ellipsis = "…";
  textEl.textContent = ellipsis;
  const ellW = textEl.getComputedTextLength();
  if (ellW > maxWidth) return;

  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    textEl.textContent = full.slice(0, mid) + ellipsis;
    const w = textEl.getComputedTextLength();
    if (w <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  textEl.textContent = full.slice(0, lo) + ellipsis;
  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = full;
  textEl.appendChild(title);
}

function createGroupBox(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.classList.add("group");
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  groupLayer.appendChild(rect);
}

function makeDraggable(node: SVGGElement): void {
  let offsetX = 0;
  let offsetY = 0;
  const pt = svg.createSVGPoint();

  const toSvgCoords = (e: MouseEvent): DOMPoint => {
    pt.x = e.clientX;
    pt.y = e.clientY;

    const ctm = svg.getScreenCTM();
    if (!ctm) return pt;
    return pt.matrixTransform(ctm.inverse());
  };

  node.addEventListener("mousedown", (e: MouseEvent) => {
    const start = toSvgCoords(e);
    const base = node.transform.baseVal;
    if (base.numberOfItems === 0) {
      const t = svg.createSVGTransform();
      t.setTranslate(0, 0);
      base.appendItem(t);
    }
    const matrix = base.getItem(0).matrix;

    offsetX = start.x - matrix.e;
    offsetY = start.y - matrix.f;

    const onMouseMove = (ev: MouseEvent) => {
      const { x, y } = toSvgCoords(ev);
      node.setAttribute(
        "transform",
        `translate(${x - offsetX},${y - offsetY})`
      );
      updateConnections(currentLocalConns, currentRemoteConns);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp, { once: true });
  });
}

function updateConnections(localConns: Conn[], remoteConns: Conn[]): void {
  currentLocalConns = localConns;
  currentRemoteConns = remoteConns;

  while (connectionsLayer.firstChild) {
    connectionsLayer.removeChild(connectionsLayer.firstChild);
  }

  const drawConnection = (c: Conn, styleClass: string): void => {
    const from = document.getElementById(c.from) as SVGGElement | null;
    const to = document.getElementById(c.to) as SVGGElement | null;
    if (!from || !to) return;

    const fm = from.transform.baseVal.getItem(0).matrix;
    const tm = to.transform.baseVal.getItem(0).matrix;

    const x1 = fm.e + nodeSize.width;
    const y1 = fm.f + nodeSize.height / 2;
    const x2 = tm.e;
    const y2 = tm.f + nodeSize.height / 2;

    const spacing = 180;
    const EPSILON = 2;
    const STRAIGHT_LEN = 15;
    const BASE_ARC_HEIGHT = 30; // min vertical bend
    const ARC_SCALE = 0.05; // how much vertical bend scales with dx

    const dx = x2 - x1;
    const dy = y2 - y1;
    const isHorizAligned = Math.abs(dy) < EPSILON;
    const isAdjacent = isHorizAligned && Math.abs(dx) - spacing < EPSILON;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("connection", styleClass);

    if (isAdjacent) {
      path.setAttribute("d", `M${x1},${y1} L${x2},${y2}`);
    } else {
      const midX1 = x1 + STRAIGHT_LEN;
      const midX2 = x2 - STRAIGHT_LEN;

      const arcHeight = BASE_ARC_HEIGHT + Math.abs(dx) * ARC_SCALE;
      const arcDir = dy < 0 || dx > 0 ? -1 : 1; // Up for left→right, down for right→left
      const arcOffset = arcDir * arcHeight;

      const cx1 = midX1;
      const cy1 = y1 + arcOffset;

      const cx2 = midX2;
      const cy2 = y2 + arcOffset;

      path.setAttribute(
        "d",
        `M${x1},${y1} ` +
          `L${midX1},${y1} ` +
          `C${cx1},${cy1} ${cx2},${cy2} ${midX2},${y2} ` +
          `L${x2},${y2}`
      );
    }

    connectionsLayer.appendChild(path);
  };

  localConns.forEach((c) => drawConnection(c, "local-connection"));
  remoteConns.forEach((c) => drawConnection(c, "remote-connection"));
}
