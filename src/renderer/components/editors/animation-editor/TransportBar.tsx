import React from "react";
import styles from "./AnimationEditorPage.module.css";
import { ANIM_PLAYBACK_STATE_PAUSED, ANIM_PLAYBACK_STATE_PLAYING, ANIM_PLAYBACK_STATE_RECORDING } from "./playback-state";

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

type Props = {
  isPlaying: boolean;
  loopEnabled: boolean;
  durationSec: number;
  playheadSec: number;
  playheadSampleStepSec: number;
  setLocalScrubTimeSec: React.Dispatch<React.SetStateAction<number | null>>;
  writeAnimControlField: (fieldName: string, value: unknown) => Promise<void>;
  setLoopEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  seekPlayheadToTimeSec: (nextTimeSec: number) => void;
};

export function TransportBar({
  isPlaying,
  loopEnabled,
  durationSec,
  playheadSec,
  playheadSampleStepSec,
  setLocalScrubTimeSec,
  writeAnimControlField,
  setLoopEnabled,
  seekPlayheadToTimeSec,
}: Props) {
  const loopDurationSecMock = 1.0;

  const toggleLoopEnabled = React.useCallback(() => {
    const nextLoopEnabled = !loopEnabled;
    setLoopEnabled(nextLoopEnabled);
    void writeAnimControlField("loop", nextLoopEnabled);
  }, [loopEnabled, setLoopEnabled, writeAnimControlField]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (isPlaying) {
          void writeAnimControlField("playback_state", ANIM_PLAYBACK_STATE_PAUSED);
          return;
        }
        void writeAnimControlField("playback_state", ANIM_PLAYBACK_STATE_PLAYING);
        return;
      }
      if (event.code === "NumpadDivide" || (event.key === "/" && event.location === 3)) {
        event.preventDefault();
        toggleLoopEnabled();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying, toggleLoopEnabled, writeAnimControlField]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (isPlaying) return;
      if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.code === "ArrowRight" ? 1 : -1;
      const multiplier = event.shiftKey ? 10 : 1;
      seekPlayheadToTimeSec(playheadSec + direction * playheadSampleStepSec * multiplier);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying, playheadSampleStepSec, playheadSec, seekPlayheadToTimeSec]);

  return (
    <footer className={styles.transportBar}>
      <div className={styles.transportLeft} />
      <div className={styles.transportCenter}>
        <div className={styles.transportLauncherStrip}>
          <label className={`${styles.transportNumericField} ${styles.transportLoopDurationField}`}>
            <span className={styles.transportNumericLabel}>Reset Duration</span>
            <input type="number" min={0.01} step={0.01} value={loopDurationSecMock.toFixed(2)} readOnly title="Time to blend from clip end back to clip start when looping (planned)." />
          </label>
          <button className={styles.loopLauncherButton} type="button" title="Toggle loop playback. Shortcut: Numpad /." onClick={toggleLoopEnabled}>
            {loopEnabled ? "Loop" : "Once"}
          </button>
          <div className={styles.transportCluster} role="group" aria-label="Playback controls">
            <button
              className={`${styles.transportIconButton} ${styles.iconPlayPause}`}
              type="button"
              aria-label={isPlaying ? "Pause" : "Play"}
              title={isPlaying ? "Pause playback. Shortcut: Space." : "Play playback. Shortcut: Space."}
              onClick={() => {
                const nextPlaying = !isPlaying;
                if (nextPlaying) {
                  void writeAnimControlField("playback_state", ANIM_PLAYBACK_STATE_PLAYING);
                  return;
                }
                void writeAnimControlField("playback_state", ANIM_PLAYBACK_STATE_PAUSED);
              }}
            >
              <span className={isPlaying ? styles.iconPauseGlyph : styles.iconPlayGlyph}>{isPlaying ? "⏸" : "▶"}</span>
            </button>
            <button
              className={`${styles.transportIconButton} ${styles.iconRecord}`}
              type="button"
              aria-label="Record"
              title="Record playback."
              onClick={() => void writeAnimControlField("playback_state", ANIM_PLAYBACK_STATE_RECORDING)}
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
                  setLocalScrubTimeSec(clamped);
                  void writeAnimControlField("time_override_sec", clamped);
                }}
              />
            </label>
            <label className={styles.transportNumericField}>
              <span className={styles.transportNumericLabel}>Duration</span>
              <input type="number" min={0.01} step={0.01} value={durationSec.toFixed(2)} readOnly />
            </label>
          </div>
        </div>
      </div>
    </footer>
  );
}
