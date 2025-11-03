import currentProject from "../../core/current-project.js";
import dots from "./launcher-dots.js";

// event-bus (exported so other systems can listen for run/stop events)
const launcherEvents = new EventTarget();
export { launcherEvents };

let playStopButton = null;
let restartButton = null;

let currentStatus = "stopped"; // 'stopped' | 'starting' | 'running'
let pollIntervalMs = 1000;
let stableCount = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkLauncherActive() {
  try {
    const res = await fetch("http://localhost:7081/launcher/status");
    if (!res.ok) return false;

    const data = await res.json();
    return data.status === "running";
  } catch (err) {
    return false;
  }
}

async function checkRobotAlive() {
  try {
    const res = await fetch("http://localhost:7090/api/telemetry/workloads");
    return res.ok;
  } catch (err) {
    return false;
  }
}

function wakePolling() {
  pollIntervalMs = 200;
  stableCount = 0;
}

async function pollStatusLoop() {
  while (true) {
    const launcherActive = await checkLauncherActive();
    const robotAlive = launcherActive ? await checkRobotAlive() : false;

    let newStatus = "stopped";
    if (robotAlive) newStatus = "running";
    else if (launcherActive) newStatus = "starting";

    if (newStatus !== currentStatus) {
      currentStatus = newStatus;
      updateUI();
      stableCount = 0;
    } else {
      stableCount += 1;
    }

    // After ~1s of stability at fast rate, backoff to 1s polling
    if (pollIntervalMs < 1000 && stableCount >= 5) {
      pollIntervalMs = 1000;
    }

    await sleep(pollIntervalMs);
  }
}

function updateUI() {
  if (!playStopButton || !restartButton) return;

  const playIcon = playStopButton.querySelector("span");

  const isRunning = currentStatus === "running";
  const isStarting = currentStatus === "starting";
  const isStopped = currentStatus === "stopped";

  // Update play/stop icon
  playIcon.textContent = isStopped ? "▶" : "⏹";
  playIcon.className = isStopped ? "icon-play" : "icon-stop";

  // Enable restart only if running
  restartButton.classList.toggle("disabled", !isRunning);
  restartButton.style.pointerEvents = isRunning ? "auto" : "none";
  restartButton.style.opacity = isRunning ? "1.0" : "0.4";

  // Update dot indicator
  if (isRunning) {
    dots.setModeHeartbeat();
  } else if (isStarting) {
    dots.setModeEllipses();
  } else {
    dots.setModeStopped();
  }
}

function initLauncherControls({ playButton, restartButton: restartBtn }) {
  playStopButton = playButton;
  restartButton = restartBtn;

  if (!playStopButton || !restartButton) {
    console.warn("Launcher controls not found");
    return;
  }

  playStopButton.addEventListener("click", async () => {
    wakePolling();
    if (currentStatus === "stopped") {
      await requestPlay();
    } else {
      await requestStop();
    }
  });

  restartButton.addEventListener("click", async () => {
    if (currentStatus === "running") {
      wakePolling();
      await requestRestart();
    }
  });

  updateUI();
  pollStatusLoop(); // fire and forget
}

async function requestPlay() {
  const projectPath = currentProject.getProjectPath();
  const launcherProfile = currentProject.getLauncherProfile();

  if (!projectPath || !launcherProfile) {
    console.warn("[Launcher] Missing project or profile");
    return;
  }

  try {
    launcherEvents.dispatchEvent(new Event("run-requested"));

    const res = await fetch(
      `http://localhost:7081/launcher/run?project_path=${encodeURIComponent(
        projectPath
      )}&profile=${encodeURIComponent(launcherProfile)}`,
      { method: "POST" }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Launcher failed to start: ${err}`);
    }

    const result = await res.json();
    console.log("[Launcher] Backend run status:", result);
  } catch (err) {
    console.error("[Launcher] Failed to start:", err);
  }
}

async function requestStop() {
  try {
    launcherEvents.dispatchEvent(new Event("stop-requested"));

    const res = await fetch("http://localhost:7081/launcher/stop", {
      method: "POST",
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Launcher failed to stop: ${err}`);
    }

    const result = await res.json();
    console.log("[Launcher] Backend stop status:", result);
  } catch (err) {
    console.error("[Launcher] Failed to stop:", err);
  }
}

async function requestRestart() {
  await requestStop();
  await sleep(500); // slight pause for clean stop
  await requestPlay();
}

export default { initLauncherControls };
