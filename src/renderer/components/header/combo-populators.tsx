// header/combo-populators.tsx

import currentProject from "../../core/current-project.js";

type ProjectComboElement = HTMLSelectElement & {
  knownProjectPaths?: string[];
};

type ProjectMeta = {
  path: string;
  name: string;
};

async function populateProjectCombo(combo: ProjectComboElement) {
  combo.innerHTML = "";

  const res = await fetch("http://localhost:7081/query/list-projects");
  if (!res.ok) {
    combo.innerHTML = `<option>(Failed to load projects)</option>`;
    return;
  }

  const paths = await res.json();
  const current = currentProject.getProjectPath();

  const metas = await Promise.all(
    paths.map(async (path): Promise<ProjectMeta | null> => {
      try {
        const r = await fetch(
          `http://localhost:7081/query/get-project-settings?project_path=${encodeURIComponent(
            path
          )}`
        );
        const data = await r.json();
        return {
          path,
          name: data.name || path.split("/").pop(),
        };
      } catch {
        return null;
      }
    })
  );

  const projects = metas
    .filter((p): p is ProjectMeta => Boolean(p))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.path;
    option.textContent = project.name;
    if (project.path === current) option.selected = true;
    combo.appendChild(option);
  }

  const addOption = document.createElement("option");
  addOption.value = "__add__";
  addOption.textContent = "Add Project...";
  combo.appendChild(addOption);

  combo.addEventListener("change", () => {
    const selectedPath = combo.value;
    if (selectedPath === "__add__") {
      alert("Add project flow not implemented yet.");
    } else {
      currentProject.setProjectPath(selectedPath);
      location.reload();
    }
  });

  combo.knownProjectPaths = projects.map((p) => p.path);
}

async function populateProfileCombo(combo: HTMLSelectElement) {
  const current = currentProject.getProjectPath();

  function addProfileOption(
    label: string,
    value: string,
    isSelected = false
  ) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (isSelected) option.selected = true;
    combo.appendChild(option);
  }

  try {
    const r = await fetch(
      `http://localhost:7081/query/list-project-models?project_path=${encodeURIComponent(
        current
      )}`
    );
    const modelPaths = (await r.json()).sort() as string[];

    if (modelPaths.length > 1) {
      addProfileOption("All - Local", "local:ALL", false);
      addProfileOption("All - Native", "native:ALL", false);
    }

    for (const modelPath of modelPaths) {
      const basename = modelPath.split("/").pop() ?? "";
      const base = basename.replace(/\..*$/, "");

      const localValue = `local:${modelPath}`;
      const nativeValue = `native:${modelPath}`;

      addProfileOption(`${base} - Local`, localValue, localValue === current);
      addProfileOption(
        `${base} - Native`,
        nativeValue,
        nativeValue === current
      );
    }

    addProfileOption("Edit Profiles…", "edit");

    combo.addEventListener("change", () => {
      const selectedProfile = combo.value;
      if (selectedProfile === "__add__") {
        alert("Add profile flow not implemented yet.");
      } else {
        currentProject.setLauncherProfile(selectedProfile);
        console.log(`Launcher profile -> '${selectedProfile}'`);
      }
    });
  } catch (err) {
    console.error("Failed to fetch project models:", err);
  }
}

export default { populateProjectCombo, populateProfileCombo };
