import React from "react";
import styles from "../AnimationEditorPage.module.css";

type ToolSettingNumberControlProps = {
  label: string;
  value: string;
  numericValue: number;
  title: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  onReset: () => void;
  onDelta: (delta: number) => void;
  onScrubValue: (next: number) => void;
  stepSize: number;
};

export function ToolSettingNumberControl({
  label,
  value,
  numericValue,
  title,
  onChange,
  onCommit,
  onReset,
  onDelta,
  onScrubValue,
  stepSize,
}: ToolSettingNumberControlProps) {
  const scrubRef = React.useRef<{
    onMove: (event: MouseEvent) => void;
    onUp: () => void;
    previousUserSelect: string;
  } | null>(null);

  const beginScrub = React.useCallback(
    (startX: number) => {
      const existing = scrubRef.current;
      if (existing) {
        window.removeEventListener("mousemove", existing.onMove);
        window.removeEventListener("mouseup", existing.onUp);
        document.body.style.userSelect = existing.previousUserSelect;
      }
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const pixelsPerStep = 6;
      const startValue = numericValue;
      const scrubState = {
        previousUserSelect,
        onMove: (moveEvent: MouseEvent) => {
          moveEvent.preventDefault();
          const multiplier = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
          const deltaUnits =
            ((moveEvent.clientX - startX) / pixelsPerStep) * stepSize * multiplier;
          onScrubValue(startValue + deltaUnits);
        },
        onUp: () => {
          window.removeEventListener("mousemove", scrubState.onMove);
          window.removeEventListener("mouseup", scrubState.onUp);
          document.body.style.userSelect = scrubState.previousUserSelect;
          scrubRef.current = null;
        },
      };
      scrubRef.current = scrubState;
      window.addEventListener("mousemove", scrubState.onMove);
      window.addEventListener("mouseup", scrubState.onUp);
    },
    [numericValue, onScrubValue, stepSize]
  );

  return (
    <div className={styles.toolSettingRow} title={title}>
      <span>{label}</span>
      <div className={styles.toolSettingControl}>
        <button
          type="button"
          className={styles.toolSettingScrubHotspot}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            beginScrub(event.clientX);
          }}
          title={`${title} (drag horizontally to scrub, Shift x10, Alt /10)`}
          aria-label={`Scrub ${label}`}
        >
          <span className={styles.toolSettingScrubDot} />
        </button>
        <input
          className={styles.toolSettingInput}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              onReset();
              event.currentTarget.blur();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              onDelta(stepSize * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1));
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              onDelta(-stepSize * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1));
            }
          }}
          title={title}
        />
        <button
          type="button"
          className={styles.toolSettingStepperButton}
          onClick={(event) =>
            onDelta(-stepSize * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1))
          }
          title={`Decrease ${label} (Shift x10, Alt /10)`}
        >
          -
        </button>
        <button
          type="button"
          className={styles.toolSettingStepperButton}
          onClick={(event) =>
            onDelta(stepSize * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1))
          }
          title={`Increase ${label} (Shift x10, Alt /10)`}
        >
          +
        </button>
      </div>
    </div>
  );
}
