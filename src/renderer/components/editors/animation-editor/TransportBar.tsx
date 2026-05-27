import React from "react";
import styles from "./AnimationEditorPage.module.css";
import {
  DEFAULT_FORWARD_PLAYBACK_RATE,
  DEFAULT_REVERSE_PLAYBACK_RATE,
  isAnimPlaybackActive,
  nextShuttlePlaybackRate,
  playbackDirection,
} from "./playback-state";

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

type Props = {
  playbackRate: number;
  isRecording: boolean;
  loopEnabled: boolean;
  loopResetDurationSec: number;
  durationSec: number;
  playheadSec: number;
  playheadSampleStepSec: number;
  writeAnimControlField: (fieldName: string, value: unknown) => Promise<void>;
  setLoopEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  seekPlayheadToTimeSec: (nextTimeSec: number) => void;
  onCommitDurationSec: (nextDurationSec: number) => void;
  onCommitLoopResetDurationSec: (nextLoopResetDurationSec: number) => void;
};

export function TransportBar({
  playbackRate,
  isRecording,
  loopEnabled,
  loopResetDurationSec,
  durationSec,
  playheadSec,
  playheadSampleStepSec,
  writeAnimControlField,
  setLoopEnabled,
  seekPlayheadToTimeSec,
  onCommitDurationSec,
  onCommitLoopResetDurationSec,
}: Props) {
  const [loopResetDraft, setLoopResetDraft] = React.useState(() => loopResetDurationSec.toFixed(2));
  const [durationDraft, setDurationDraft] = React.useState(() => durationSec.toFixed(2));
  const requestedPlaybackRateRef = React.useRef(playbackRate);

  React.useEffect(() => {
    setLoopResetDraft(loopResetDurationSec.toFixed(2));
  }, [loopResetDurationSec]);

  React.useEffect(() => {
    setDurationDraft(durationSec.toFixed(2));
  }, [durationSec]);

  React.useEffect(() => {
    requestedPlaybackRateRef.current = playbackRate;
  }, [playbackRate]);

  const transportActive = isAnimPlaybackActive(playbackRate, isRecording);
  const direction = playbackDirection(playbackRate);

  const writeTransportState = React.useCallback(
    async (nextPlaybackRate: number, nextRecordEnabled: boolean) => {
      requestedPlaybackRateRef.current = nextPlaybackRate;
      if (nextRecordEnabled) {
        await writeAnimControlField("playback_rate", nextPlaybackRate);
        await writeAnimControlField("record_enabled", true);
        return;
      }
      await writeAnimControlField("record_enabled", false);
      await writeAnimControlField("playback_rate", nextPlaybackRate);
    },
    [writeAnimControlField]
  );

  const toggleLoopEnabled = React.useCallback(() => {
    const nextLoopEnabled = !loopEnabled;
    setLoopEnabled(nextLoopEnabled);
    void writeAnimControlField("loop", nextLoopEnabled);
  }, [loopEnabled, setLoopEnabled, writeAnimControlField]);

  const requestReversePlay = React.useCallback(() => {
    void writeTransportState(DEFAULT_REVERSE_PLAYBACK_RATE, false);
  }, [writeTransportState]);

  const requestReverseShuttle = React.useCallback(() => {
    const nextPlaybackRate = nextShuttlePlaybackRate(requestedPlaybackRateRef.current, -1);
    void writeTransportState(nextPlaybackRate, false);
  }, [writeTransportState]);

  const requestStop = React.useCallback(() => {
    void writeTransportState(0, false);
  }, [writeTransportState]);

  const requestForwardPlay = React.useCallback(() => {
    void writeTransportState(DEFAULT_FORWARD_PLAYBACK_RATE, false);
  }, [writeTransportState]);

  const requestForwardShuttle = React.useCallback(() => {
    const nextPlaybackRate = nextShuttlePlaybackRate(requestedPlaybackRateRef.current, 1);
    void writeTransportState(nextPlaybackRate, false);
  }, [writeTransportState]);

  const toggleRecording = React.useCallback(() => {
    if (isRecording) {
      void writeTransportState(0, false);
      return;
    }
    void writeTransportState(DEFAULT_FORWARD_PLAYBACK_RATE, true);
  }, [isRecording, writeTransportState]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (transportActive) {
          requestStop();
          return;
        }
        void writeTransportState(DEFAULT_FORWARD_PLAYBACK_RATE, false);
        return;
      }
      if (event.code === "KeyJ") {
        event.preventDefault();
        requestReverseShuttle();
        return;
      }
      if (event.code === "KeyK") {
        event.preventDefault();
        requestStop();
        return;
      }
      if (event.code === "KeyL") {
        event.preventDefault();
        requestForwardShuttle();
        return;
      }
      if (event.code === "NumpadDivide" || (event.key === "/" && event.location === 3)) {
        event.preventDefault();
        toggleLoopEnabled();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestForwardShuttle, requestReverseShuttle, requestStop, toggleLoopEnabled, transportActive, writeTransportState]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (transportActive) return;
      if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.code === "ArrowRight" ? 1 : -1;
      const multiplier = event.shiftKey ? 10 : 1;
      seekPlayheadToTimeSec(playheadSec + direction * playheadSampleStepSec * multiplier);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playheadSampleStepSec, playheadSec, seekPlayheadToTimeSec, transportActive]);

  return (
    <footer className={styles.transportBar}>
      <div className={styles.transportLeft} />
      <div className={styles.transportCenter}>
        <div className={styles.transportLauncherStrip}>
          <label className={`${styles.transportNumericField} ${styles.transportLoopDurationField}`}>
            <span className={styles.transportNumericLabel}>Reset Duration</span>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={loopResetDraft}
              title="Time to blend from clip end back to clip start when looping."
              onChange={(event) => setLoopResetDraft(event.target.value)}
              onBlur={() => {
                const parsed = Number(loopResetDraft);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                  setLoopResetDraft(loopResetDurationSec.toFixed(2));
                  return;
                }
                onCommitLoopResetDurationSec(parsed);
              }}
            />
          </label>
          <button className={styles.loopLauncherButton} type="button" title="Toggle loop playback. Shortcut: Numpad /." onClick={toggleLoopEnabled}>
            {loopEnabled ? "Loop" : "Once"}
          </button>
          <div className={styles.transportCluster} role="group" aria-label="Playback controls">
            <button
              className={`${styles.transportIconButton} ${direction < 0 ? styles.transportIconButtonActive : ""}`}
              type="button"
              aria-label="Play Reverse"
              title="Play reverse. Shortcut: J. Repeated J increases shuttle speed."
              onClick={requestReversePlay}
            >
              <span className={styles.iconPlayGlyph}>◀</span>
            </button>
            <button
              className={`${styles.transportIconButton} ${direction === 0 && !isRecording ? styles.transportIconButtonActive : ""} ${styles.iconStop}`}
              type="button"
              aria-label="Stop"
              title="Stop playback. Shortcut: K."
              onClick={requestStop}
            >
              <span className={styles.iconStopGlyph}>■</span>
            </button>
            <button
              className={`${styles.transportIconButton} ${direction > 0 && !isRecording ? styles.transportIconButtonActive : ""} ${styles.iconPlayPause}`}
              type="button"
              aria-label="Play"
              title="Play forward. Shortcuts: L, Space. Repeated L increases shuttle speed."
              onClick={requestForwardPlay}
            >
              <span className={styles.iconPlayGlyph}>▶</span>
            </button>
            <button
              className={`${styles.transportIconButton} ${styles.iconRecord} ${isRecording ? styles.transportIconButtonRecordActive : ""}`}
              type="button"
              aria-label="Record"
              title={isRecording ? "Stop recording." : "Record forward playback."}
              onClick={toggleRecording}
            >
              <span className={styles.iconRecordGlyph}>●</span>
            </button>
          </div>
          <div className={styles.transportNumericGroup}>
            <label className={styles.transportNumericField}>
              <span className={styles.transportNumericLabel}>Current</span>
              <input
                type="number"
                min={0}
                max={durationSec}
                step={0.1}
                value={playheadSec.toFixed(2)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  const clamped = Math.min(durationSec, Math.max(0, value));
                  seekPlayheadToTimeSec(clamped);
                }}
              />
            </label>
            <label className={styles.transportNumericField}>
              <span className={styles.transportNumericLabel}>Duration</span>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={durationDraft}
                onChange={(event) => setDurationDraft(event.target.value)}
                onBlur={() => {
                  const parsed = Number(durationDraft);
                  if (!Number.isFinite(parsed) || parsed <= 0) {
                    setDurationDraft(durationSec.toFixed(2));
                    return;
                  }
                  onCommitDurationSec(parsed);
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </footer>
  );
}
