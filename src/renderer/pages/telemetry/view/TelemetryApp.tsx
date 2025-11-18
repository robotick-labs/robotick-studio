// src/js/pages/telemetry/view/TelemetryApp.tsx
import React, { useEffect, useState } from "react";
import { EngineModel } from "./types";
import { getEngineModels } from "../document/polling";
import { TelemetryModel } from "./TelemetryModel";

export function TelemetryApp() {
  const [models, setModels] = useState<EngineModel[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const engineModels = await getEngineModels();
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
  }, []);

  return (
    <>
      {models.map((model, index) => (
        <TelemetryModel key={model.instanceURL} model={model} index={index} />
      ))}
    </>
  );
}
