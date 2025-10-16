import currentProject from "../core/current-project.js";

let isSettingProject = false;

export async function init() {
  const list = document.querySelector(".project-list");
  const template = list.querySelector(".project-card.template");
  template.style.display = "none";

  const savedPath = currentProject.getProjectPath();

  function setCurrentProject(projectPath) {
    isSettingProject = true;
    currentProject.setProjectPath(projectPath);

    // Highlight selected card
    document.querySelectorAll(".project-card").forEach((card) => {
      card.classList.remove("selected");
      if (card.dataset.project === projectPath) {
        card.classList.add("selected");
      }
    });

    isSettingProject = false;
  }

  async function fetchProjectPaths() {
    const res = await fetch("http://localhost:7081/query/list-projects");
    if (!res.ok) throw new Error("Failed to list projects");
    return await res.json(); // e.g. ["robots/barr-e/..."]
  }

  async function fetchProjectDetails(path) {
    const res = await fetch(
      `http://localhost:7081/query/get-project-settings?project_path=${encodeURIComponent(
        path
      )}`
    );
    if (!res.ok) throw new Error(`Failed to fetch project: ${path}`);
    return await res.json(); // { name, description }
  }

  try {
    const projectPaths = await fetchProjectPaths();

    const metaList = await Promise.all(
      projectPaths.map(async (path) => {
        try {
          const meta = await fetchProjectDetails(path);
          return {
            path,
            name: meta.name?.trim() || "",
            description: meta.description?.trim() || "",
          };
        } catch (err) {
          console.warn(`Skipping project due to fetch failure: ${path}`);
          return null;
        }
      })
    );

    const validProjects = metaList.filter(Boolean).sort((a, b) => {
      const nameA = a.name || a.path.split("/").pop();
      const nameB = b.name || b.path.split("/").pop();
      return nameA.localeCompare(nameB);
    });

    for (const { path, name, description } of validProjects) {
      const card = template.cloneNode(true);
      card.classList.remove("template");
      card.style.display = "block";
      card.dataset.project = path;

      card.querySelector("h3").textContent = name || "(Unnamed Project)";
      card.querySelector("p").textContent =
        description || "No description provided.";
      card.title = path;

      card.addEventListener("click", () => setCurrentProject(path));

      if (path === savedPath) card.classList.add("selected");

      list.appendChild(card);
    }

    // If no current project is saved, default to the first one
    if (!savedPath && validProjects.length > 0) {
      setCurrentProject(validProjects[0].path);
    }
  } catch (err) {
    console.error("Failed to load or render projects:", err);
    list.insertAdjacentHTML(
      "beforeend",
      `<p style="color: red;">Error loading projects. Is the backend running?</p>`
    );
  }
}
