import currentProject from "../core/current-project.js";

async function fetchAllModelJSONs() {
  const projectPath = currentProject.getProjectPath();
  if (!projectPath) throw new Error("No project path set");

  const modelPaths = await fetchJSON(
    "http://localhost:7081",
    `/query/list-project-models?project_path=${encodeURIComponent(projectPath)}`
  );

  const results = [];

  for (const modelPath of modelPaths) {
    const json = await fetchJSON(
      "http://localhost:7081",
      `/query/get-model?project_path=${encodeURIComponent(
        projectPath
      )}&model_path=${encodeURIComponent(modelPath)}`
    );

    const modelName = json.name
      ? json.name
      : modelPath
          .split("/")
          .pop()
          .replace(/\.model\.yaml$/, "");

    const telemetryPort =
      json.telemetry && json.telemetry.port ? json.telemetry.port : "7090";

    results.push({
      modelName: modelName,
      engineURL: `http://localhost:${telemetryPort}`, // or customize this per model if needed
      modelPath,
      json,
    });
  }

  return results;
}

async function getEngineModels() {
  const models = await fetchAllModelJSONs();

  console.log(models);

  return models.map((m) => ({
    modelName: m.modelName,
    modelPath: m.modelPath,
    instanceURL: m.engineURL, // replace with real URL logic if needed
  }));
}

const engineStates = new Map(); // url → { workloads, workloadIndex, rows, etc. }

function urlToId(url) {
  return url.replace(/[:/.]/g, "_");
}

async function fetchJSON(urlBase, path) {
  try {
    const res = await fetch(`${urlBase}${path}`);
    return await res.json();
  } catch (err) {
    console.warn("Fetch failed:", urlBase + path, err);
    return null;
  }
}

