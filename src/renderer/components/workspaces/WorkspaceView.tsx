import React, { useEffect } from "react";
import type { WorkspaceConfig } from "../../services/AppConfigService";
import { PanelLayout } from "./PanelLayout";
import { reportViewDiagnostics } from "../../utils/viewDiagnostics";
import styles from "./WorkspaceView.module.css";
import { useProjectContext } from "../../data-sources/launcher/internal/ProjectContext";
import { rememberWorkspacePath } from "../../utils/workspaceMemory";
import {
  getWindowScope,
  isPrimaryWindowSession,
} from "../../utils/windowSession";

type WorkspaceViewProps = {
  workspace: WorkspaceConfig;
};

export function WorkspaceView({ workspace }: WorkspaceViewProps) {
  const { projectPath } = useProjectContext();
  const windowScope = getWindowScope();
  const isPrimaryWindow = isPrimaryWindowSession();
  const layoutWindowScope = windowScope === "primary" ? "main" : windowScope;
  useEffect(() => {
    reportViewDiagnostics("workspace", { workspaceId: workspace.id });
  }, [workspace.id]);
  useEffect(() => {
    rememberWorkspacePath(projectPath, workspace.path, {
      windowScope,
      isPrimaryWindow,
    });
  }, [projectPath, workspace.path, windowScope, isPrimaryWindow]);

  return (
    <div className={styles.workspaceShell}>
      <PanelLayout
        workspaceId={workspace.id}
        workspaceLabel={workspace.label}
        defaultEditorId={workspace.editor}
        windowScope={layoutWindowScope}
      />
    </div>
  );
}
