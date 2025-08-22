const workloads = [];
let workloadIndex = 0;

async function fetchJSON(url) {
    try {
        const res = await fetch(`http://localhost:7090${url}`);
        return await res.json();
    } catch (err) {
        console.warn("Failed to fetch:", url, err);
        return null;
    }
}

async function fetchWorkloadDetails(name) {
    const [config, inputs, outputs] = await Promise.all([
        fetchJSON(`/api/telemetry/workload/config?name=${name}`),
        fetchJSON(`/api/telemetry/workload/inputs?name=${name}`),
        fetchJSON(`/api/telemetry/workload/outputs?name=${name}`),
    ]);

    const wl = workloads.find(w => w.name === name);
    if (!wl) return;
    wl.config = config;
    wl.inputs = inputs;
    wl.outputs = outputs;
}

async function fetchWorkloadLiveData(name) {
    const stats = await fetchJSON(`/api/telemetry/workload/stats?name=${name}`);
    const inputs = await fetchJSON(`/api/telemetry/workload/inputs?name=${name}`);
    const outputs = await fetchJSON(`/api/telemetry/workload/outputs?name=${name}`);

    const wl = workloads.find(w => w.name === name);
    if (!wl) return;

    if (stats) {
        wl.self_ms = stats.self_ms;
        wl.dt_ms = stats.dt_ms;
        wl.goal_ms = stats.goal_ms;
    }
    if (inputs) wl.inputs = inputs;
    if (outputs) wl.outputs = outputs;

    renderTelemetryTable();
}

function formatKeyValue(obj) {
    if (!obj || typeof obj !== "object") return "–";
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join("<br>");
}

function renderTelemetryTable() {
    const tbody = document.querySelector("#telemetry tbody");
    tbody.innerHTML = "";

    for (const w of workloads) {
        const row = document.createElement("tr");

        const raw_self = typeof w.self_ms === "number" ? w.self_ms : null;
        const raw_goal = typeof w.goal_ms === "number" ? w.goal_ms : null;

        const self_ms = typeof w.self_ms === "number" ? w.self_ms.toFixed(1) : "–";
        const dt_ms = typeof w.dt_ms === "number" ? w.dt_ms.toFixed(1) : "–";
        const goal_ms = typeof w.goal_ms === "number" ? w.goal_ms.toFixed(1) : "–";

        const load_pct = (raw_self !== null && raw_goal > 0)
            ? ((raw_self / raw_goal) * 100).toFixed(1)
            : "–";

        const config = formatKeyValue(w.config);
        const inputs = formatKeyValue(w.inputs);
        const outputs = formatKeyValue(w.outputs);

        // decide class based on load_pct
        let usageClass = "";
        if (typeof raw_self === "number" && raw_goal > 0) {
            const pct = (raw_self / raw_goal) * 100;
            if (pct < 105) usageClass = "usage-blue";
            else if (pct <= 110) usageClass = "usage-yellow";
            else usageClass = "usage-red";
        }

        row.innerHTML = `
            <td>${w.name}</td>
            <td>${w.type}</td>
            <td><div class="multiline">${config}</div></td>
            <td><div class="multiline">${inputs}</div></td>
            <td><div class="multiline">${outputs}</div></td>
            <td>${self_ms}</td>
            <td>${dt_ms}</td>
            <td>${goal_ms}</td>
            <td class="usage ${usageClass}">${load_pct}</td>
        `;

        tbody.appendChild(row);
    }
}

async function loadInitialData() {
    const data = await fetchJSON('/api/telemetry/workloads');
    if (!data || !Array.isArray(data.workloads)) return;

    for (const w of data.workloads) {
        workloads.push({
            name: w.name ?? "–",
            type: w.type ?? "–",
            dt_ms: null,
            goal_ms: null,
            load_pct: null,
            config: null,
            inputs: null,
            outputs: null
        });
        fetchWorkloadDetails(w.name);
    }
}

export function init() {

    // Periodically fetch live stats + I/O
    setInterval(() => {
        if (workloads.length === 0) return;
        const w = workloads[workloadIndex % workloads.length];
        workloadIndex++;
        fetchWorkloadLiveData(w.name);
    }, 100);

    loadInitialData();

}