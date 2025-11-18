import React, { useEffect, useMemo, useState } from "react";
import styles from "./styles/RcTelemetryOverlay.module.css";
import { useTelemetryStream } from "../../../core/telemetry/useTelemetryStream";
import { useLauncherData } from "../../../core/launcher/LauncherDataContext";

type RcTelemetryConfig = {
  telemetryBaseUrl?: string;
  workloadId?: string;
  modelName?: string;
  telemetryModelName?: string;
};

type RcTelemetryProps = {
  config?: RcTelemetryConfig;
};

export function RcTelemetryOverlay({ config }: RcTelemetryProps) {
  const { projectModels, findModelByName } = useLauncherData();
  const configuredBaseUrl = config?.telemetryBaseUrl?.trim();
  const configuredModelName =
    config?.telemetryModelName?.trim() ?? config?.modelName?.trim();
  const workloadId = config?.workloadId ?? "rsc_mind_test";

  const telemetryBaseUrl = useMemo(() => {
    if (configuredBaseUrl) {
      return configuredBaseUrl;
    }
    if (!configuredModelName) return null;
    const descriptor = findModelByName(configuredModelName);
    return descriptor?.telemetryBaseUrl ?? null;
  }, [configuredBaseUrl, configuredModelName, findModelByName]);

  useEffect(() => {
    if (
      !telemetryBaseUrl &&
      configuredModelName &&
      !projectModels.loading &&
      !projectModels.error
    ) {
      console.warn(
        `[rc-telemetry] Model "${configuredModelName}" not found in project telemetry.`
      );
    }
  }, [
    configuredModelName,
    projectModels.error,
    projectModels.loading,
    telemetryBaseUrl,
  ]);

  const { model, error } = useTelemetryStream(telemetryBaseUrl ?? "", 100);

  const data = useMemo(() => {
    if (!telemetryBaseUrl || !model) return null;
    const workload = model.workloads.find((w) => w.name === workloadId);
    if (!workload || !workload.outputs) return null;
    return buildNestedFromStruct(workload.outputs);
  }, [model, telemetryBaseUrl, workloadId]);

  if (!telemetryBaseUrl || !model) {
    return null;
  }

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
