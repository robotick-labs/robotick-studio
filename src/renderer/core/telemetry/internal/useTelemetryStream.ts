import { useEffect, useState } from "react";
import { ITelemetryModel } from "./telemetry-client";
import { subscribeTelemetry } from "./telemetry-store";

/**
 * React hook that exposes the latest telemetry model (and any subscription
 * errors) for a given base URL. This is the primary entry point that UI code
 * should consume, re-exported via `core/telemetry`.
 */
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
