import React, { useEffect, useRef, useState } from "react";
import { RemoteControlClient } from "./remoteControlClient";

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
      <div className="joystick-row">
        <div id="left-area" className="stick-area" ref={leftAreaRef}>
          <div id="left-knob" className="knob" ref={leftKnobRef} />
        </div>
        <div id="right-area" className="stick-area" ref={rightAreaRef}>
          <div id="right-knob" className="knob" ref={rightKnobRef} />
        </div>
      </div>

      <div className="controls">
        <button
          id="takeover-button"
          className={`toggle-button ${useWebInputs ? "active" : "inactive"}`}
          onClick={toggleTakeover}
        >
          TAKEOVER
        </button>
      </div>
    </>
  );
}
