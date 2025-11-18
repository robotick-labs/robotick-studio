import React, { useEffect, useState } from "react";
import {
  createTelemetryModel,
  fetchLayout,
  fetchRaw,
} from "../../telemetry/document/telemetry-client";
import { RC_TELEMETRY_BASE } from "../../../core/config";
import styles from "./styles/RcTelemetryOverlay.module.css";

const TELEMETRY_WORKLOAD_ID = "rsc_mind_test";

export function RcTelemetryOverlay() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cachedLayout: any | null = null;
    let telemetryModel: any | null = null;
    let intervalId: number | undefined;
    let cancelled = false;

    async function poll() {
      try {
        if (!cachedLayout) {
          cachedLayout = await fetchLayout(RC_TELEMETRY_BASE);
          if (!cachedLayout) return;
          telemetryModel = createTelemetryModel(cachedLayout);
        }

        const { raw } = await fetchRaw(RC_TELEMETRY_BASE);
        if (!raw || !telemetryModel || cancelled) return;
        telemetryModel.raw = raw;

        const workload = telemetryModel.workloads.find(
          (w: any) => w.name === TELEMETRY_WORKLOAD_ID
        );
        if (!workload || !workload.outputs) {
          setError("No telemetry workload found");
          return;
        }

        const nested = buildNestedFromStruct(workload.outputs);
        setData(nested);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fetch failed");
      }
    }

    poll();
    intervalId = window.setInterval(poll, 100);
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className={styles.overlay}>
      <div className={styles.header}>Mind Test Outputs</div>
      {error ? (
        <div className={styles.error}>⚠️ {error}</div>
      ) : (
        <pre className={styles.pre}>
          {data ? JSON.stringify(data, null, 2) : "Loading..."}
        </pre>
      )}
    </div>
  );
}

function buildNestedFromStruct(struct: any): any {
  if (!struct || !struct.fields) return {};

  const result: any = {};
  for (const f of struct.fields) {
    if (f.fields && f.fields.length > 0) {
      result[f.name] = buildNestedFromStruct(f);
    } else {
      const value = f.getValue?.();
      result[f.name] = value;
    }
  }
  return result;
}
