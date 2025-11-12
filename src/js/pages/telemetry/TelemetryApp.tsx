// src/js/pages/telemetry/TelemetryApp.tsx
import React, { useEffect, useRef, useState } from "react";
import { EngineState } from "./types";
import { getEngineModels, startLivePolling } from "./polling";
import { TelemetryModel } from "./TelemetryModel";

export function TelemetryApp() {
  const [engines, setEngines] = useState<EngineState[]>([]);
  const enginesRef = useRef<EngineState[]>([]);
  enginesRef.current = engines;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const engineModels = await getEngineModels();

      const initial: EngineState[] = engineModels.map((model) => ({
        model,
        workloads: [],
        workloadIndex: 0,
        pollingController: new AbortController(),
        livePollingController: new AbortController(),
        hasInitialWorkloads: false,
        canLivePoll: false,
      }));

      if (cancelled) return;
      setEngines(initial);

      startLivePolling(initial, setEngines);
    })();

    return () => {
      cancelled = true;
      for (const s of enginesRef.current) {
        s.pollingController.abort();
        s.livePollingController.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {engines.map((s) => (
        <TelemetryModel key={s.model.instanceURL} state={s} />
      ))}
    </>
  );
}
