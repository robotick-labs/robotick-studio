// src/js/pages/home/home.tsx

import React, { useEffect, useRef, useState } from "react";
import { useProjectContext } from "../../core/ProjectContext";
import { useProjectMetas } from "../../hooks/use-project-metas";
import { useProjectChangeConfirmation } from "../../hooks/use-project-change-confirmation";
import styles from "./styles/HomePage.module.css";

export default function HomePage() {
  const { projectPath, setProjectPath } = useProjectContext();
  const { projects, error } = useProjectMetas(5000);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const { requestProjectChange, confirmationDialog } =
    useProjectChangeConfirmation();
  const autoSelectRef = useRef(Boolean(projectPath));

  useEffect(() => {
    setSelectedPath(projectPath);
  }, [projectPath]);

  useEffect(() => {
    if (!autoSelectRef.current && !projectPath && projects.length > 0) {
      setProjectPath(projects[0].path);
      autoSelectRef.current = true;
    }
  }, [projectPath, projects, setProjectPath]);

  function selectProject(path: string) {
    requestProjectChange(path);
  }

  return (
    <div className={styles.home}>
      <section>
        <h1 className={styles.welcomeSectionTitle}>Welcome to Robotick Hub</h1>
        <p>
          Your creative control center for real-time robotics!
          <br />
          Watch our <b>getting started</b> video below, or select a project and
          dive right in!
        </p>
      </section>

      <section>
        <div className={styles.videoWrapper}>
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

      <section>
        <h2 className={styles.projectsSectionTitle}>Select a Project</h2>
        <p>
          TODO - add simple info on how to run the Launcher and create your
          first project.
        </p>
        <p>pip install robotick-launcher && robotick-launcher listen</p>

        <div className={styles.projectList}>
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
              className={`${styles.projectCard} ${
                selectedPath === p.path ? styles.selected : ""
              }`.trim()}
              data-project={p.path}
              onClick={() => selectProject(p.path)}
            >
              <div>
                <h3>{p.name || "(Unnamed Project)"}</h3>
                <p>{p.description || "No description provided."}</p>
              </div>
              <div
                className={`${styles.selectedIndicator} ${
                  selectedPath === p.path
                    ? styles.selectedIndicatorVisible
                    : ""
                }`.trim()}
              >
                ✓
              </div>
            </div>
          ))}
        </div>
      </section>
      {confirmationDialog}
    </div>
  );
}
