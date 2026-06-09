// src/js/components/editors/home/home.tsx

import React, { useEffect, useRef, useState } from "react";
import { Project } from "../../../data-sources/launcher";
import { getRendererAppName } from "../../../utils/appName";

const useProjectContext = Project.Context.use;
const useProjectSettingsList = Project.Hooks.useSettingsList;
const useProjectChangeConfirmation = Project.Hooks.useChangeConfirmation;
const useProjectLockStatuses = Project.Hooks.useLockStatuses;
import styles from "./styles/HomePage.module.css";

let hasAppliedRequestedProjectForSession = false;

function getRequestedProjectName(): string | undefined {
  const selectedProject = window.robotick?.environment?.selectedProject;
  return typeof selectedProject === "string" && selectedProject.trim().length > 0
    ? selectedProject.trim()
    : undefined;
}

function projectMatchesRequestedName(
  project: { path: string; name: string },
  requestedName: string,
): boolean {
  const normalizedRequested = requestedName.trim().replace(/\\/g, "/");
  const normalizedPath = project.path.replace(/\\/g, "/");
  return (
    project.name === requestedName ||
    normalizedPath === normalizedRequested ||
    normalizedPath.includes(`/${normalizedRequested}/`) ||
    normalizedPath.endsWith(`/${normalizedRequested}`) ||
    normalizedPath.endsWith(`/${normalizedRequested}.project.yaml`)
  );
}

export default function HomePage() {
  const { projectPath, selectProjectPath } = useProjectContext();
  const { projects, error } = useProjectSettingsList(5000);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const { requestProjectChange, confirmationDialog } =
    useProjectChangeConfirmation();
  const autoSelectRef = useRef(Boolean(projectPath));
  const requestedProjectAppliedRef = useRef(false);
  const appName = getRendererAppName();
  const { statusesByPath } = useProjectLockStatuses(
    projects.map((project) => project.path)
  );

  useEffect(() => {
    setSelectedPath(projectPath);
  }, [projectPath]);

  useEffect(() => {
    const requestedProjectName = getRequestedProjectName();
    if (
      requestedProjectAppliedRef.current ||
      hasAppliedRequestedProjectForSession ||
      !requestedProjectName ||
      projects.length === 0
    ) {
      return;
    }
    const requestedProject = projects.find((project) =>
      projectMatchesRequestedName(project, requestedProjectName)
    );
    if (!requestedProject) {
      requestedProjectAppliedRef.current = true;
      hasAppliedRequestedProjectForSession = true;
      return;
    }
    if (projectPath === requestedProject.path) {
      requestedProjectAppliedRef.current = true;
      hasAppliedRequestedProjectForSession = true;
      return;
    }
    requestedProjectAppliedRef.current = true;
    hasAppliedRequestedProjectForSession = true;
    autoSelectRef.current = true;
    void selectProjectPath(requestedProject.path).then((result) => {
      if (result.accepted) {
        autoSelectRef.current = true;
      }
    });
  }, [projectPath, projects, selectProjectPath]);

  useEffect(() => {
    if (!autoSelectRef.current && !projectPath && projects.length > 0) {
      autoSelectRef.current = true;
      void selectProjectPath(projects[0].path).then((result) => {
        if (result.accepted) {
          autoSelectRef.current = true;
        }
      });
    }
  }, [projectPath, projects, selectProjectPath]);

  function selectProject(path: string) {
    requestProjectChange(path);
  }

  return (
    <div className={styles.home}>
      <section>
        <h1 className={styles.welcomeSectionTitle}>Welcome to {appName}</h1>
        <p>
          Your creative control center for real-time robotics!
          <br />
          Watch our <b>getting started</b> video below, or select a project and
          dive right in!
        </p>
      </section>

      <section>
        <div className={styles.videoWrapper}>
          <p>
            Studio launch and navigation now live in the workspace CLI. Use the
            project selector below to switch context, or open a project directly
            with <code>robotick studio open &lt;project&gt;</code>.
          </p>
        </div>
      </section>

      <section>
        <h2 className={styles.projectsSectionTitle}>Select a Project</h2>
        <p>
          Launch Studio from the workspace CLI with <code>robotick studio open</code>,
          or create a clean empty session with <code>robotick studio create</code>.
        </p>

        <div className={styles.projectList}>
          {projects.length === 0 && (
            <p style={{ color: "red" }}>
              {error ? error : "No projects found. Is the backend running?"}
            </p>
          )}

          {projects.map((p) => {
            const lockStatus = statusesByPath[p.path];
            const isLockedElsewhere = lockStatus?.state === "locked";
            const statusLabel =
              lockStatus?.state === "current"
                ? "Open in this Studio"
                : isLockedElsewhere
                  ? lockStatus.instanceName
                    ? `Locked by ${lockStatus.instanceName}`
                    : "Locked in another Studio"
                  : null;
            return (
            <div
              key={p.path}
              className={`${styles.projectCard} ${
                selectedPath === p.path ? styles.selected : ""
              } ${isLockedElsewhere ? styles.locked : ""}`.trim()}
              data-project={p.path}
              onClick={() => selectProject(p.path)}
            >
              <div>
                <h3>{p.name || "(Unnamed Project)"}</h3>
                <p>{p.description || "No description provided."}</p>
                {statusLabel ? (
                  <p className={styles.lockStatus}>{statusLabel}</p>
                ) : null}
              </div>
              <div
                className={`${styles.selectedIndicator} ${
                  selectedPath === p.path ? styles.selectedIndicatorVisible : ""
                }`.trim()}
              >
                ✓
              </div>
            </div>
            );
          })}
        </div>
      </section>
      {confirmationDialog}
    </div>
  );
}

export function resetRequestedProjectBootstrapForTests() {
  hasAppliedRequestedProjectForSession = false;
}
