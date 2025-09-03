let workloads = [];
let workloadIndex = 0;
let workloadRows = new Map(); // Map: workload.name → <tr>
let isFetchingLive = false;
let hasInitialWorkloads = false;
let canLivePoll = false;

// Fetch and parse JSON from the telemetry server
async function fetchJSON(url) {
    try {
        const res = await fetch(`http://localhost:7090${url}`);
        return await res.json();
    } catch (err) {
        console.warn("Fetch failed:", url, err);
        return null;
    }
}

// Fetch static config + field layout for a given workload
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

    renderTelemetryTable();
}

// Fetch live values (timing + I/O) for a single workload
async function fetchWorkloadLiveData(name) {
    if (isFetchingLive) return;
    isFetchingLive = true;

    const [stats, inputs, outputs] = await Promise.all([
        fetchJSON(`/api/telemetry/workload/stats?name=${name}`),
        fetchJSON(`/api/telemetry/workload/inputs?name=${name}`),
        fetchJSON(`/api/telemetry/workload/outputs?name=${name}`),
    ]);

    const wl = workloads.find(w => w.name === name);
    if (wl) {
        if (stats) {
            wl.self_ms = stats.self_ms;
            wl.dt_ms = stats.dt_ms;
            wl.goal_ms = stats.goal_ms;
        }
        if (inputs) wl.inputs = inputs;
        if (outputs) wl.outputs = outputs;
    }

    renderTelemetryTable();
    isFetchingLive = false;
}

// Format key-value object into a multiline HTML string
function formatKeyValue(obj) {
    if (!obj || typeof obj !== "object") return "–";
    return Object.entries(obj)
        .map(([k, v]) => `${k}: ${v}`)
        .join("<br>");
}

// Create and cache a <tr> element for a new workload
function createRowForWorkload(w) {
    const row = document.createElement("tr");

    // Create 9 <td> cells and optionally wrap in <div> for multiline
    for (let i = 0; i < 9; i++) {
        const td = document.createElement("td");

        // Multiline wrapping for config / inputs / outputs
        if (i >= 2 && i <= 4) {
            const div = document.createElement("div");
            div.className = "multiline";
            td.appendChild(div);
        }

        row.appendChild(td);
    }

    workloadRows.set(w.name, row);
    document.querySelector("#telemetry tbody").appendChild(row);
}

// Render or update telemetry table content in-place (preserves DOM)
function renderTelemetryTable() {
    for (const w of workloads) {
        let row = workloadRows.get(w.name);

        if (!row) {
            createRowForWorkload(w);
            row = workloadRows.get(w.name);
        }

        const raw_self = typeof w.self_ms === "number" ? w.self_ms : null;
        const raw_goal = typeof w.goal_ms === "number" ? w.goal_ms : null;

        const self_ms = raw_self?.toFixed(1) ?? "–";
        const dt_ms = typeof w.dt_ms === "number" ? w.dt_ms.toFixed(1) : "–";
        const goal_ms = raw_goal?.toFixed(1) ?? "–";
        const load_pct = (raw_self !== null && raw_goal > 0)
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

// Poll the list of workloads repeatedly, and update if changed
async function pollWorkloadsForever() {
    while (true) {
        const data = await fetchJSON('/api/telemetry/workloads');
        const names = new Set();

        if (data?.workloads) {
            canLivePoll = true; // Heartbeat restored

            for (const w of data.workloads) {
                names.add(w.name);

                // Add any new workload not yet seen
                if (!workloads.find(existing => existing.name === w.name)) {
                    const newWl = {
                        name: w.name ?? "–",
                        type: w.type ?? "–",
                        dt_ms: null,
                        goal_ms: null,
                        self_ms: null,
                        config: null,
                        inputs: null,
                        outputs: null
                    };
                    workloads.push(newWl);
                    fetchWorkloadDetails(w.name);
                }
            }

            // Remove workloads that disappeared
            workloads = workloads.filter(w => names.has(w.name));
            workloadRows.forEach((row, name) => {
                if (!names.has(name)) {
                    row.remove();
                    workloadRows.delete(name);
                }
            });

            hasInitialWorkloads = workloads.length > 0;
        } else {
            canLivePoll = false; // Heartbeat lost
        }

        // Retry every 1s until we get data, then every 3s for updates
        await new Promise(r => setTimeout(r, hasInitialWorkloads ? 3000 : 1000));
    }
}

// Live polling loop — fetches stats + I/O from one workload per tick
async function startLivePolling() {
    while (true) {
        if (canLivePoll && workloads.length > 0) {
            const w = workloads[workloadIndex++ % workloads.length];
            await fetchWorkloadLiveData(w.name);
        }

        await new Promise(r => setTimeout(r, 50)); // One workload every 50ms
    }
}

// Initialize telemetry system
export function init() {
    workloads = [];
    workloadIndex = 0;
    workloadRows.clear();
    hasInitialWorkloads = false;

    pollWorkloadsForever();  // Dynamic discovery
    startLivePolling();      // Live stats polling
}
