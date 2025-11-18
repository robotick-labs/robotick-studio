import { useEffect, useState } from "react";
import { ITelemetryModel } from "./telemetry-client";
import { subscribeTelemetry } from "./telemetry-store";

export function useTelemetryStream(baseUrl: string, intervalMs = 200) {
  const [model, setModel] = useState<ITelemetryModel | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!baseUrl) {
      setModel(null);
      return;
    }

    const unsubscribe = subscribeTelemetry(baseUrl, intervalMs, {
      callback: (next) => {
        setModel(next);
        setError(null);
      },
      error: (err) => setError(err),
    });

    return () => unsubscribe();
  }, [baseUrl, intervalMs]);

  return { model, error };
}
