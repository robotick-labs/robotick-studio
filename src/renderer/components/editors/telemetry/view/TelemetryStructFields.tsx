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
  workloadName?: string;
  modelName?: string;
  panelScope?: string;
  fieldConnectionHints?: ReadonlyMap<string, FieldConnectionHint>;
};

export function TelemetryStructFields({
  struct,
  telemetryBaseUrl,
  workloadName,
  modelName,
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
      panelScope={panelScope}
      modelName={modelName}
      fieldConnectionHints={fieldConnectionHints}
      defaultExpandedPaths={[]}
    />
  );
}
