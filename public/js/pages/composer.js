const nodeSize = { width: 140, height: 40 };
let svg, swimlaneLayer, groupLayer, connectionsLayer, nodeLayer;
let currentConnections = [];

export function init() {
  svg = document.getElementById('graph');

  swimlaneLayer = createSvgLayer('swimlanes-layer');
  groupLayer = createSvgLayer('groups-layer');
  connectionsLayer = createSvgLayer('connections-layer');
  nodeLayer = createSvgLayer('nodes-layer');

  svg.appendChild(swimlaneLayer);
  svg.appendChild(groupLayer);
  svg.appendChild(connectionsLayer);
  svg.appendChild(nodeLayer);

  loadAndRenderModel();
}

function createSvgLayer(id) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', id);
  return g;
}

async function loadAndRenderModel() {
  try {
    const model = await loadModel("robotick-knitware/robots/barr-e/barr-e.project.yaml", "models/barr-e-brain.model.yaml");
    const root = model.workloads.find(w => w.name === model.root);
    if (!root || !root.children) throw new Error('Root with children not found');

    const lanes = root.children.length;
    const laneHeight = 400 / lanes;
    drawSwimlanes(lanes, laneHeight);

    const startX = 100;
    const spacing = 180;
    const offsetY = (laneHeight - nodeSize.height) / 2;

    root.children.forEach((childId, idx) => {
      const workload = model.workloads.find(w => w.name === childId);
      const y = idx * laneHeight + offsetY;
      if (workload.children) {
        workload.children.forEach((subId, j) => {
          createNode(subId, startX + j * spacing, y);
        });
        const boxWidth = workload.children.length * spacing + 20;
        createGroupBox(workload.id, startX - 10, y - 10, boxWidth, nodeSize.height + 20);
      } else {
        createNode(childId, startX, y);
      }
    });

   const conns = (model.connections || []).map(dc => ({
      from: dc.from.split('.')[0],
      to: dc.to.split('.')[0],
    }));
    updateConnections(conns);
  } catch (err) {
    console.error('Error loading or rendering model:', err);
  }
}

async function loadModel(project_path, model_path) {
  const res = await fetch(`http://0.0.0.0:7081/query/get-model?project_path=${project_path}&model_path=${model_path}`);
  if (!res.ok) throw new Error("Failed to fetch model");
  return await res.json();   // built-in JSON parser
}

function drawSwimlanes(count, height) {
  for (let i = 0; i < count; i++) {
    const y = i * height;

    const lane = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    lane.classList.add('swimlane');
    lane.setAttribute('x', '0');
    lane.setAttribute('y', y);
    lane.setAttribute('width', '1000');
    lane.setAttribute('height', height);
    swimlaneLayer.appendChild(lane);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.classList.add('label');
    label.setAttribute('x', '10');
    label.setAttribute('y', y + 20);
    label.textContent = `Thread ${i + 1}`;
    swimlaneLayer.appendChild(label);
  }
}

function createNode(id, x, y) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.classList.add('workload-node');
  g.setAttribute('id', id);
  g.setAttribute('transform', `translate(${x},${y})`);

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.classList.add('workload');
  rect.setAttribute('width', nodeSize.width);
  rect.setAttribute('height', nodeSize.height);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '10');
  text.setAttribute('y', '25');
  text.textContent = id;

  g.appendChild(rect);
  g.appendChild(text);
  nodeLayer.appendChild(g);

  makeDraggable(g);
}

function createGroupBox(id, x, y, w, h) {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.classList.add('group');
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', w);
  rect.setAttribute('height', h);
  groupLayer.appendChild(rect);
}

function makeDraggable(node) {
  let offsetX = 0, offsetY = 0;
  const pt = svg.createSVGPoint();

  const toSvgCoords = e => {
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  node.addEventListener('mousedown', e => {
    const start = toSvgCoords(e);
    const matrix = node.transform.baseVal.getItem(0).matrix;
    offsetX = start.x - matrix.e;
    offsetY = start.y - matrix.f;

    const onMouseMove = ev => {
      const { x, y } = toSvgCoords(ev);
      node.setAttribute('transform', `translate(${x - offsetX},${y - offsetY})`);
      updateConnections(currentConnections);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', () => {
      window.removeEventListener('mousemove', onMouseMove);
    }, { once: true });
  });
}

function updateConnections(conns) {
  currentConnections = conns;

  while (connectionsLayer.firstChild) {
    connectionsLayer.removeChild(connectionsLayer.firstChild);
  }

  conns.forEach(c => {
    const from = document.getElementById(c.from);
    const to = document.getElementById(c.to);
    if (!from || !to) return;

    const fm = from.transform.baseVal.getItem(0).matrix;
    const tm = to.transform.baseVal.getItem(0).matrix;

    const x1 = fm.e + nodeSize.width;
    const y1 = fm.f + nodeSize.height / 2;
    const x2 = tm.e;
    const y2 = tm.f + nodeSize.height / 2;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('connection');
    path.setAttribute('d', `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`);
    connectionsLayer.appendChild(path);
  });
}
