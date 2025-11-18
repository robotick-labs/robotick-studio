// src/js/pages/project/components/StringArrayField.tsx
import React from "react";
import styles from "../styles/ProjectPage.module.css";

interface Props {
  field: string;
  label: string;
  tooltip: string;
  values: string[];
  onChange: (field: string, value: string[]) => void;
}

export function StringArrayField({
  field,
  label,
  tooltip,
  values,
  onChange,
}: Props) {
  function update(index: number, val: string) {
    const arr = [...values];
    arr[index] = val;
    onChange(field, arr);
  }

  function add() {
    onChange(field, [...values, ""]);
  }

  function remove(index: number) {
    onChange(
      field,
      values.filter((_, i) => i !== index)
    );
  }

  return (
    <div className={styles.row}>
      <div className={styles.key} title={tooltip}>
        {label}
      </div>

      <div className={styles.value}>
        {values.map((v, i) => (
          <div className={styles.arrayInputWrapper} key={i}>
            <input
              type="text"
              value={v}
              title={tooltip}
              className={styles.textInput}
              onChange={(e) => update(i, e.target.value)}
            />
            <button
              className={styles.removeButton}
              type="button"
              onClick={() => remove(i)}
            >
              ×
            </button>
          </div>
        ))}

        <button
          className={styles.addItemButton}
          type="button"
          onClick={add}
        >
          + Add Item
        </button>
      </div>
    </div>
  );
}
