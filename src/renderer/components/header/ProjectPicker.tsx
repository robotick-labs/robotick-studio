import React, { useEffect, useMemo, useState } from "react";
import { useProjectContext } from "../../core/project-context";
import {
  fetchProjectMetas,
  ProjectMeta,
} from "../../core/projects-api";

const ADD_PROJECT_VALUE = "__add__";

export function ProjectPicker() {
  const { projectPath, setProjectPath } = useProjectContext();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const metas = await fetchProjectMetas();
        if (!cancelled) setProjects(metas);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load projects"
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

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
    setProjectPath(value);
  }

  const selectValue = projectPath || "";

  return (
    <select
      className="project-combo"
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
  );
}
