import { useEffect, useState } from "react";
import { ITelemetryModel } from "./telemetry-client";
import { useTelemetryService } from "./TelemetryService";

/**
 * React hook that exposes the latest telemetry model (and any subscription
 * errors) for a given base URL. This is the primary entry point that UI code
 * should consume, re-exported via `core/telemetry`.
 */
export function useTelemetryStream(baseUrl: string, pollingRateHz = 20) {
  const telemetryService = useTelemetryService();
  const [model, setModel] = useState<ITelemetryModel | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!baseUrl) {
      setModel((prev) => (prev ? null : prev));
      setError(null);
      return;
    }

    const unsubscribe = telemetryService.subscribeTelemetry(
      baseUrl,
      pollingRateHz,
      {
        callback: (next) => {
          setModel((prev) => (prev === next ? prev : next));
          setError(null);
        },
        error: (err) => setError(err),
      }
    );

    return () => unsubscribe();
  }, [baseUrl, pollingRateHz, telemetryService]);

  return { model, error };
}
