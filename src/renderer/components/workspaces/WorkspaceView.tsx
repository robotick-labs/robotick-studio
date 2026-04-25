import React, { useEffect } from "react";
import type { WorkspaceConfig } from "../../services/AppConfigService";
import { PanelLayout } from "./PanelLayout";
import { reportViewDiagnostics } from "../../utils/viewDiagnostics";
import styles from "./WorkspaceView.module.css";
import { useProjectContext } from "../../data-sources/launcher/internal/ProjectContext";
import { rememberWorkspacePath } from "../../utils/workspaceMemory";

type WorkspaceViewProps = {
  workspace: WorkspaceConfig;
};

export function WorkspaceView({ workspace }: WorkspaceViewProps) {
  const { projectPath } = useProjectContext();
  useEffect(() => {
    reportViewDiagnostics("workspace", { workspaceId: workspace.id });
  }, [workspace.id]);
  useEffect(() => {
    rememberWorkspacePath(projectPath, workspace.path);
  }, [projectPath, workspace.path]);

  return (
    <div className={styles.workspaceShell}>
      <PanelLayout
        workspaceId={workspace.id}
        workspaceLabel={workspace.label}
        defaultEditorId={workspace.editor}
      />
    </div>
  );
}
