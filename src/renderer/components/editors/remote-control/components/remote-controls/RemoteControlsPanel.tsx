import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRemoteControlClient } from "./UseRemoteControlClient";
import styles from "../styles/RemoteControlsPanel.module.css";
import { ProjectData } from "../../../../../data-sources/launcher";
import {
  type ITelemetryModel,
  useTelemetryService,
  useTelemetryStream,
} from "../../../../../data-sources/telemetry";

export type RemoteControlsPanelConfig = {
  defaultUseWebInputs?: boolean;
  modelName?: string;
  workloadName?: string;
  telemetryBaseUrl?: string;
};

const REMOTE_CONTROLS_TELEMETRY_POLL_HZ = 10;

export default function RemoteControlsPanel({
  config,
}: {
  config?: RemoteControlsPanelConfig;
}) {
  const { findModelByName } = ProjectData.use();
  const telemetryService = useTelemetryService();
  const [leftAreaEl, setLeftAreaEl] = useState<HTMLDivElement | null>(null);
  const [leftKnobEl, setLeftKnobEl] = useState<HTMLDivElement | null>(null);
  const [rightAreaEl, setRightAreaEl] = useState<HTMLDivElement | null>(null);
  const [rightKnobEl, setRightKnobEl] = useState<HTMLDivElement | null>(null);
  const nextSeqRef = useRef(1);

  const initialUseWebInputs = useMemo(
    () => config?.defaultUseWebInputs ?? true,
    [config?.defaultUseWebInputs]
  );
  const [useWebInputs, setUseWebInputs] = useState(initialUseWebInputs);
  const workloadName = config?.workloadName?.trim() || "remote_control";

  const configuredBaseUrl = config?.telemetryBaseUrl?.trim();
  const configuredModelName = config?.modelName?.trim();
  const telemetryBaseUrl = useMemo(() => {
    if (configuredBaseUrl) {
      return configuredBaseUrl;
    }
    if (!configuredModelName) {
      return null;
    }
    const descriptor = findModelByName(configuredModelName);
    return descriptor?.telemetryBaseUrl ?? null;
  }, [configuredBaseUrl, configuredModelName, findModelByName]);

  const { model } = useTelemetryStream(
    telemetryBaseUrl ?? "",
    REMOTE_CONTROLS_TELEMETRY_POLL_HZ
  );

  const telemetryBaseUrlRef = useRef<string | null>(null);
  const telemetryModelRef = useRef<ITelemetryModel | null>(null);
  useEffect(() => {
    telemetryBaseUrlRef.current = telemetryBaseUrl ?? null;
  }, [telemetryBaseUrl]);
  useEffect(() => {
    telemetryModelRef.current = model ?? null;
  }, [model]);

  const writeTelemetryField = useCallback(
    (fieldPath: string, value: unknown) => {
      const currentBaseUrl = telemetryBaseUrlRef.current;
      const currentModel = telemetryModelRef.current;
      if (!currentBaseUrl || !currentModel?.schemaSessionId) {
        return;
      }

      const writableMeta = currentModel.writable_inputs_by_path?.get(fieldPath);
      if (!writableMeta || typeof writableMeta.field_handle !== "number") {
        return;
      }

      const seq = nextSeqRef.current++;
      void telemetryService
        .setWorkloadInputFieldData(currentBaseUrl, {
          engine_session_id: currentModel.schemaSessionId,
          field_handle: writableMeta.field_handle,
          field_path: fieldPath,
          value,
          seq,
        })
        .then((result) => {
          if (!result.ok) {
            console.warn("setWorkloadInputFieldData rejected", {
              fieldPath,
              status: result.status,
              body: result.body,
            });
          }
        });
    },
    [telemetryService]
  );

  const writesReady = useMemo(() => {
    return Boolean(telemetryBaseUrl && model?.schemaSessionId);
  }, [model?.schemaSessionId, telemetryBaseUrl]);

  useRemoteControlClient({
    leftArea: leftAreaEl,
    leftKnob: leftKnobEl,
    rightArea: rightAreaEl,
    rightKnob: rightKnobEl,
    useWebInputs,
    workloadName,
    writeTelemetryField,
    writesReady,
  });

  const toggleTakeover = () => {
    setUseWebInputs((prev) => !prev);
  };

  return (
    <>
      <div className={styles.joystickRow}>
        <div className={styles.stickArea} ref={setLeftAreaEl}>
          <div className={styles.knob} ref={setLeftKnobEl} />
        </div>
        <div className={styles.stickArea} ref={setRightAreaEl}>
          <div className={styles.knob} ref={setRightKnobEl} />
        </div>
      </div>

      <div className={styles.controls}>
        <button
          className={`${styles.toggleButton} ${
            useWebInputs
              ? styles.toggleButtonActive
              : styles.toggleButtonInactive
          }`.trim()}
          onClick={toggleTakeover}
        >
          TAKEOVER
        </button>
      </div>
    </>
  );
}
