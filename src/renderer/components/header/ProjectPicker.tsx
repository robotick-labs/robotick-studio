import React, { useMemo } from "react";
import { Project } from "../../data-sources/launcher";

const useProjectContext = Project.Context.use;
const useProjectSettingsList = Project.Hooks.useSettingsList;
const useProjectChangeConfirmation = Project.Hooks.useChangeConfirmation;
import styles from "./styles/ProjectPicker.module.css";

const ADD_PROJECT_VALUE = "__add__";
const pathSeparatorRegex = /[/\\]/;

function getBasename(filePath: string) {
  const parts = filePath.split(pathSeparatorRegex);
  return parts[parts.length - 1] || filePath;
}

export function ProjectPicker() {
  const { projectPath } = useProjectContext();
  const { projects, loading, error } = useProjectSettingsList(5000);
  const { requestProjectChange, confirmationDialog } =
    useProjectChangeConfirmation();

  const options = useMemo(() => {
    const knownPaths = new Set(projects.map((p) => p.path));
    const list = [...projects];
    if (projectPath && !knownPaths.has(projectPath)) {
      list.unshift({
        path: projectPath,
        name: getBasename(projectPath),
      });
    }
    return list;
  }, [projectPath, projects]);

  function handleChange(value: string) {
    if (value === ADD_PROJECT_VALUE) {
      alert("Add project flow not implemented yet.");
      return;
    }
    requestProjectChange(value);
  }

  const selectValue = projectPath || "";

  return (
    <>
      <select
        className={styles.select}
        aria-label="Select project"
        value={selectValue}
        onChange={(event) => handleChange(event.target.value)}
        disabled={loading}
      >
        <option value="" disabled={Boolean(selectValue)}>
          {loading ? "Loading projects..." : "Select a Project"}
        </option>

        {options.map((project) => (
          <option key={project.path} value={project.path}>
            {project.name}
          </option>
        ))}

        <option value={ADD_PROJECT_VALUE}>Add Project...</option>
      </select>
      {error ? (
        <div role="alert" aria-live="polite" className={styles.errorMessage}>
          Failed to load projects
        </div>
      ) : null}
      {confirmationDialog}
    </>
  );
}
