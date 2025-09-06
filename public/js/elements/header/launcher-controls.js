// header/launcher-controls.js

import currentProject from "/js/core/current-project.js";
import dots from "./launcher-dots.js";

let isPlaying = false;
let playStopButton = null;
let restartButton = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateUI() {
  if (!playStopButton || !restartButton) return;

  const playIcon = playStopButton.querySelector("span");
  playIcon.textContent = isPlaying ? "⏹" : "▶";
  playIcon.className = isPlaying ? "icon-stop" : "icon-play";

  if (isPlaying) {
    restartButton.classList.remove("disabled");
    restartButton.style.pointerEvents = "auto";
    restartButton.style.opacity = "1.0";
  } else {
    restartButton.classList.add("disabled");
    restartButton.style.pointerEvents = "none";
    restartButton.style.opacity = "0.4";
  }
}

function initLauncherControls({ playButton, restartButton: restartBtn }) {
  playStopButton = playButton;
  restartButton = restartBtn;

  if (!playStopButton) {
    console.warn("Launcher play/stop button not found");
    return;
  }

  if (!restartButton) {
    console.warn("Launcher restart button not found");
    return;
  }

  playStopButton.addEventListener("click", async () => {
    if (isPlaying) await requestStop();
    else await requestPlay();
  });

  restartButton.addEventListener("click", async () => {
    if (!isPlaying) return;
    await requestRestart();
  });

  updateUI();
}

async function requestPlay() {
  if (isPlaying) return;

  const projectPath = currentProject.getProjectPath();
  const launcherProfile = currentProject.getLauncherProfile();
  if (!projectPath || !launcherProfile) {
    return;
  }

  isPlaying = true;
  updateUI();
  console.log(
    `[Launcher] Starting '${launcherProfile}' from '${projectPath}'...`
  );

  dots.start();

  // call our API endpoint:
  {
    try {
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
      isPlaying = false;
      updateUI();
      return;
    }
  }

  console.log("[Launcher] Started");
  dots.stop();
  console.log("[Launcher] Launch complete");
}

async function requestStop(stopDotsWhenDone = true) {
  if (!isPlaying) return;

  isPlaying = false;
  updateUI();
  console.log("[Launcher] Stopping...");

  dots.start();

  // call our API endpoint:
  {
    try {
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

  console.log("[Launcher] Stopped");
  if (stopDotsWhenDone) dots.stop();
}

async function requestRestart() {
  await requestStop(false);
  await requestPlay();
}

export default { initLauncherControls };
