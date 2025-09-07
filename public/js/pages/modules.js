const nodeSize = { width: 140, height: 40 };
let svg, swimlaneLayer, groupLayer, connectionsLayer, nodeLayer;
let currentLocalConns = [];
let currentRemoteConns = [];

const marginX = 20;

import currentProject from "/js/core/current-project.js";

export function init() {
  svg = document.getElementById("graph");

  swimlaneLayer = createSvgLayer("swimlanes-layer");
  groupLayer = createSvgLayer("groups-layer");
  connectionsLayer = createSvgLayer("connections-layer");
  nodeLayer = createSvgLayer("nodes-layer");

  svg.appendChild(swimlaneLayer);
  svg.appendChild(groupLayer);
  svg.appendChild(connectionsLayer);
  svg.appendChild(nodeLayer);

  loadAndRenderModel();
}

function createSvgLayer(id) {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("id", id);
  return g;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return await res.json();
}

async function loadAndRenderModel() {
  try {
    const projectPath = currentProject.getProjectPath();
    if (!projectPath) throw new Error("No project path set");

    const models = await fetchJSON(
      `http://localhost:7081/query/list-project-models?project_path=${encodeURIComponent(
        projectPath
      )}`
    );

    // --- helpers for this render pass ---
    let maxBottom = 0;
    const bumpSvgSize = (bottomY) => {
      maxBottom = Math.max(maxBottom, bottomY);
      const extra = 60; // padding
      svg.setAttribute("viewBox", `0 0 1000 ${maxBottom + extra}`);
      svg.setAttribute("height", maxBottom + extra);
    };
    const idFor = (modelPath, id) =>
      `${modelPath
        .split("/")
        .pop()
        .replace(/\.model\.yaml$/, "")}:${id}`;

    let yOffset = 40;

    const allLocalConns = [];
    const allRemoteConns = [];

    for (const modelPath of models) {
      const model = await loadModel(projectPath, modelPath);
      const root = model.workloads.find((w) => w.name === model.root);
      if (!root || !root.children) continue;

      const lanes = root.children.length;
      const laneHeight = 100;
      const sectionHeight = lanes * laneHeight;

      drawSectionLabel(modelPath, yOffset - 10);
      drawSwimlanes(lanes, laneHeight, yOffset);

      const startX = 100;
      const spacing = 180;
      const offsetY = (laneHeight - nodeSize.height) / 2;

      root.children.forEach((childId, idx) => {
        const workload = model.workloads.find((w) => w.name === childId);
        const y = yOffset + idx * laneHeight + offsetY;

        if (workload?.children?.length) {
          workload.children.forEach((subId, j) => {
            createNode(idFor(modelPath, subId), subId, startX + j * spacing, y);
          });
          const boxWidth = workload.children.length * spacing + 20;
          createGroupBox(
            idFor(modelPath, workload.id),
            startX - 10,
            y - 10,
            boxWidth,
            nodeSize.height + 20
          );
        } else {
          createNode(idFor(modelPath, childId), childId, startX, y);
        }
      });

      // 1. Local connections
      const localConns = (model.connections || []).map((dc) => ({
        from: idFor(modelPath, dc.from.split(".")[0]),
        to: idFor(modelPath, dc.to.split(".")[0]),
      }));

      // 2. Remote connections (to other models)
      const remoteConns = [];

      for (const remote of model.remote_models || []) {
        const remoteModelId = remote.name; // e.g. "spine"
        for (const dc of remote.connections || []) {
          const fromId = idFor(modelPath, dc.from.split(".")[0]); // local side
          const toId = `${remoteModelId}:${dc.to_remote.split(".")[0]}`; // remote side
          remoteConns.push({ from: fromId, to: toId, isRemote: true });
        }
      }

      allLocalConns.push(...localConns);
      allRemoteConns.push(...remoteConns);

      // Grow the SVG and move down for the next model
      bumpSvgSize(yOffset + sectionHeight);
      yOffset += sectionHeight + 60;
    }

    updateConnections(allLocalConns, allRemoteConns);
  } catch (err) {
    console.error("Error loading or rendering model:", err);
  }
}