function formatKeyValue(obj) {
  if (!obj || typeof obj !== "object") return "–";

  const lines = [];
  const seen = new WeakSet();

  const escapeHtml = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m])
    );

  const walk = (val, path) => {
    if (val === null) {
      lines.push(`${path}: null`);
      return;
    }

    const t = typeof val;

    if (t === "object") {
      if (seen.has(val)) {
        lines.push(`${path}: [Circular]`);
        return;
      }
      seen.add(val);

      if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${path}: []`);
        } else {
          val.forEach((item, i) => walk(item, `${path}[${i}]`));
        }
      } else {
        const keys = Object.keys(val);
        if (keys.length === 0) {
          lines.push(`${path}: {}`);
        } else {
          keys.forEach((k) => walk(val[k], path ? `${path}.${k}` : k));
        }
      }
    } else {
      // primitives (string/number/boolean/bigint/symbol) + functions (stringified)
      lines.push(`${path}: ${escapeHtml(val)}`);
    }
  };

  Object.keys(obj).forEach((k) => walk(obj[k], k));
  return lines.join("<br>");
}

function createTableForModel(modelInfo) {
  const url = modelInfo.instanceURL;
  const id = urlToId(url);

  const container = document.createElement("div");
  container.className = "telemetry-model";

  const h3 = document.createElement("h3");
  h3.textContent = modelInfo.modelName;
  container.appendChild(h3);

  const modelLabel = document.createElement("text");
  modelLabel.textContent = modelInfo.modelPath + " | " + url;
  modelLabel.className = "telemetry-model-label";
  container.appendChild(modelLabel);

  const table = document.createElement("table");
  table.id = `table-${id}`;
  table.className = "telemetry";

  table.innerHTML = `
    <thead>
      <tr>
        <th>Unique Name</th>
        <th>Workload Type</th>
        <th>Config</th>
        <th>Inputs</th>
        <th>Outputs</th>
        <th>Self Duration (ms)</th>
        <th>Time Delta (ms)</th>
        <th>Goal Period (ms)</th>
        <th>Usage %</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  container.appendChild(table);
  document.querySelector(".telemetry-table-container").appendChild(container);
}

function createRowForWorkload(w, url, state) {
  const row = document.createElement("tr");

  for (let i = 0; i < 9; i++) {
    const td = document.createElement("td");
    if (i >= 2 && i <= 4) {
      const div = document.createElement("div");
      div.className = "multiline";
      td.appendChild(div);
    }
    row.appendChild(td);
  }

  state.workloadRows.set(w.name, row);
  const tbody = document.querySelector(`#table-${urlToId(url)} tbody`);
  tbody.appendChild(row);
}

function renderTelemetryTable(url, state) {
  for (const w of state.workloads) {
    let row = state.workloadRows.get(w.name);
    if (!row) {
      createRowForWorkload(w, url, state);
      row = state.workloadRows.get(w.name);
    }

    const raw_self = typeof w.self_ms === "number" ? w.self_ms : null;
    const raw_goal = typeof w.goal_ms === "number" ? w.goal_ms : null;

    const self_ms = raw_self?.toFixed(1) ?? "–";
    const dt_ms = typeof w.dt_ms === "number" ? w.dt_ms.toFixed(1) : "–";
    const goal_ms = raw_goal?.toFixed(1) ?? "–";
    const load_pct =
      raw_self !== null && raw_goal > 0
        ? ((raw_self / raw_goal) * 100).toFixed(1)
        : "–";

    let usageClass = "";
    if (raw_self !== null && raw_goal > 0) {
      const pct = (raw_self / raw_goal) * 100;
      if (pct < 105) usageClass = "usage-blue";
      else if (pct <= 110) usageClass = "usage-yellow";
      else usageClass = "usage-red";
    }

    row.children[0].textContent = w.name;
    row.children[1].textContent = w.type.replace("Workload", "");
    row.children[2].firstChild.innerHTML = formatKeyValue(w.config);
    row.children[3].firstChild.innerHTML = formatKeyValue(w.inputs);
    row.children[4].firstChild.innerHTML = formatKeyValue(w.outputs);
    row.children[5].textContent = self_ms;
    row.children[6].textContent = dt_ms;
    row.children[7].textContent = goal_ms;
    row.children[8].textContent = load_pct;
    row.children[8].className = `usage ${usageClass}`;
  }
}

async function fetchWorkloadDetails(url, name, state) {
  const [config, inputs, outputs] = await Promise.all([
    fetchJSON(url, `/api/telemetry/workload/config?name=${name}`),
    fetchJSON(url, `/api/telemetry/workload/inputs?name=${name}`),
    fetchJSON(url, `/api/telemetry/workload/outputs?name=${name}`),
  ]);

  const wl = state.workloads.find((w) => w.name === name);
  if (!wl) return;

  wl.config = config;
  wl.inputs = inputs;
  wl.outputs = outputs;

  renderTelemetryTable(url, state);
}

async function fetchWorkloadLiveData(url, name, state) {
  const [stats, inputs, outputs] = await Promise.all([
    fetchJSON(url, `/api/telemetry/workload/stats?name=${name}`),
    fetchJSON(url, `/api/telemetry/workload/inputs?name=${name}`),
    fetchJSON(url, `/api/telemetry/workload/outputs?name=${name}`),
  ]);

  const wl = state.workloads.find((w) => w.name === name);
  if (wl) {
    if (stats) {
      wl.self_ms = stats.self_ms;
      wl.dt_ms = stats.dt_ms;
      wl.goal_ms = stats.goal_ms;
    }
    if (inputs) wl.inputs = inputs;
    if (outputs) wl.outputs = outputs;
  }

  renderTelemetryTable(url, state);
}

async function pollWorkloadsForever(url, state) {
  try {
    while (true) {
      if (state.pollingController.signal.aborted) return;

      const data = await fetchJSON(url, "/api/telemetry/workloads");
      const names = new Set();

      if (data?.workloads) {
        state.canLivePoll = true;

        for (const w of data.workloads) {
          names.add(w.name);

          if (!state.workloads.find((existing) => existing.name === w.name)) {
            const newWl = {
              name: w.name ?? "–",
              type: w.type ?? "–",
              dt_ms: null,
              goal_ms: null,
              self_ms: null,
              config: null,
              inputs: null,
              outputs: null,
            };
            state.workloads.push(newWl);
            fetchWorkloadDetails(url, w.name, state);
          }
        }

        state.workloads = state.workloads.filter((w) => names.has(w.name));
        state.workloadRows.forEach((row, name) => {
          if (!names.has(name)) {
            row.remove();
            state.workloadRows.delete(name);
          }
        });

        state.hasInitialWorkloads = state.workloads.length > 0;
      } else {
        state.canLivePoll = false;
      }

      await new Promise((r) =>
        setTimeout(r, state.hasInitialWorkloads ? 3000 : 1000)
      );
    }
  } catch (e) {
    if (e.name !== "AbortError") console.error("Polling error:", e);
  }
}

async function startLivePolling(url, state) {
  try {
    while (true) {
      if (state.livePollingController.signal.aborted) return;

      if (state.canLivePoll && state.workloads.length > 0) {
        const w =
          state.workloads[state.workloadIndex++ % state.workloads.length];
        await fetchWorkloadLiveData(url, w.name, state);
      }

      await new Promise((r) => setTimeout(r, 50));
    }
  } catch (e) {
    if (e.name !== "AbortError") console.error("Live polling error:", e);
  }
}

export async function init() {
  engineStates.clear();

  const engineModels = await getEngineModels();

  for (const engineModel of engineModels) {
    const url = engineModel.instanceURL;

    const state = {
      workloads: [],
      workloadIndex: 0,
      workloadRows: new Map(),
      pollingController: new AbortController(),
      livePollingController: new AbortController(),
      hasInitialWorkloads: false,
      canLivePoll: false,
    };

    engineStates.set(url, state);

    createTableForModel(engineModel);

    pollWorkloadsForever(url, state);
    startLivePolling(url, state);
  }
}

export function uninit() {
  for (const [url, state] of engineStates.entries()) {
    state.pollingController?.abort();
    state.livePollingController?.abort();

    for (const row of state.workloadRows.values()) {
      row.remove();
    }

    document
      .getElementById(`table-${urlToId(url)}`)
      ?.closest(".telemetry-model")
      ?.remove();
  }

  engineStates.clear();
}
