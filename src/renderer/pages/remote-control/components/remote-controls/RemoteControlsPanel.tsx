import React, { useMemo, useState } from "react";
import { useRemoteControlClient } from "./UseRemoteControlClient";
import styles from "../styles/RemoteControlsPanel.module.css";

export type RemoteControlsPanelConfig = {
  defaultUseWebInputs?: boolean;
  remoteControlServer?: string;
};

export default function RemoteControlsPanel({
  config,
}: {
  config?: RemoteControlsPanelConfig;
}) {
  const [leftAreaEl, setLeftAreaEl] = useState<HTMLDivElement | null>(null);
  const [leftKnobEl, setLeftKnobEl] = useState<HTMLDivElement | null>(null);
  const [rightAreaEl, setRightAreaEl] = useState<HTMLDivElement | null>(null);
  const [rightKnobEl, setRightKnobEl] = useState<HTMLDivElement | null>(null);

  const initialUseWebInputs = useMemo(
    () => config?.defaultUseWebInputs ?? true,
    [config?.defaultUseWebInputs]
  );
  const [useWebInputs, setUseWebInputs] = useState(initialUseWebInputs);

  useRemoteControlClient({
    leftArea: leftAreaEl,
    leftKnob: leftKnobEl,
    rightArea: rightAreaEl,
    rightKnob: rightKnobEl,
    useWebInputs,
    remoteControlServer: config?.remoteControlServer,
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
