import React, { useMemo, useState } from "react";
import styles from "./styles/RcTelemetryOverlay.module.css";
import { useTelemetryStream } from "../../../core/telemetry/useTelemetryStream";

type RcTelemetryConfig = {
  telemetryBaseUrl?: string;
  workloadId?: string;
};

type RcTelemetryProps = {
  config?: RcTelemetryConfig;
};

export function RcTelemetryOverlay({ config }: RcTelemetryProps) {
  const telemetryBaseUrl = config?.telemetryBaseUrl;
  const workloadId = config?.workloadId ?? "rsc_mind_test";

  if (!telemetryBaseUrl) {
    console.warn("[rc-telemetry] Missing telemetryBaseUrl in module config");
    return null;
  }

  const { model, error } = useTelemetryStream(telemetryBaseUrl, 100);
  const data = useMemo(() => {
    if (!model) return null;
    const workload = model.workloads.find((w) => w.name === workloadId);
    if (!workload || !workload.outputs) return null;
    return buildNestedFromStruct(workload.outputs);
  }, [model, workloadId]);

  return (
    <div className={styles.overlay}>
      <div className={styles.header}>Mind Test Outputs</div>
      {error ? (
        <div className={styles.error}>⚠️ {String(error)}</div>
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
