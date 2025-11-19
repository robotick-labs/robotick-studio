import React from "react";
import type { WorkspaceConfig } from "../../services/AppConfigService";
import { PanelLayout } from "./PanelLayout";
import styles from "./WorkspaceView.module.css";

type WorkspaceViewProps = {
  workspace: WorkspaceConfig;
};

export function WorkspaceView({ workspace }: WorkspaceViewProps) {
  return (
    <div className={styles.workspaceShell}>
      <PanelLayout
        workspaceId={workspace.id}
        defaultEditorId={workspace.editor}
      />
    </div>
  );
}
