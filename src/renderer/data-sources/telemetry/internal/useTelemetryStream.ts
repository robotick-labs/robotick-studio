import { useEffect, useRef, useState } from "react";
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
  // The store may reuse a stable telemetry model and swap only `model.raw`.
  const [, setRevision] = useState(0);
  const latestBaseUrlRef = useRef(baseUrl);
  useEffect(() => {
    latestBaseUrlRef.current = baseUrl;
  }, [baseUrl]);

  useEffect(() => {
    if (!baseUrl) {
      setModel((prev) => (prev ? null : prev));
      setError(null);
      return;
    }

    let cancelled = false;
    const activeBaseUrl = baseUrl;

    const unsubscribe = telemetryService.subscribeTelemetry(
      activeBaseUrl,
      pollingRateHz,
      {
        callback: (next) => {
          if (cancelled || latestBaseUrlRef.current !== activeBaseUrl) {
            return;
          }
          setModel((prev) => (prev === next ? prev : next));
          setRevision((prev) => prev + 1);
          setError(null);
        },
        error: (err) => {
          if (cancelled || latestBaseUrlRef.current !== activeBaseUrl) {
            return;
          }
          setError(err);
        },
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [baseUrl, pollingRateHz, telemetryService]);

  return { model, error };
}
