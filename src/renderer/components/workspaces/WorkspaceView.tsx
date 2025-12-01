import React, { useEffect } from "react";
import type { WorkspaceConfig } from "../../services/AppConfigService";
import { PanelLayout } from "./PanelLayout";
import { reportViewDiagnostics } from "../../utils/viewDiagnostics";
import styles from "./WorkspaceView.module.css";

type WorkspaceViewProps = {
  workspace: WorkspaceConfig;
};

export function WorkspaceView({ workspace }: WorkspaceViewProps) {
  useEffect(() => {
    reportViewDiagnostics("workspace", { workspaceId: workspace.id });
  }, [workspace.id]);

  return (
    <div className={styles.workspaceShell}>
      <PanelLayout
        workspaceId={workspace.id}
        defaultEditorId={workspace.editor}
      />
    </div>
  );
}
