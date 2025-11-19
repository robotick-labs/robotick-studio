import React, { useEffect, useMemo, useState } from "react";
import styles from "./styles/RcTelemetryOverlay.module.css";
import { useTelemetryStream } from "../../../data-sources/telemetry";
import { ProjectData } from "../../../data-sources/launcher";
import { GenericPanel } from "../../../components/dialog/GenericPanel";

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
  const { projectModels, findModelByName } = ProjectData.use();
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

  const { model, error } = useTelemetryStream(telemetryBaseUrl ?? "", 20); // 20 Hz default for RC telemetry

  const initialPosition = useMemo(() => {
    if (typeof window === "undefined") {
      return { x: 1000, y: 120 };
    }
    return {
      x: Math.max(40, window.innerWidth - 660),
      y: 120,
    };
  }, []);

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
    <GenericPanel
      title="Mind Test Outputs"
      closable={false}
      initialPosition={initialPosition}
      initialSize={{ width: 600, height: 600 }}
      minSize={{ width: 400, height: 320 }}
      className={styles.panel}
      headerClassName={styles.header}
      bodyClassName={styles.body}
      storageKey="rc-telemetry-overlay"
    >
      {error ? (
        <div className={styles.error}>⚠️ {String(error)}</div>
      ) : (
        <pre className={styles.pre}>
          {data ? JSON.stringify(data, null, 2) : "Loading..."}
        </pre>
      )}
    </GenericPanel>
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
