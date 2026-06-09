import React, { useEffect } from "react";
import type { WorkbenchConfig } from "../../services/AppConfigService";
import { PanelLayout } from "./PanelLayout";
import { reportViewDiagnostics } from "../../utils/viewDiagnostics";
import styles from "./WorkbenchView.module.css";
import { useProjectContext } from "../../data-sources/launcher/internal/ProjectContext";
import { rememberWorkbenchPath } from "../../utils/workbenchMemory";
import {
  getWindowScope,
  isPrimaryWindowSession,
} from "../../utils/windowSession";

type WorkbenchViewProps = {
  workbench: WorkbenchConfig;
};

export function WorkbenchView({ workbench }: WorkbenchViewProps) {
  const { projectPath } = useProjectContext();
  const windowScope = getWindowScope();
  const isPrimaryWindow = isPrimaryWindowSession();
  const layoutWindowScope = windowScope === "primary" ? "main" : windowScope;
  useEffect(() => {
    reportViewDiagnostics("workbench", { workbenchId: workbench.id });
  }, [workbench.id]);
  useEffect(() => {
    rememberWorkbenchPath(projectPath, workbench.path, {
      windowScope,
      isPrimaryWindow,
    });
  }, [projectPath, workbench.path, windowScope, isPrimaryWindow]);

  return (
    <div className={styles.workbenchShell}>
      <PanelLayout
        workbenchId={workbench.id}
        workbenchLabel={workbench.label}
        defaultEditorId={workbench.editor}
        windowScope={layoutWindowScope}
      />
    </div>
  );
}