function drawSectionLabel(name, y) {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", marginX + 10);
  text.setAttribute("y", y);
  text.classList.add("model-label");
  text.textContent = name;
  svg.appendChild(text);
}

async function loadModel(project_path, model_path) {
  const res = await fetch(
    `http://localhost:7081/query/get-model?project_path=${project_path}&model_path=${model_path}`
  );
  if (!res.ok) throw new Error("Failed to fetch model");
  return await res.json(); // built-in JSON parser
}

function drawSwimlanes(count, height, yStart = 0) {
  for (let i = 0; i < count; i++) {
    const y = yStart + i * height;

    const lane = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    lane.classList.add("swimlane");
    lane.setAttribute("x", marginX);
    lane.setAttribute("y", y);
    lane.setAttribute("rx", "6");
    lane.setAttribute("ry", "6");
    lane.setAttribute("width", 1000 - 2 * marginX);
    lane.setAttribute("height", height);
    swimlaneLayer.appendChild(lane);

    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    label.classList.add("label");
    label.setAttribute("x", marginX + 10);
    label.setAttribute("y", y + 20);
    label.textContent = `Thread ${i + 1}`;
    swimlaneLayer.appendChild(label);
  }
}

function createNode(id, name, x, y) {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.classList.add("workload-node");
  g.setAttribute("id", id);
  g.setAttribute("transform", `translate(${x},${y})`);

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.classList.add("workload");
  rect.setAttribute("width", nodeSize.width);
  rect.setAttribute("height", nodeSize.height);

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", "10");
  text.setAttribute("y", "25");
  text.textContent = name;

  g.appendChild(rect);
  g.appendChild(text);
  nodeLayer.appendChild(g);

  makeDraggable(g);
}

function createGroupBox(id, x, y, w, h) {
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.classList.add("group");
  rect.setAttribute("x", x);
  rect.setAttribute("y", y);
  rect.setAttribute("width", w);
  rect.setAttribute("height", h);
  groupLayer.appendChild(rect);
}

function makeDraggable(node) {
  let offsetX = 0,
    offsetY = 0;
  const pt = svg.createSVGPoint();

  const toSvgCoords = (e) => {
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  node.addEventListener("mousedown", (e) => {
    const start = toSvgCoords(e);
    const matrix = node.transform.baseVal.getItem(0).matrix;
    offsetX = start.x - matrix.e;
    offsetY = start.y - matrix.f;

    const onMouseMove = (ev) => {
      const { x, y } = toSvgCoords(ev);
      node.setAttribute(
        "transform",
        `translate(${x - offsetX},${y - offsetY})`
      );
      updateConnections(currentLocalConns, currentRemoteConns);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener(
      "mouseup",
      () => {
        window.removeEventListener("mousemove", onMouseMove);
      },
      { once: true }
    );
  });
}

function updateConnections(localConns, remoteConns) {
  currentLocalConns = localConns;
  currentRemoteConns = remoteConns;

  while (connectionsLayer.firstChild) {
    connectionsLayer.removeChild(connectionsLayer.firstChild);
  }

  const drawConnection = (c, styleClass) => {
    const from = document.getElementById(c.from);
    const to = document.getElementById(c.to);
    if (!from || !to) return;

    const fm = from.transform.baseVal.getItem(0).matrix;
    const tm = to.transform.baseVal.getItem(0).matrix;

    const x1 = fm.e + nodeSize.width;
    const y1 = fm.f + nodeSize.height / 2;
    const x2 = tm.e;
    const y2 = tm.f + nodeSize.height / 2;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("connection", styleClass);
    path.setAttribute(
      "d",
      `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`
    );
    connectionsLayer.appendChild(path);
  };

  localConns.forEach((c) => drawConnection(c, "local-connection"));
  remoteConns.forEach((c) => drawConnection(c, "remote-connection"));
}
