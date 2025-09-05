import currentProject from "/js/core/project.js";

export async function init() {
  const list = document.querySelector(".project-list");
  const template = list.querySelector(".project-card.template");
  template.style.display = "none";

  const saved = currentProject.getProjectPath();

  function setCurrentProject(projectPath) {
    currentProject.setProjectPath(projectPath);
    document.querySelectorAll(".project-card").forEach((card) => {
      card.classList.remove("selected");
      if (card.dataset.project === projectPath) {
        card.classList.add("selected");
      }
    });
  }

  async function fetchProjectPaths() {
    const res = await fetch("http://localhost:7081/query/list-projects");
    if (!res.ok) throw new Error("Failed to list projects");
    return await res.json(); // array of project paths
  }

  async function fetchProjectDetails(path) {
    const res = await fetch(
      `http://localhost:7081/query/get-project?project_path=${encodeURIComponent(
        path
      )}`
    );
    if (!res.ok) throw new Error(`Failed to fetch project: ${path}`);
    return await res.json(); // expects { name, description, etc. }
  }

  try {
    const projectPaths = await fetchProjectPaths();

    // Fetch metadata for all projects
    const projectMetaList = await Promise.all(
      projectPaths.map(async (path) => {
        try {
          const meta = await fetchProjectDetails(path);
          return {
            path,
            name: meta.name?.trim() || "", // force string
            description: meta.description?.trim() || "",
          };
        } catch (err) {
          console.warn(`Skipping project with failed metadata: ${path}`);
          return null; // skip broken ones
        }
      })
    );

    // Filter out failed metadata
    const validProjects = projectMetaList.filter((item) => item !== null);

    // Sort alphabetically by name or fallback to filename
    validProjects.sort((a, b) => {
      const nameA = a.name || a.path.split("/").pop();
      const nameB = b.name || b.path.split("/").pop();
      return nameA.localeCompare(nameB);
    });

    // Render cards
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

      if (path === saved) card.classList.add("selected");

      list.appendChild(card);
    }

    // Select first if none is saved
    if (!saved && validProjects.length > 0) {
      setCurrentProject(validProjects[0].path);
    }
  } catch (err) {
    console.error("Failed to load projects:", err);
    list.insertAdjacentHTML(
      "beforeend",
      `<p style="color: red;">Error loading projects. Is the backend running?</p>`
    );
  }
}
