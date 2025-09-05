// header.js

import currentProject from "/js/core/current-project.js";

export function initControls(host) {
  console.log(`[Robotick Hub] Header Controls init from: '${host}'`);

  let isPlaying = false;

  const playButton = document.querySelector(".icon-play")?.parentElement;
  const restartButton = document.querySelector(".icon-restart")?.parentElement;
  const stopButton = document.querySelector(".icon-stop")?.parentElement;

  if (!playButton) {
    console.warn("Launcher play button not found");
    return;
  }

  if (!restartButton) {
    console.warn("Launcher restart button not found");
    return;
  }

  function updateUI() {
    const playIcon = playButton.querySelector("span");
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

  playButton.addEventListener("click", () => {
    isPlaying = !isPlaying;
    updateUI();
    console.log(`[Launcher] ${isPlaying ? "Started" : "Stopped"}`);
  });

  restartButton.addEventListener("click", () => {
    if (!isPlaying) return;
    console.log("[Launcher] Restart triggered");
  });

  updateUI();

  const combo = document.getElementById("current-project-combo");
  if (combo) {
    populateProjectCombo(combo);

    currentProject.onProjectChanged((newPath) => {
      if (!combo.knownProjectPaths?.includes(newPath)) {
        populateProjectCombo(combo);
      } else {
        combo.value = newPath;
      }
    });
  }
}

export async function populateProjectCombo(combo) {
  // Clear existing options
  combo.innerHTML = "";

  // Fetch project paths from REST
  const res = await fetch("http://localhost:7081/query/list-projects");
  if (!res.ok) {
    combo.innerHTML = `<option>(Failed to load projects)</option>`;
    return;
  }

  const paths = await res.json();
  const current = currentProject.getProjectPath();

  // Fetch all metadata
  const metas = await Promise.all(
    paths.map(async (path) => {
      try {
        const r = await fetch(
          `http://localhost:7081/query/get-project-settings?project_path=${encodeURIComponent(
            path
          )}`
        );
        const data = await r.json();
        return {
          path,
          name: data.name || path.split("/").pop(), // fallback to filename
        };
      } catch {
        return null;
      }
    })
  );

  // Filter and sort
  const projects = metas
    .filter((p) => p)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Populate options
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.path;
    option.textContent = project.name;
    if (project.path === current) option.selected = true;
    combo.appendChild(option);
  }

  // Add "Add Project..." option
  const addOption = document.createElement("option");
  addOption.value = "__add__";
  addOption.textContent = "Add Project...";
  combo.appendChild(addOption);

  // Handle selection changes
  combo.addEventListener("change", () => {
    const selectedPath = combo.value;
    if (selectedPath === "__add__") {
      alert("Add project flow not implemented yet.");
    } else {
      currentProject.setProjectPath(selectedPath);
      location.reload(); // or trigger UI update as needed
    }
  });

  combo.knownProjectPaths = projects.map((p) => p.path);
}
