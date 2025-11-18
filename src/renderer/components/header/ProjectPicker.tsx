import React, { useMemo } from "react";
import { useProjectContext } from "../../core/launcher/ProjectContext";
import { useProjectMetas } from "../../hooks/use-project-metas";
import { useProjectChangeConfirmation } from "../../hooks/use-project-change-confirmation";
import styles from "./styles/ProjectPicker.module.css";

const ADD_PROJECT_VALUE = "__add__";

export function ProjectPicker() {
  const { projectPath } = useProjectContext();
  const { projects, loading, error } = useProjectMetas(5000);
  const { requestProjectChange, confirmationDialog } =
    useProjectChangeConfirmation();

  const options = useMemo(() => {
    const knownPaths = new Set(projects.map((p) => p.path));
    const list = [...projects];
    if (projectPath && !knownPaths.has(projectPath)) {
      list.unshift({
        path: projectPath,
        name: projectPath.split("/").pop() ?? projectPath,
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

        {error ? (
          <option value="__error" disabled>
            Failed to load projects
          </option>
        ) : null}
      </select>
      {confirmationDialog}
    </>
  );
}
