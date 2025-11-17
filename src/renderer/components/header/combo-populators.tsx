// header/combo-populators.tsx

import currentProject from "../../core/current-project";

type ProjectComboElement = HTMLSelectElement & {
  knownProjectPaths?: string[];
  _projectHandlerAttached?: boolean;
};

type ProfileComboElement = HTMLSelectElement & {
  _launcherProfileHandlerAttached?: boolean;
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

  if (!combo._projectHandlerAttached) {
    combo.addEventListener("change", () => {
      const selectedPath = combo.value;
      if (selectedPath === "__add__") {
        alert("Add project flow not implemented yet.");
      } else {
        currentProject.setProjectPath(selectedPath);
        location.reload();
      }
    });
    combo._projectHandlerAttached = true;
  }

  combo.knownProjectPaths = projects.map((p) => p.path);
}

const defaultProfiles = [
  { label: "All - Local", value: "local:ALL" },
  { label: "All - Native", value: "native:ALL" },
];

function ensureProfileChangeHandler(combo: ProfileComboElement) {
  if (combo._launcherProfileHandlerAttached) return;
  combo.addEventListener("change", () => {
    const selectedProfile = combo.value;
    if (selectedProfile === "edit") {
      alert("Profile editor not implemented yet.");
    } else {
      currentProject.setLauncherProfile(selectedProfile);
      console.log(`Launcher profile -> '${selectedProfile}'`);
    }
  });
  combo._launcherProfileHandlerAttached = true;
}

async function populateProfileCombo(combo: ProfileComboElement) {
  const current = currentProject.getProjectPath();
  combo.innerHTML = "";
  const selectedProfile = currentProject.getLauncherProfile();

  function addProfileOption(label: string, value: string, isSelected = false) {
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

    defaultProfiles.forEach(({ label, value }) =>
      addProfileOption(label, value, selectedProfile === value)
    );

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
  } catch (err) {
    console.error("Failed to fetch project models:", err);
    defaultProfiles.forEach(({ label, value }) =>
      addProfileOption(label, value, selectedProfile === value)
    );
    addProfileOption("Edit Profiles…", "edit");
  }

  ensureProfileChangeHandler(combo);
}

export default { populateProjectCombo, populateProfileCombo };
