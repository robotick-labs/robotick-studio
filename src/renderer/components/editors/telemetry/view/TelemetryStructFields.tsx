import React from "react";
import type {
  ITelemetryStruct as TelemetryStruct,
} from "../../../../data-sources/telemetry";
import type { FieldConnectionHint } from "./types";
import { TelemetryFieldTree } from "./TelemetryFieldTree";
import styles from "../Telemetry.module.css";

type StructFieldProps = {
  struct?: TelemetryStruct;
  telemetryBaseUrl?: string;
  workloadId?: string;
  workloadName?: string;
  modelId?: string;
  modelName?: string;
  modelPath?: string;
  panelScope?: string;
  fieldConnectionHints?: ReadonlyMap<string, FieldConnectionHint>;
};

export function TelemetryStructFields({
  struct,
  telemetryBaseUrl,
  workloadId,
  workloadName,
  modelId,
  modelName,
  modelPath,
  panelScope,
  fieldConnectionHints,
}: StructFieldProps) {
  const fields = struct?.fields;
  if (!fields || fields.length === 0) {
    return <div className={styles.multiline}>–</div>;
  }

  return (
    <TelemetryFieldTree
      className={styles.telemetryStructTreeCompact}
      fields={fields}
      telemetryBaseUrl={telemetryBaseUrl}
      workloadId={workloadId}
      workloadName={workloadName}
      panelScope={panelScope}
      modelId={modelId}
      modelName={modelName}
      modelPath={modelPath}
      fieldConnectionHints={fieldConnectionHints}
      defaultExpandedPaths={[]}
    />
  );
}
