// src/js/components/editors/project/components/StringField.tsx
import React from "react";
import styles from "../styles/ProjectPage.module.css";

interface Props {
  field: string;
  label: string;
  tooltip: string;
  value: string;
  onChange: (field: string, value: string) => void;
}

export function StringField({ field, label, tooltip, value, onChange }: Props) {
  return (
    <div className={styles.row}>
      <div className={styles.key} title={tooltip}>
        {label}
      </div>
      <div className={styles.value}>
        <input
          type="text"
          value={value}
          title={tooltip}
          className={styles.textInput}
          onChange={(e) => onChange(field, e.target.value)}
        />
      </div>
    </div>
  );
}
