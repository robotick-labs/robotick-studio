import React, { useMemo } from "react";
import { Project } from "../../data-sources/launcher";

const useProjectContext = Project.Context.use;
const useProjectSettingsList = Project.Hooks.useSettingsList;
const useProjectChangeConfirmation = Project.Hooks.useChangeConfirmation;
const useProjectLockStatuses = Project.Hooks.useLockStatuses;
import styles from "./styles/ProjectPicker.module.css";

const ADD_PROJECT_VALUE = "__add__";
const pathSeparatorRegex = /[/\\]/;

function getBasename(filePath: string) {
  const parts = filePath.split(pathSeparatorRegex);
  return parts[parts.length - 1] || filePath;
}

function normalizePath(filePath: string) {
  return filePath.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function stripProjectYamlSuffix(filePath: string) {
  return normalizePath(filePath).replace(/\.project\.ya?ml$/i, "");
}

function pathsReferToSameProject(left: string, right: string) {
  const normalizedLeft = stripProjectYamlSuffix(left);
  const normalizedRight = stripProjectYamlSuffix(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const leftBase = getBasename(normalizedLeft);
  const rightBase = getBasename(normalizedRight);
  return leftBase.length > 0 && leftBase === rightBase;
}

export function ProjectPicker() {
  const { projectPath } = useProjectContext();
  const { projects, loading, error } = useProjectSettingsList(5000);
  const { requestProjectChange, confirmationDialog } =
    useProjectChangeConfirmation();
  const selectedProject =
    projects.find((project) => pathsReferToSameProject(project.path, projectPath)) ??
    null;

  const options = useMemo(() => {
    const list = [...projects];
    if (projectPath && !selectedProject) {
      list.unshift({
        path: projectPath,
        name: getBasename(projectPath),
      });
    }
    return list;
  }, [projectPath, projects, selectedProject]);
  const { statusesByPath } = useProjectLockStatuses(
    options.map((project) => project.path)
  );

  function handleChange(value: string) {
    if (value === ADD_PROJECT_VALUE) {
      alert("Add project flow not implemented yet.");
      return;
    }
    requestProjectChange(value);
  }

  const selectValue = selectedProject?.path || options[0]?.path || "";

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
            {formatProjectOptionLabel(project.name, statusesByPath[project.path])}
          </option>
        ))}

        <option value={ADD_PROJECT_VALUE}>Add Project...</option>
      </select>
      {error ? null : null}
      {confirmationDialog}
    </>
  );
}

function formatProjectOptionLabel(
  name: string,
  lockStatus:
    | {
        state: "available" | "current" | "locked";
        instanceName?: string;
      }
    | undefined
) {
  if (!lockStatus || lockStatus.state === "available") {
    return name;
  }
  if (lockStatus.state === "current") {
    return name;
  }
  if (lockStatus.instanceName) {
    return `${name} [Locked: ${lockStatus.instanceName}]`;
  }
  return `${name} [Locked]`;
}
