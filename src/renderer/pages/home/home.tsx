// src/js/pages/home/home.tsx

import React, { useEffect, useState } from "react";
import currentProject from "../../core/current-project";

interface ProjectMeta {
  path: string;
  name: string;
  description: string;
}

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");

  useEffect(() => {
    async function loadProjects() {
      try {
        // Get last selected project
        const saved = currentProject.getProjectPath();
        setSelectedPath(saved);

        const pathsRes = await fetch(
          "http://localhost:7081/query/list-projects"
        );
        if (!pathsRes.ok) throw new Error("Failed to list projects");
        const paths = await pathsRes.json();

        // Fetch metadata for each project
        const metaList = await Promise.all(
          paths.map(async (path: string) => {
            try {
              const settingsRes = await fetch(
                `http://localhost:7081/query/get-project-settings?project_path=${encodeURIComponent(
                  path
                )}`
              );

              if (!settingsRes.ok)
                throw new Error(`Failed to fetch project: ${path}`);

              const meta = await settingsRes.json();

              return {
                path,
                name: meta.name?.trim() || "",
                description: meta.description?.trim() || "",
              };
            } catch (err) {
              console.warn("Skipping project due to fetch failure:", path);
              return null;
            }
          })
        );

        const valid = metaList.filter(Boolean).sort((a, b) => {
          const nameA = a!.name || a!.path.split("/").pop();
          const nameB = b!.name || b!.path.split("/").pop();
          return nameA.localeCompare(nameB);
        }) as ProjectMeta[];

        setProjects(valid);

        // Default to first project if nothing selected
        if (!saved && valid.length > 0) {
          const defaultPath = valid[0].path;
          setSelectedPath(defaultPath);
          currentProject.setProjectPath(defaultPath);
        }
      } catch (err) {
        console.error("Failed to load projects:", err);
      }
    }

    loadProjects();
  }, []);

  function selectProject(path: string) {
    setSelectedPath(path);
    currentProject.setProjectPath(path);
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
              No projects found. Is the backend running?
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
