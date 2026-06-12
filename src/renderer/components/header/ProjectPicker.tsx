import React, { useEffect, useMemo, useState } from "react";
import { Project, useLauncherService } from "../../data-sources/launcher";
import { publishRendererDiagnosticsPatch } from "../../services/studio-diagnostics";

const useProjectContext = Project.Context.use;
const useProjectSettingsList = Project.Hooks.useSettingsList;
const useProjectChangeConfirmation = Project.Hooks.useChangeConfirmation;
const useProjectLockStatuses = Project.Hooks.useLockStatuses;
import styles from "./styles/ProjectPicker.module.css";

const ADD_PROJECT_VALUE = "__add__";
const pathSeparatorRegex = /[/\\]/;

function normalizePath(filePath: string) {
  return filePath.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function stripProjectYamlSuffix(filePath: string) {
  return normalizePath(filePath).replace(/\.project\.ya?ml$/i, "");
}

function getProjectIdentityCandidates(filePath: string): Set<string> {
  const normalized = normalizePath(filePath);
  const withoutProjectYaml = stripProjectYamlSuffix(normalized);
  const parts = normalized.split(pathSeparatorRegex).filter(Boolean);
  const basename = parts[parts.length - 1] ?? normalized;
  const candidates = new Set<string>();

  if (normalized) {
    candidates.add(normalized);
  }
  if (withoutProjectYaml) {
    candidates.add(withoutProjectYaml);
  }
  if (/\.project\.ya?ml$/i.test(basename)) {
    const parentPath = parts.slice(0, -1).join("/");
    if (parentPath) {
      candidates.add(parentPath);
    }
  }

  return candidates;
}

function deriveProjectDisplayName(projectPath: string) {
  const normalized = normalizePath(projectPath);
  const parts = normalized.split(pathSeparatorRegex).filter(Boolean);
  const basename = parts[parts.length - 1] ?? normalized;
  if (/\.project\.ya?ml$/i.test(basename)) {
    const projectName = basename.replace(/\.project\.ya?ml$/i, "");
    return projectName || parts[parts.length - 2] || basename;
  }
  return basename || projectPath;
}

function getProjectFileName(projectPath: string) {
  const normalized = normalizePath(projectPath);
  const parts = normalized.split(pathSeparatorRegex).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

function pathsReferToSameProject(left: string, right: string) {
  const leftCandidates = getProjectIdentityCandidates(left);
  const rightCandidates = getProjectIdentityCandidates(right);
  for (const candidate of leftCandidates) {
    if (rightCandidates.has(candidate)) {
      return true;
    }
  }
  return false;
}

export function ProjectPicker() {
  const { projectPath } = useProjectContext();
  const launcherService = useLauncherService();
  const { projects, loading, error } = useProjectSettingsList(5000);
  const { requestProjectChange, confirmationDialog } =
    useProjectChangeConfirmation();
  const [selectedProjectSettingsName, setSelectedProjectSettingsName] = useState<
    string | null
  >(null);
  const selectedProject =
    projects.find((project) => pathsReferToSameProject(project.path, projectPath)) ??
    null;
  useEffect(() => {
    let cancelled = false;
    setSelectedProjectSettingsName(null);
    if (!projectPath || selectedProject) {
      return () => {
        cancelled = true;
      };
    }

    void launcherService
      .fetchProjectSettingsData<{ name?: unknown }>(projectPath)
      .then((settings) => {
        if (cancelled) {
          return;
        }
        const name = settings.name;
        setSelectedProjectSettingsName(
          typeof name === "string" && name.trim() ? name.trim() : null
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedProjectSettingsName(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [launcherService, projectPath, selectedProject]);

  const options = useMemo(() => {
    const list = [...projects];
    if (projectPath && !selectedProject) {
      list.unshift({
        path: projectPath,
        name: selectedProjectSettingsName ?? deriveProjectDisplayName(projectPath),
      });
    }
    return list;
  }, [projectPath, projects, selectedProject, selectedProjectSettingsName]);
  const { statusesByPath } = useProjectLockStatuses(
    options.map((project) => project.path)
  );

  function handleChange(value: string) {
    if (value === ADD_PROJECT_VALUE) {
      alert("Add project flow not implemented yet.");
      return;
    }
    if (statusesByPath[value]?.state === "locked") {
      return;
    }
    requestProjectChange(value);
  }

  const selectValue = selectedProject?.path || options[0]?.path || "";
  const selectedOption = options.find((project) => project.path === selectValue) ?? null;

  useEffect(() => {
    publishRendererDiagnosticsPatch({
      project_picker: {
        selected_project_path: projectPath,
        selected_value: selectValue,
        rendered_label: selectedOption
          ? formatProjectOptionLabel(
              selectedOption.name,
              statusesByPath[selectedOption.path]
            )
          : null,
        project_display_name: selectedOption?.name ?? null,
        project_file_name: projectPath ? getProjectFileName(projectPath) : null,
      },
    });
  }, [projectPath, selectValue, selectedOption, statusesByPath]);

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
          <option
            key={project.path}
            value={project.path}
            className={
              statusesByPath[project.path]?.state === "locked"
                ? styles.lockedOption
                : undefined
            }
          >
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
  return `🔒 ${name}`;
}
