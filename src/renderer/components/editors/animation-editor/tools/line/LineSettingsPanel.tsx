import React from "react";
import styles from "../../AnimationEditorPage.module.css";
import type { AnimationToolSettingsContext } from "../types";

export function LineSettingsPanel({
  lineSnapStart,
  lineSnapEnd,
  setLineSnapStart,
  setLineSnapEnd,
}: Pick<
  AnimationToolSettingsContext,
  "lineSnapStart" | "lineSnapEnd" | "setLineSnapStart" | "setLineSnapEnd"
>) {
  return (
    <div className={styles.toolButtons}>
      <button
        type="button"
        className={`${styles.toolButton} ${lineSnapStart ? styles.toolButtonActive : ""}`}
        onClick={() => setLineSnapStart((current) => !current)}
        title="Anchor the line start to the current curve value at its time. Shortcut: [ (BracketLeft)."
      >
        Snap Start
      </button>
      <button
        type="button"
        className={`${styles.toolButton} ${lineSnapEnd ? styles.toolButtonActive : ""}`}
        onClick={() => setLineSnapEnd((current) => !current)}
        title="Anchor the line end to the current curve value at its time. Shortcut: ] (BracketRight)."
      >
        Snap End
      </button>
    </div>
  );
}
