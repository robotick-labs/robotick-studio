import React, { useState } from "react";
import { useProjectContext } from "./ProjectContext";
import { GenericDialog } from "../../../components/dialog/GenericDialog";
import type { ProjectSelectionIssue } from "./launcher-interface";

export function useProjectChangeConfirmation() {
  const { projectPath, selectProjectPath } = useProjectContext();
  const [selectionIssue, setSelectionIssue] =
    useState<ProjectSelectionIssue | null>(null);

  const applyProjectChange = async (nextPath: string) => {
    const result = await selectProjectPath(nextPath);
    if (!result.accepted) {
      setSelectionIssue(result.issue);
      return false;
    }
    setSelectionIssue(null);
    return true;
  };

  const requestProjectChange = (nextPath: string) => {
    if (!nextPath || nextPath === projectPath) return;
    void applyProjectChange(nextPath);
  };

  const confirmationDialog = selectionIssue ? (
    <GenericDialog
      title={
        selectionIssue.type === "locked"
          ? "Project already open"
          : "Unable to switch project"
      }
      message={
        <>
          {selectionIssue.message}
          {selectionIssue.pid ? (
            <>
              <br />
              Owner PID: <code>{selectionIssue.pid}</code>
            </>
          ) : null}
        </>
      }
      onClose={() => setSelectionIssue(null)}
      actions={[
        {
          label: "Okay",
          onClick: () => setSelectionIssue(null),
          variant: "primary",
          autoFocus: true,
        },
      ]}
    />
  ) : null;

  return { requestProjectChange, confirmationDialog };
}
