import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRemoteControlClient } from "./UseRemoteControlClient";
import styles from "../styles/RemoteControlsPanel.module.css";
import { ProjectData } from "../../../../../data-sources/launcher";
import {
  type ITelemetryModel,
  useTelemetryService,
  useTelemetryStream,
} from "../../../../../data-sources/telemetry";

type TelemetryFieldDelta = {
  fieldPath: string;
  value: unknown;
};

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
  const inFlightRef = useRef(false);
  const queuedWritesRef = useRef<Map<string, unknown>>(new Map());

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

  const flushQueuedTelemetryWrites = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }

    const currentBaseUrl = telemetryBaseUrlRef.current;
    const liveModel = currentBaseUrl
      ? telemetryService.getLatestModel(currentBaseUrl)
      : null;
    const currentModel = liveModel ?? telemetryModelRef.current;
    if (!currentBaseUrl || !currentModel?.schemaSessionId) {
      return;
    }

    const queuedWrites = queuedWritesRef.current;
    if (queuedWrites.size === 0) {
      return;
    }

    queuedWritesRef.current = new Map();
    const writes = Array.from(queuedWrites.entries())
      .map(([fieldPath, value]) => {
        const writableMeta = currentModel.writable_inputs_by_path?.get(fieldPath);
        if (!writableMeta || typeof writableMeta.field_handle !== "number") {
          return null;
        }
        return {
          field_handle: writableMeta.field_handle,
          field_path: fieldPath,
          value,
        };
      })
      .filter((write): write is {
        field_handle: number;
        field_path: string;
        value: unknown;
      } => write !== null);

    if (writes.length === 0) {
      return;
    }

    inFlightRef.current = true;
    try {
      const result = await telemetryService.setWorkloadInputFieldsData(
        currentBaseUrl,
        {
          engine_session_id: currentModel.schemaSessionId,
          writes: writes.map((write) => ({ ...write })),
        },
        {
          maxAttempts: 1,
        }
      );
      if (!result.ok) {
        console.warn("setWorkloadInputFieldsData rejected", {
          writes: writes.map((write) => write.field_path),
          status: result.status,
          body: result.body,
        });
      }
    } finally {
      inFlightRef.current = false;
      if (queuedWritesRef.current.size > 0) {
        void flushQueuedTelemetryWrites();
      }
    }
  }, [telemetryService]);

  const writeTelemetryFields = useCallback(
    (writes: TelemetryFieldDelta[]) => {
      if (writes.length === 0) {
        return;
      }
      const queuedWrites = queuedWritesRef.current;
      for (const write of writes) {
        queuedWrites.set(write.fieldPath, write.value);
      }

      if (!inFlightRef.current) {
        void flushQueuedTelemetryWrites();
      }
    },
    [flushQueuedTelemetryWrites]
  );

  const writesReady = useMemo(() => {
    return Boolean(telemetryBaseUrl && model?.schemaSessionId);
  }, [model?.schemaSessionId, telemetryBaseUrl]);

  useEffect(() => {
    if (writesReady && queuedWritesRef.current.size > 0 && !inFlightRef.current) {
      void flushQueuedTelemetryWrites();
    }
  }, [flushQueuedTelemetryWrites, writesReady]);

  useRemoteControlClient({
    leftArea: leftAreaEl,
    leftKnob: leftKnobEl,
    rightArea: rightAreaEl,
    rightKnob: rightKnobEl,
    useWebInputs,
    workloadName,
    writeTelemetryFields,
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
