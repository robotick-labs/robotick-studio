import React, { useState } from "react";
import { useProjectContext } from "./ProjectContext";
import { useLauncherContext } from "./LauncherContext";
import { GenericDialog } from "../../../components/dialog/GenericDialog";

export function useProjectChangeConfirmation() {
  const { projectPath, setProjectPath } = useProjectContext();
  const { status, stop } = useLauncherContext();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);

  const requestProjectChange = (nextPath: string) => {
    if (!nextPath || nextPath === projectPath) return;
    if (status === "stopped") {
      setProjectPath(nextPath);
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
      setProjectPath(pendingPath);
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
  ) : null;

  return { requestProjectChange, confirmationDialog };
}
