// src/js/pages/home/home.tsx

import React, { useEffect, useRef, useState } from "react";
import { useProjectContext } from "../../core/project-context";
import { fetchProjectMetas, ProjectMeta } from "../../core/projects-api";

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const { projectPath, setProjectPath } = useProjectContext();
  const initialProjectPathRef = useRef(projectPath);

  useEffect(() => {
    setSelectedPath(projectPath);
  }, [projectPath]);

  useEffect(() => {
    async function loadProjects() {
      try {
        setError(null);
        const metas = await fetchProjectMetas();
        setProjects(metas);

        if (!initialProjectPathRef.current && metas.length > 0) {
          const defaultPath = metas[0].path;
          setProjectPath(defaultPath);
        }
      } catch (err) {
        console.error("Failed to load projects:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load projects"
        );
      }
    }

    loadProjects();
  }, [setProjectPath]);

  function selectProject(path: string) {
    setProjectPath(path);
  }

  return (
    <div className="hub-home">
      {/* Welcome Section */}
      <section className="welcome-section">
        <h1>Welcome to Robotick Hub</h1>
        <p>
          Your creative control center for real-time robotics!
          <br />
          Watch our <b>getting started</b> video below, or select a project and
          dive right in!
        </p>
      </section>

      {/* Overview Video */}
      <section className="video-section">
        <div className="video-wrapper">
          <iframe
            width="800"
            height="450"
            src="https://www.youtube.com/embed/YOUR_VIDEO_ID_HERE"
            title="Robotick Overview"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
        </div>
      </section>

      {/* Project Cards */}
      <section className="projects-section">
        <h2>Select a Project</h2>
        <p>
          TODO - add simple info on how to run the Launcher and create your
          first project.
        </p>
        <p>pip install robotick-launcher && robotick-launcher listen</p>

        <div className="project-list">
          {projects.length === 0 && (
            <p style={{ color: "red" }}>
              {error
                ? error
                : "No projects found. Is the backend running?"}
            </p>
          )}

          {projects.map((p) => (
            <div
              key={p.path}
              className={`project-card ${
                selectedPath === p.path ? "selected" : ""
              }`}
              data-project={p.path}
              onClick={() => selectProject(p.path)}
            >
              <div className="project-content">
                <h3>{p.name || "(Unnamed Project)"}</h3>
                <p>{p.description || "No description provided."}</p>
              </div>
              <div className="selected-indicator">✓</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
