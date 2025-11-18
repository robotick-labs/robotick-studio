// src/js/pages/telemetry/view/TelemetryApp.tsx
import React, { useEffect, useState } from "react";
import { EngineModel } from "./types";
import { getEngineModels } from "../document/polling";
import { TelemetryModel } from "./TelemetryModel";
import { useProjectContext } from "../../../core/ProjectContext";

export function TelemetryApp() {
  const [models, setModels] = useState<EngineModel[]>([]);
  const { projectPath } = useProjectContext();

  useEffect(() => {
    let cancelled = false;
    setModels([]);
    if (!projectPath) {
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const engineModels = await getEngineModels(projectPath);
        if (!cancelled) {
          setModels(engineModels);
        }
      } catch (err) {
        console.warn("Failed to load engine models:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  return (
    <>
      {models.map((model, index) => (
        <TelemetryModel key={model.instanceURL} model={model} index={index} />
      ))}
    </>
  );
}
