import React, { useEffect, useRef, useState } from "react";
import { RemoteControlClient } from "./remoteControlClient";
import styles from "./styles/RemoteControlsPanel.module.css";

export default function RemoteControlsPanel() {
  const leftAreaRef = useRef<HTMLDivElement>(null);
  const leftKnobRef = useRef<HTMLDivElement>(null);
  const rightAreaRef = useRef<HTMLDivElement>(null);
  const rightKnobRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<RemoteControlClient | null>(null);

  const [useWebInputs, setUseWebInputs] = useState(true);

  useEffect(() => {
    if (
      !leftAreaRef.current ||
      !leftKnobRef.current ||
      !rightAreaRef.current ||
      !rightKnobRef.current
    ) {
      return;
    }

    const client = new RemoteControlClient({
      leftArea: leftAreaRef.current,
      leftKnob: leftKnobRef.current,
      rightArea: rightAreaRef.current,
      rightKnob: rightKnobRef.current,
    });
    client.setUseWebInputs(useWebInputs);
    clientRef.current = client;

    return () => {
      client.dispose();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    clientRef.current?.setUseWebInputs(useWebInputs);
  }, [useWebInputs]);

  const toggleTakeover = () => {
    setUseWebInputs((prev) => !prev);
  };

  return (
    <>
      <div className={styles.joystickRow}>
        <div className={styles.stickArea} ref={leftAreaRef}>
          <div className={styles.knob} ref={leftKnobRef} />
        </div>
        <div className={styles.stickArea} ref={rightAreaRef}>
          <div className={styles.knob} ref={rightKnobRef} />
        </div>
      </div>

      <div className={styles.controls}>
        <button
          className={`${styles.toggleButton} ${
            useWebInputs ? styles.toggleButtonActive : styles.toggleButtonInactive
          }`.trim()}
          onClick={toggleTakeover}
        >
          TAKEOVER
        </button>
      </div>
    </>
  );
}
