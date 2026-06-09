import React, { useState } from "react";
import { useProjectContext } from "./ProjectContext";
import { useLauncherContext } from "./LauncherContext";
import { GenericDialog } from "../../../components/dialog/GenericDialog";
import type { ProjectSelectionIssue } from "./launcher-interface";

export function useProjectChangeConfirmation() {
  const { projectPath, selectProjectPath } = useProjectContext();
  const { status, stop } = useLauncherContext();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
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
    if (status === "stopped") {
      void applyProjectChange(nextPath);
      return;
    }
    setPendingPath(nextPath);
  };

  const confirmChange = async () => {
    if (!pendingPath) return;
    setIsStopping(true);
    setError(null);
    try {
      await stop();
      await applyProjectChange(pendingPath);
      setPendingPath(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStopping(false);
    }
  };

  const cancelChange = () => {
    if (isStopping) return;
    setPendingPath(null);
    setError(null);
  };

  const confirmationDialog = pendingPath ? (
    <GenericDialog
      title="Robot is currently running"
      message={
        <>
          Switching to{" "}
          <code>{pendingPath.split("/").pop() ?? pendingPath}</code> requires
          stopping the active launcher. Would you like to stop it now and switch
          projects?
        </>
      }
      onClose={cancelChange}
      error={error}
      actions={[
        {
          label: "Cancel",
          onClick: cancelChange,
          variant: "secondary",
          disabled: isStopping,
        },
        {
          label: isStopping ? "Stopping…" : "Stop & Switch",
          onClick: confirmChange,
          variant: "primary",
          disabled: isStopping,
        },
      ]}
    />
  ) : selectionIssue ? (
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
